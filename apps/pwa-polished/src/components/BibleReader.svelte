<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import NavigationBar from "./NavigationBar.svelte";
  import SelectionToast from "./SelectionToast.svelte";
  import NotePopup from "./NotePopup.svelte";
  import { userProfileStore } from "../stores/userProfileStore";
  import { profileModalStore } from "../stores/profileModalStore";
  import AnnotationPanel from "./AnnotationPanel.svelte";
  import HighlightModal from "./HighlightModal.svelte";
  import { IndexedDBUserDataStore } from "../adapters/UserDataStore";
  import { subscribeToHighlightRemoteChanges } from "../adapters/SyncedHighlightAdapter";
  import { applyChapterHighlights } from "../lib/highlightRenderer";
  import { syncQueue } from "../lib/sync/SyncQueueService";
  import type { UserHighlight, UserWordHighlight, HighlightStyle } from "@projectbible/core";
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { searchQuery, triggerSearch } from "../stores/searchStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { IndexedDBTextStore } from "../lib/adapters";
  import { renderVerseHtml, extractHeading } from "../lib/verseRendering";
  import { BIBLE_BOOKS } from "../lib/bibleData";
  import { getSettings } from "../adapters/settings";
  import { readTransaction } from "../adapters/db";
  import type { DBMorphology } from "../adapters/db";
  import { HeadingsStore } from "../adapters/HeadingsStore";
  import { IndexedDBCommentaryStore } from "../adapters/CommentaryStore";
  import type { CommentaryEntry } from "../adapters/CommentaryStore";
  import { IndexedDBTskReferenceStore } from "../adapters/TskReferenceStore";
  import type { TskEntry } from "../adapters/TskReferenceStore";
  import { getAuthorColor, getAuthorInitials, TSK_COLOR } from "../lib/annotationConfig";
  import { readingSessionStore } from "../stores/readingSessionStore";
  import { readingProgressStore } from "../stores/ReadingProgressStore";
  import { localDateStr } from "../stores/clockStore";
  import type { HarmonyPassage, HarmonySection } from "@projectbible/core";

  const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans';

  function bibleReaderGetPlanDisplayName(config: any): string {
    if (config?.name) return config.name;
    if (config?.ordering === 'harmony') return 'Gospel Harmony';
    if (config?.ordering === 'chronological') return 'Chronological Plan';
    return 'Custom Plan';
  }

  function computeAllPlanContexts(book: string, chapter: number): any[] {
    try {
      const session = get(readingSessionStore);
      if (!session) return []; // No active reading session → no plan UI

      const raw = localStorage.getItem(STORAGE_ACTIVE_PLANS);
      if (!raw) return [];
      const activePlans: Array<{ id: string; plan: any }> = JSON.parse(raw);
      const planEntry = activePlans.find(p => p.id === session.planId);
      if (!planEntry) return [];

      const plan = planEntry.plan;
      const todayStr = localDateStr(new Date());
      const todayDay = plan.days?.find((d: any) => localDateStr(new Date(d.date)) === todayStr);
      if (!todayDay) return [];

      const results: any[] = [];

      if (plan.config?.ordering === 'harmony') {
        const sections: HarmonySection[] = todayDay.harmonySections ?? [];
        const allPassages: HarmonyPassage[] = sections.flatMap((s: HarmonySection) => s.passages);
        const sessionIdx = session.passageIndex ?? 0;
        const p = allPassages[sessionIdx];
        if (!p) return [];
        // Buttons appear at the passage's end chapter
        if (p.book !== book || p.endChapter !== chapter) return [];
        results.push({
          type: 'harmony',
          planId: session.planId,
          planName: bibleReaderGetPlanDisplayName(plan.config),
          dayNumber: session.dayNumber,
          passage: p,
          nextPassage: sessionIdx < allPassages.length - 1 ? allPassages[sessionIdx + 1] : null,
          isLastPassage: sessionIdx === allPassages.length - 1,
          passageIndex: sessionIdx,
          totalPassages: allPassages.length,
          harmonySections: sections,
        });
      } else {
        const todayChapters: Array<{ book: string; chapter: number }> = todayDay.chapters ?? [];
        const chapIdx = todayChapters.findIndex((c: any) => c.book === book && c.chapter === chapter);
        if (chapIdx < 0) return [];
        const nextCh = chapIdx < todayChapters.length - 1 ? todayChapters[chapIdx + 1] : null;
        results.push({
          type: 'standard',
          planId: session.planId,
          planName: bibleReaderGetPlanDisplayName(plan.config),
          dayNumber: session.dayNumber,
          nextChapter: nextCh,
          isLastChapter: chapIdx === todayChapters.length - 1,
          isSequentialNext: nextCh !== null && nextCh.book === book && nextCh.chapter === chapter + 1,
          todayChapters,
        });
      }

      return results;
    } catch {
      return [];
    }
  }

  export let windowId: string | undefined = undefined;

  let readerElement: HTMLDivElement;
  let textStore: IndexedDBTextStore;
  const headingsStore = new HeadingsStore();
  let chapters: Array<{
    book: string;
    chapter: number;
    verses: Array<{
      verse: number;
      text: string;
      html?: string;
      heading?: string | null;
      headingLevel?: number | null;
    }>;
  }> = [];
  let loading = true;
  let error = "";
  let chronologicalData: any = null;
  let isLoadingNextChapter = false;
  let isLoadingPrevChapter = false;
  let lastNavigationKey = "";
  let lastScrollTop = 0;
  let scrollResetPending = false; // Consume the synthetic scroll event fired by our own scrollTo({top:0})
  let navBarOffset = 0; // Track navbar Y offset (0 = visible, -68 = hidden)
  let verseLayout: "one-per-line" | "paragraph" | "paragraph-no-verse-numbers" = "one-per-line";
  let showSectionHeadings = true;
  let scrollHandler: ((e: Event) => void) | null = null;
  let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Note popup state
  let notePopupOpen = false;
  let notePopupBook = "";
  let notePopupChapter = 0;
  let notePopupVerse = 0;
  let notePopupContent = "";
  let notePopupNoteId: string | null = null;
  let notePopupX = 0;
  let notePopupY = 0;
  let notePopupW = 320;
  let notePopupH = 240;

  // Verse notes map (verse number → note id) for the current chapter
  let verseNotesMap = new Map<number, string>();

  // Annotation store instances
  const commentaryStore = new IndexedDBCommentaryStore();
  const tskStore = new IndexedDBTskReferenceStore();

  // Annotation data maps (keyed by verse number)
  let commentaryByVerse = new Map<number, CommentaryEntry[]>();
  let tskByVerse = new Map<number, TskEntry[]>();

  // Annotation panel state
  let annotationPanelOpen = false;
  let annotationPanelVerse = 0;
  let annotationPanelBook = "";
  let annotationPanelChapter = 0;
  let annotationPanelTab: "references" | "commentary" = "references";
  let annotationPanelTsk: TskEntry[] = [];
  let annotationPanelCommentary: CommentaryEntry[] = [];

  // Annotation toggles (reactive from store)
  $: showReferences = $navigationStore.showReferences ?? false;
  $: selectedCommentaryAuthors = $navigationStore.selectedCommentaryAuthors ?? [];
  $: showCommentaries = selectedCommentaryAuthors.length > 0;

  // All commentary entries for the current chapter (cached; re-filtered when authors change)
  let allCommentaryEntries: CommentaryEntry[] = [];

  // Rebuild the verse map whenever selected authors change
  $: {
    selectedCommentaryAuthors;
    rebuildCommentaryByVerse();
  }

  function rebuildCommentaryByVerse() {
    const map = new Map<number, CommentaryEntry[]>();
    for (const e of allCommentaryEntries) {
      if (selectedCommentaryAuthors.length === 0 || !selectedCommentaryAuthors.includes(e.author)) continue;
      const v = e.verseStart;
      if (!map.has(v)) map.set(v, []);
      map.get(v)!.push(e);
    }
    commentaryByVerse = map;
  }

  // Text selection state
  let showToast = false;
  let toastX = 0;
  let toastY = 0;
  let selectedText = "";
  let selectionMode: "word" | "verse" = "word";
  let selectionRange: Range | null = null;
  let longPressTimer: number | null = null;
  let searchHighlightedElement: HTMLElement | null = null;
  let dayCompleteMessage: string | null = null;
  let highlightedElements: HTMLElement[] = [];
  let isDragging = false;
  let dragEdge: "left" | "right" | null = null;
  let hoveredWordElement: HTMLElement | null = null;
  let justOpenedToast = false;
  let touchStartPos: { x: number; y: number } | null = null;
  let hasMoved = false;
  
  // Track selected verse number for commentary
  let selectedVerseNumber: number | null = null;

  // Highlight state
  const userDataStore = new IndexedDBUserDataStore();
  let highlightModalOpen = false;
  let highlightModalRef: { book: string; chapter: number; verse: number } | null = null;
  let highlightModalExisting: UserHighlight | UserWordHighlight | null = null;
  let highlightSelectionType: 'verse' | 'word' = 'verse';
  let pendingWordStart = 0;
  let pendingWordLength = 0;
  // Cached highlights for current chapter
  let chapterVerseHighlights: UserHighlight[] = [];
  let chapterWordHighlights: UserWordHighlight[] = [];

  // Morphology state
  let selectedMorphology: DBMorphology | null = null;

  let repeatsActive = false;
  let repeatsWord = "";

  // Morphology cache state
  let morphologyCache = new Map<number, DBMorphology[]>();
  let isIndexedPack = false;
  const DEBUG_MORPHOLOGY = true; // Set to false to disable debug features
  let morphStats = {
    hits: 0,
    misses: 0,
    indexMatches: 0,
    textFallback: 0,
    totalLookups: 0,
  };

  // Load user settings
  function loadUserSettings() {
    const settings = getSettings();
    verseLayout = settings.verseLayout || "one-per-line";
    showSectionHeadings = settings.showSectionHeadings !== false; // default true
  }

  // Listen for settings updates
  function handleSettingsUpdate() {
    loadUserSettings();
  }

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentTranslation =
    windowState?.contentState?.translation ?? $navigationStore.translation;
  $: translationFontClass = getTranslationFontClass(currentTranslation);
  $: isChronologicalMode = $navigationStore.isChronologicalMode ?? false;
  $: highlightVerse =
    windowState?.contentState?.highlightedVerse ??
    $navigationStore.highlightedVerse ??
    null;

  // ---------------------------------------------------------------------------
  // Harmony reading session
  // ---------------------------------------------------------------------------
  // Apply highlight immediately when readingPlanActiveTarget changes but we're already
  // on the target chapter (navKey doesn't change so loadChapter won't fire).
  let _lastRpTargetKey: string | null = null;
  $: {
    const rpTarget = $navigationStore.readingPlanActiveTarget;
    const newKey = rpTarget ? `${rpTarget.book}-${rpTarget.chapter}-${rpTarget.verse ?? 'null'}` : null;
    if (
      newKey !== null &&
      newKey !== _lastRpTargetKey &&
      rpTarget!.book === currentBook &&
      rpTarget!.chapter === currentChapter &&
      chapters.length > 0 &&
      chapters[0]?.book === rpTarget!.book &&
      chapters[0]?.chapter === rpTarget!.chapter
    ) {
      const scrollVerse = $navigationStore.scrollTargetVerse;
      _lastRpTargetKey = newKey;
      tick().then(async () => {
        if (scrollVerse != null) {
          const el = readerElement?.querySelector(`.verse[data-verse="${scrollVerse}"]`) as HTMLElement | null;
          if (el) scrollToVerseEl(el);
          navigationStore.clearScrollTarget();
        }
        await applyReadingPlanHighlight();
      });
    }
    if (newKey === null) _lastRpTargetKey = null;
  }

  // ---------------------------------------------------------------------------
  // Session-gated plan continue handlers
  // ---------------------------------------------------------------------------

  async function handleHarmonyContinueOnly(ctx: any) {
    const next = ctx.nextPassage as HarmonyPassage;
    if (!next) return;
    readingSessionStore.updatePassageIndex(ctx.passageIndex + 1);
    clearReadingPlanHighlight();
    navigationStore.setReadingPlanActiveTarget(next.book, next.startChapter, next.startVerse, false);
    doScrollToVerse(next.book, next.startChapter, next.startVerse);
    if (next.book === currentBook && next.startChapter === currentChapter) {
      await applyReadingPlanHighlight();
    }
  }

  async function handleHarmonyCheckAndContinue(ctx: any) {
    const section = (ctx.harmonySections as HarmonySection[]).find((s: HarmonySection) =>
      s.passages.some((p: HarmonyPassage) => p.label === (ctx.passage as HarmonyPassage).label)
    );
    if (section) {
      await readingProgressStore.markPassageComplete(ctx.planId, ctx.dayNumber, section.section, ctx.passage.label);
    }
    const next = ctx.nextPassage as HarmonyPassage;
    if (next) {
      readingSessionStore.updatePassageIndex(ctx.passageIndex + 1);
      clearReadingPlanHighlight();
      navigationStore.setReadingPlanActiveTarget(next.book, next.startChapter, next.startVerse, false);
      doScrollToVerse(next.book, next.startChapter, next.startVerse);
      if (next.book === currentBook && next.startChapter === currentChapter) {
        await applyReadingPlanHighlight();
      }
    }
  }

  async function handleHarmonyCheckAndFinishDay(ctx: any) {
    const section = (ctx.harmonySections as HarmonySection[]).find((s: HarmonySection) =>
      s.passages.some((p: HarmonyPassage) => p.label === (ctx.passage as HarmonyPassage).label)
    );
    if (section) {
      await readingProgressStore.markPassageComplete(ctx.planId, ctx.dayNumber, section.section, ctx.passage.label);
    }
    await readingProgressStore.markHarmonyDayComplete(ctx.planId, ctx.dayNumber);
    readingSessionStore.clearSession();
    navigationStore.clearReadingPlanActiveTarget();
    clearReadingPlanHighlight();
    dayCompleteMessage = ctx.planName;
  }

  async function handleMarkAndContinue(ctx: any, book: string, chapter: number) {
    await readingProgressStore.setChapterAction(
      ctx.planId, ctx.dayNumber, ctx.todayChapters, { book, chapter }, 'checked'
    );
    if (ctx.nextChapter) {
      navigationStore.setReadingPlanActiveTarget(ctx.nextChapter.book, ctx.nextChapter.chapter, null, false);
      navigationStore.setBook(ctx.nextChapter.book);
      navigationStore.setChapter(ctx.nextChapter.chapter);
      navBarOffset = -68;
    }
  }

  function handleContinueOnly(ctx: any) {
    if (ctx.nextChapter) {
      navigationStore.setReadingPlanActiveTarget(ctx.nextChapter.book, ctx.nextChapter.chapter, null, false);
      navigationStore.setBook(ctx.nextChapter.book);
      navigationStore.setChapter(ctx.nextChapter.chapter);
      navBarOffset = -68;
    }
  }

  async function handleStandardDayComplete(ctx: any) {
    await readingProgressStore.markDayComplete(ctx.planId, ctx.dayNumber, ctx.todayChapters);
    readingSessionStore.clearSession();
    navigationStore.clearReadingPlanActiveTarget();
    clearReadingPlanHighlight();
  }

  // DEBUG: Log when reactive values change
  $: console.log("📖 REACTIVE UPDATE:", {
    currentTranslation,
    currentBook,
    currentChapter,
    isChronologicalMode,
  });

  // Load verses when navigation changes externally (not from our scroll loading)
  $: {
    const navKey = `${currentTranslation}-${currentBook}-${currentChapter}-${isChronologicalMode}`;
    console.log(
      "🔑 Navigation key changed:",
      navKey,
      "last:",
      lastNavigationKey,
    );
    if (textStore && navKey !== lastNavigationKey) {
      console.log("🚀 Triggering loadChapter from reactive block");

      // Check if translation changed and book might not exist (BEFORE updating lastNavigationKey)
      const prevTranslation = lastNavigationKey.split("-")[0];
      const translationChanged =
        prevTranslation && prevTranslation !== currentTranslation;

      // Update lastNavigationKey AFTER checking previous value
      lastNavigationKey = navKey;

      if (translationChanged) {
        console.log(
          `📚 Translation changed from ${prevTranslation} to ${currentTranslation}, verifying book exists...`,
        );
        // Capture scroll target before any async work clears it
        const scrollVerse = $navigationStore.scrollTargetVerse ?? null;
        // Verify the book exists in new translation, fallback if not
        verifyAndLoadChapter(currentTranslation, currentBook, currentChapter, scrollVerse);
      } else {
        const scrollVerse = $navigationStore.scrollTargetVerse ?? null;
        loadChapter(currentTranslation, currentBook, currentChapter, true, scrollVerse);
      }
    }
  }

  $: if (chapters.length > 0 && highlightVerse) {
    applySearchHighlight(highlightVerse);
  }

  $: if (!highlightVerse) {
    clearSearchHighlight();
  }

  // Scroll helper: same-chapter → direct DOM scroll; different chapter → navigateTo sets
  // scrollTargetVerse which loadChapter reads after resetting scrollTop.
  function doScrollToVerse(book: string, chapter: number, verse: number) {
    if (book === currentBook && chapter === currentChapter) {
      // Chapter already loaded — scroll directly, no store navigation needed.
      const el = readerElement?.querySelector(
        `.verse[data-verse="${verse}"]`,
      ) as HTMLElement | null;
      if (el) scrollToVerseEl(el);
    } else {
      // Different chapter — navigateTo sets scrollTargetVerse; loadChapter picks it up.
      navigationStore.navigateTo(currentTranslation, book, chapter, verse);
    }
  }

  // Scroll to a verse element, pulling in any immediately-preceding section heading
  // that falls within 55% of the screen height above the verse.
  function scrollToVerseEl(verseEl: HTMLElement): void {
    const budget = window.innerHeight * 0.55;
    let scrollTarget: HTMLElement = verseEl;
    let prev = verseEl.previousElementSibling as HTMLElement | null;
    let accumulated = 0;
    while (prev) {
      accumulated += prev.getBoundingClientRect().height;
      if (accumulated > budget) break;
      if (prev.classList.contains('section-heading')) {
        scrollTarget = prev;
        break;
      }
      prev = prev.previousElementSibling as HTMLElement | null;
    }
    navBarOffset = -68;
    const containerRect = readerElement.getBoundingClientRect();
    const targetRect = scrollTarget.getBoundingClientRect();
    const newScrollTop = readerElement.scrollTop + (targetRect.top - containerRect.top) - 8;
    readerElement.scrollTop = Math.max(0, newScrollTop);
    lastScrollTop = readerElement.scrollTop;
  }

  // Start/stop scroll detection when both book and element are ready
  $: if (currentBook && readerElement) {
    startScrollDetection();
  }

  // Check if translation is original language (Greek/Hebrew)
  function isOriginalLanguage(translationId: string): boolean {
    // Case-insensitive: bundled packs use uppercase (WLC, BYZ, TR, LXX) but
    // the consolidated ancient-languages pack uses lowercase (hebrew-oshb, byz, tr, lxx).
    const id = translationId.toLowerCase();
    return id === 'wlc' || id === 'lxx' || id === 'byz' || id === 'tr' ||
           id === 'sblgnt' || id === 'hebrew-oshb';
  }

  // Fetch morphology data for a verse
  async function getMorphologyForVerse(
    translationId: string,
    book: string,
    chapter: number,
    verse: number,
  ): Promise<DBMorphology[]> {
    try {
      const result = await readTransaction("morphology", (store) => {
        const index = store.index("verse_ref");
        const range = IDBKeyRange.only([translationId, book, chapter, verse]);
        return index.getAll(range);
      });
      return result as DBMorphology[];
    } catch (error) {
      console.error("Error fetching morphology:", error);
      return [];
    }
  }

  // Render verse with morphology tagging for original languages
  // @ts-expect-error - Unused function kept for future use
  async function _renderVerseWithMorphology(
    translationId: string,
    book: string,
    chapter: number,
    verse: number,
    text: string,
  ): Promise<string> {
    if (!isOriginalLanguage(translationId)) {
      return renderVerseHtml(text);
    }

    const morphData = await getMorphologyForVerse(
      translationId,
      book,
      chapter,
      verse,
    );
    if (morphData.length === 0) {
      // No morphology data, render normally
      return renderVerseHtml(text);
    }

    // Sort by word position
    const sorted = morphData.sort((a, b) => (a.wordPosition || 0) - (b.wordPosition || 0));

    // Build HTML with word spans
    let html = "";
    sorted.forEach((morph, idx) => {
      const word = morph.word || morph.text || "";
      const lemma = morph.lemma || "";
      const strongsId = morph.strongsId || "";
      const gloss = morph.gloss || "";
      const parsing = morph.parsing || "";
      const transliteration = morph.transliteration || "";

      html +=
        `<span class="morphology-word" ` +
        `data-word="${escapeAttribute(word)}" ` +
        `data-lemma="${escapeAttribute(lemma)}" ` +
        `data-strongs="${escapeAttribute(strongsId)}" ` +
        `data-gloss="${escapeAttribute(gloss)}" ` +
        `data-transliteration="${escapeAttribute(transliteration)}" ` +
        `data-parsing="${escapeAttribute(parsing)}" ` +
        `data-language="${morph.language || "greek"}">${word}</span>`;

      // Add space except after last word
      if (idx < sorted.length - 1) {
        html += " ";
      }
    });

    return html;
  }

  function escapeAttribute(value: string): string {
    return (value || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Strip Hebrew cantillation marks and vowel points for text comparison
  function stripHebrewDiacritics(text: string): string {
    // Remove Hebrew cantillation marks (U+0591 to U+05AF)
    // Remove Hebrew vowel points (U+05B0 to U+05BD, U+05BF to U+05C2, U+05C4, U+05C5, U+05C7)
    // Keep consonants and maqqef (־)
    return text
      .replace(/[\u0591-\u05AF]/g, "") // Cantillation marks
      .replace(/[\u05B0-\u05BD\u05BF-\u05C2\u05C4\u05C5\u05C7]/g, "") // Vowel points
      .normalize("NFC");
  }

  // Morphology helper: find morphology data for clicked word
  function findMorphologyForClick(
    verseMorphs: DBMorphology[] | undefined,
    clickedIndex: number,
    clickedText: string,
    isIndexed: boolean,
  ): DBMorphology | null {
    if (!verseMorphs || verseMorphs.length === 0) {
      if (DEBUG_MORPHOLOGY) morphStats.misses++;
      return null;
    }

    morphStats.totalLookups++;

    // Primary: try word_index match (for v2+ packs)
    if (isIndexed) {
      const byIndex = verseMorphs.find((m) => m.word_index === clickedIndex);
      if (byIndex) {
        morphStats.hits++;
        morphStats.indexMatches++;
        if (DEBUG_MORPHOLOGY) {
          console.log(
            `✅ Morphology match by word_index: ${clickedIndex}`,
            byIndex,
          );
        }
        return byIndex;
      }
    }

    // Fallback: try text match (exact)
    let byText = verseMorphs.find((m) => m.text === clickedText);
    if (byText) {
      morphStats.hits++;
      morphStats.textFallback++;
      if (DEBUG_MORPHOLOGY) {
        console.log(`✅ Morphology match by text: "${clickedText}"`, byText);
      }
      return byText;
    }

    // Second fallback: try text match without Hebrew diacritics
    const strippedClickedText = stripHebrewDiacritics(clickedText);
    byText = verseMorphs.find(
      (m) => stripHebrewDiacritics(m.text) === strippedClickedText,
    );
    if (byText) {
      morphStats.hits++;
      morphStats.textFallback++;
      if (DEBUG_MORPHOLOGY) {
        console.log(
          `✅ Morphology match by stripped text: "${clickedText}" → "${strippedClickedText}"`,
          byText,
        );
      }
      return byText;
    }

    morphStats.misses++;
    if (DEBUG_MORPHOLOGY) {
      console.log(
        `❌ No morphology match for index ${clickedIndex}, text "${clickedText}", stripped "${strippedClickedText}"`,
      );
      console.log(
        "   Available texts in verse:",
        verseMorphs.map((m) => m.text),
      );
    }
    return null;
  }

  // Segmentation helper: get word at click position
  function getClickWordInfo(
    clickX: number,
    clickY: number,
    verseText: string,
  ): { index: number; text: string } | null {
    // Get the character position from click coordinates
    const range = document.caretRangeFromPoint(clickX, clickY);
    if (!range) return null;

    const clickOffset = range.startOffset;

    // Segment verse text into words
    const hasSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl;

    if (hasSegmenter) {
      // Use Intl.Segmenter for robust Unicode word segmentation.
      // "und" (undetermined) uses Unicode default word-break rules without
      // English-specific tailoring, which correctly handles Greek, Hebrew,
      // and all other Unicode scripts.
      const segmenter = new (Intl as any).Segmenter("und", {
        granularity: "word",
      });
      const segments = Array.from(segmenter.segment(verseText));

      let wordIndex = 0;

      for (const segment of segments as any[]) {
        const segmentStart = segment.index;
        const segmentEnd = segment.index + segment.segment.length;

        // Check if click is within this segment
        if (clickOffset >= segmentStart && clickOffset < segmentEnd) {
          // Only count actual words (not whitespace/punctuation)
          if (segment.isWordLike) {
            return { index: wordIndex, text: segment.segment.normalize("NFC") };
          } else {
            return null;
          }
        }

        // Count word index for word-like segments
        if (segment.isWordLike) {
          wordIndex++;
        }
      }
    } else {
      // Fallback: Unicode-aware regex
      if (DEBUG_MORPHOLOGY && import.meta.env.DEV) {
        console.warn("⚠️ Intl.Segmenter not available, using regex fallback");
      }

      const words = Array.from(verseText.matchAll(/[\p{L}\p{M}]+/gu));

      for (let i = 0; i < words.length; i++) {
        const match = words[i];
        const start = match.index!;
        const end = start + match[0].length;

        if (clickOffset >= start && clickOffset < end) {
          return { index: i, text: match[0].normalize("NFC") };
        }
      }
    }

    return null;
  }

  async function loadChapter(
    translation: string,
    book: string,
    chapter: number,
    resetScroll = false,
    scrollToVerse: number | null = null,
  ) {
    console.log("📄 loadChapter called:", {
      translation,
      book,
      chapter,
      resetScroll,
    });
    console.log(
      "   Current chapters array before load:",
      chapters.map((c) => `${c.book} ${c.chapter}`),
    );

    loading = true;
    error = "";
    clearRepeats(); // Clear repeats when loading a new chapter
    try {
      const chapterVerses = await textStore.getChapter(
        translation,
        book,
        chapter,
      );

      console.log(`   Fetched ${chapterVerses?.length || 0} verses from DB`);

      if (!chapterVerses || chapterVerses.length === 0) {
        console.warn(`No verses found for ${translation} ${book} ${chapter}`);
        loading = false;
        return;
      }

      const chapterHeadingMap = await headingsStore.getChapterHeadings(book, chapter);
      const processedVerses = chapterVerses.map((v) => {
        const { heading, textWithoutHeading } = extractHeading(v.text);
        const hlEntry = chapterHeadingMap.get(v.verse);
        const finalHeading = heading || v.heading || hlEntry?.heading || null;
        return {
          verse: v.verse,
          text: textWithoutHeading,
          html: renderVerseHtml(textWithoutHeading),
          heading: finalHeading,
          headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
        };
      });

      console.log(`   Processed ${processedVerses.length} verses`);
      console.log(
        `   First verse text: "${processedVerses[0]?.text.substring(0, 50)}..."`,
      );

      // Reset chapters array and scroll to top
      chapters = [{ book, chapter, verses: processedVerses }];

      console.log(
        "   Chapters array AFTER assignment:",
        chapters.map(
          (c) => `${c.book} ${c.chapter} (${c.verses.length} verses)`,
        ),
      );

      // Load morphology cache if original language translation
      if (isOriginalLanguage(translation)) {
        await loadMorphologyCache(translation, book, chapter);
      } else {
        // Clear morphology cache for non-original-language translations
        morphologyCache.clear();
        isIndexedPack = false;
      }

      // Load annotation data (commentary + TSK references)
      await loadAnnotations(book, chapter);

      // Load and apply persisted highlights
      await loadAndApplyHighlights(book, chapter);

      if (resetScroll && readerElement) {
        // Set flag BEFORE tick so any clamp-induced scroll event is consumed
        scrollResetPending = true;
        await tick(); // flush DOM so scrollHeight reflects the new single-chapter content
        lastScrollTop = 0;
        readerElement.scrollTop = 0; // direct assignment — always instant, ignores scroll-behavior CSS
        if (scrollToVerse != null) {
          const verseEl = readerElement.querySelector(
            `.verse[data-verse="${scrollToVerse}"]`,
          ) as HTMLElement | null;
          if (verseEl) {
            scrollToVerseEl(verseEl);
          }
          navigationStore.clearScrollTarget();
        }
        const rpTarget = $navigationStore.readingPlanActiveTarget;
        if (rpTarget && rpTarget.book === book && rpTarget.chapter === chapter) {
          _lastRpTargetKey = `${rpTarget.book}-${rpTarget.chapter}-${rpTarget.verse ?? 'null'}`;
          await applyReadingPlanHighlight();
        }
      }
    } catch (err: unknown) {
      console.error("Error loading chapter:", err);
      error = `Failed to load ${book} ${chapter}. Make sure you have packs installed.`;
      chapters = [];
    } finally {
      loading = false;
    }
  }

  function clearReadingPlanHighlight(): void {
    readerElement?.querySelectorAll('.rp-verse-highlight').forEach(el => {
      el.classList.remove('rp-verse-highlight');
      (el as HTMLElement).style.removeProperty('--rp-hl-left');
    });
  }

  async function applyReadingPlanHighlight(): Promise<void> {
    await tick();
    const target = $navigationStore.readingPlanActiveTarget;
    if (!readerElement) return;
    clearReadingPlanHighlight();
    let verseEl: HTMLElement | null = null;
    if (target?.verse != null) {
      verseEl = readerElement.querySelector(`.verse[data-verse="${target.verse}"]`) as HTMLElement | null;
    } else {
      verseEl = readerElement.querySelector('.verse') as HTMLElement | null;
    }
    if (!verseEl) return;
    const textEl = verseEl.querySelector('.verse-text') as HTMLElement | null;
    const leftOffset = textEl ? textEl.offsetLeft : 32;
    verseEl.style.setProperty('--rp-hl-left', `${leftOffset}px`);
    verseEl.classList.add('rp-verse-highlight');
  }

  async function loadAndApplyHighlights(book: string, chapter: number) {
    try {
      const [vHl, wHl] = await Promise.all([
        userDataStore.getChapterHighlights(book, chapter),
        userDataStore.getChapterWordHighlights(book, chapter),
      ]);
      chapterVerseHighlights = vHl;
      chapterWordHighlights = wHl;
      await tick();
      if (!readerElement) return;
      const section = readerElement.querySelector<HTMLElement>(
        `[data-chapter-section][data-book="${book}"][data-chapter="${chapter}"]`
      );
      if (section) {
        applyChapterHighlights(section, vHl, wHl, currentTranslation);
      }
    } catch (err) {
      console.warn('[Highlights] load error:', err);
    }
  }

  async function loadAnnotations(book: string, chapter: number) {
    allCommentaryEntries = [];
    tskByVerse = new Map<number, TskEntry[]>();
    commentaryByVerse = new Map<number, CommentaryEntry[]>();
    try {
      // Load all data unconditionally — display is controlled reactively by showReferences / selectedCommentaryAuthors
      const [entries, tsk] = await Promise.all([
        commentaryStore.getChapterCommentary(book, chapter),
        tskStore.getChapterReferences(book, chapter),
      ]);
      allCommentaryEntries = entries;
      tskByVerse = tsk;
      rebuildCommentaryByVerse();
    } catch (err) {
      console.warn("Annotation load error:", err);
    }
    // Load user verse notes for this chapter
    await loadVerseNotes(book, chapter);
  }

  async function loadVerseNotes(book: string, chapter: number) {
    try {
      const notes = await userDataStore.getNotes();
      const map = new Map<number, string>();
      for (const note of notes) {
        if (note.reference.book === book && note.reference.chapter === chapter && note.text?.trim()) {
          map.set(note.reference.verse, note.id);
        }
      }
      verseNotesMap = map;
    } catch (err) {
      console.warn("[Notes] load error:", err);
    }
  }

  function getNotePosition(book: string, chapter: number, verse: number): { x: number; y: number; w: number; h: number } {
    const key = `verse-note-pos-${book}-${chapter}-${verse}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    // Default: centered on screen
    return {
      x: Math.max(0, Math.round((window.innerWidth - 320) / 2)),
      y: Math.max(0, Math.round((window.innerHeight - 240) / 2)),
      w: 320,
      h: 240,
    };
  }

  async function openNotePopup(verse: number, book: string, chapter: number) {
    const profile = $userProfileStore;
    if (!profile.isSignedIn) {
      profileModalStore.open();
      return;
    }
    try {
      const notes = await userDataStore.getNotes({ book, chapter, verse });
      const existing = notes[0] ?? null;
      const pos = getNotePosition(book, chapter, verse);
      notePopupBook = book;
      notePopupChapter = chapter;
      notePopupVerse = verse;
      notePopupContent = existing?.text ?? '';
      notePopupNoteId = existing?.id ?? null;
      notePopupX = pos.x;
      notePopupY = pos.y;
      notePopupW = pos.w;
      notePopupH = pos.h;
      notePopupOpen = true;
    } catch (err) {
      console.error("[Notes] open error:", err);
    }
  }

  function handleNoteSaved(e: CustomEvent<{ book: string; chapter: number; verse: number; noteId: string }>) {
    const { book, chapter, verse, noteId } = e.detail;
    if (book === currentBook && chapter === currentChapter) {
      verseNotesMap.set(verse, noteId);
      verseNotesMap = verseNotesMap; // trigger Svelte reactivity
    }
  }

  function handleNoteDeleted(e: CustomEvent<{ book: string; chapter: number; verse: number }>) {
    const { book, chapter, verse } = e.detail;
    if (book === currentBook && chapter === currentChapter) {
      verseNotesMap.delete(verse);
      verseNotesMap = verseNotesMap; // trigger Svelte reactivity
    }
  }

  function getTranslationFontClass(id: string): string {
    const t = (id || '').toLowerCase();
    if (t === 'kjv' || t === 'kjvpce') return 'translation-font-kjv';
    if (t === 'web' || t === 'bsb') return 'translation-font-web';
    // Greek source texts
    const looksEnglish = t.includes('english') || t.includes('brenton');
    if (t === 'byz' || t === 'tr') return 'translation-font-greek';
    if (t.includes('gnt') || t.includes('sblgnt') || t.includes('opengnt')) return 'translation-font-greek';
    if (t.includes('greek')) return 'translation-font-greek';
    const isLxx = t.includes('lxx') || t.includes('septuagint');
    if (isLxx && !looksEnglish) return 'translation-font-greek';
    return '';
  }

  function openAnnotationPanel(verse: number, tab: "references" | "commentary", book = currentBook, chapter = currentChapter) {
    annotationPanelVerse = verse;
    annotationPanelBook = book;
    annotationPanelChapter = chapter;
    annotationPanelTab = tab;
    annotationPanelTsk = tskByVerse.get(verse) ?? [];
    annotationPanelCommentary = commentaryByVerse.get(verse) ?? [];
    annotationPanelOpen = true;
  }

  async function loadMorphologyCache(
    translation: string,
    book: string,
    chapter: number,
  ) {
    try {
      morphologyCache.clear();

      console.log(
        `🔤 Loading morphology for ${translation} ${book} ${chapter}...`,
      );

      // Query morphology store for entire chapter
      const { openDB } = await import("../adapters/db");
      const db = await openDB();

      const transaction = db.transaction("morphology", "readonly");
      const store = transaction.objectStore("morphology");
      const index = store.index("verse_ref");

      // Normalise the display translation ID to match what ancient-languages.sqlite
      // stores in its words table (always lowercase).
      // e.g. 'BYZ' → 'byz', 'HEBREW-OSHB' → 'hebrew-oshb'
      const MORPH_ID_ALIAS: Record<string, string> = {
        SBLGNT: 'sblgnt',
      };
      const morphTranslation = MORPH_ID_ALIAS[translation] ?? translation.toLowerCase();

      // Query for all verses in this chapter (verse 1-999)
      const range = IDBKeyRange.bound(
        [morphTranslation, book, chapter, 1],
        [morphTranslation, book, chapter, 999],
      );

      const results: DBMorphology[] = await new Promise((resolve, reject) => {
        const entries: DBMorphology[] = [];
        const request = index.openCursor(range);

        request.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest).result;
          if (cursor) {
            entries.push(cursor.value);
            cursor.continue();
          } else {
            resolve(entries);
          }
        };
        request.onerror = () => reject(request.error);
      });

      // Organize by verse number
      results.forEach((morphEntry) => {
        const verseNum = morphEntry.verse;
        if (!morphologyCache.has(verseNum)) {
          morphologyCache.set(verseNum, []);
        }
        morphologyCache.get(verseNum)!.push(morphEntry);
      });

      // Detect if pack is indexed (schema version 2+)
      // Check if first entry has word_index field
      const firstEntry = results[0];
      isIndexedPack = firstEntry && typeof firstEntry.word_index === "number";

      console.log(
        `   ✅ Loaded ${results.length} morphology entries, ${morphologyCache.size} verses cached`,
      );
      console.log(
        `   📊 Pack type: ${isIndexedPack ? "Indexed (v2+)" : "Legacy (v1)"}`,
      );
    } catch (err) {
      console.warn("Failed to load morphology cache:", err);
      morphologyCache.clear();
      isIndexedPack = false;
    }
  }

  async function verifyAndLoadChapter(
    translation: string,
    book: string,
    chapter: number,
    scrollToVerse: number | null = null,
  ) {
    // Try to load the requested chapter
    const verses = await textStore.getChapter(translation, book, 1);

    if (!verses || verses.length === 0) {
      console.warn(`⚠️ Book "${book}" not found in ${translation}`);

      // Determine fallback book based on translation type
      const bookInfo = BIBLE_BOOKS.find((b) => b.name === book);
      const isNTBook = bookInfo?.testament === "NT";

      let fallbackBook = "Genesis";
      let fallbackChapter = 1;

      // WLC, LXX only have OT
      if (translation === "WLC" || translation === "LXX") {
        fallbackBook = "Genesis";
        fallbackChapter = 1;
      }
      // BYZ, TR only have NT
      else if (translation === "BYZ" || translation === "TR") {
        fallbackBook = "Matthew";
        fallbackChapter = 1;
      }
      // Full Bible translations
      else {
        // If we were in NT and switching to OT-only, go to Genesis
        // If we were in OT and switching to NT-only, go to Matthew
        fallbackBook = isNTBook ? "Matthew" : "Genesis";
        fallbackChapter = 1;
      }

      console.log(`📍 Falling back to ${fallbackBook} ${fallbackChapter}`);

      // Update navigation store to reflect the fallback
      navigationStore.navigateTo(translation, fallbackBook, fallbackChapter);
    } else {
      // Book exists, load normally
      loadChapter(translation, book, chapter, true, scrollToVerse);
    }
  }

  async function loadAvailableTranslations() {
    try {
      const translations = await textStore.getTranslations();

      if (translations.length > 0) {
        const translationIds = translations.map((t) => t.id);
        availableTranslations.set(translationIds);

        // If current translation not available, switch to first one
        const currentTransUpper = currentTranslation.toUpperCase();
        const match = translations.find(
          (t) => t.id.toUpperCase() === currentTransUpper,
        );

        if (!match) {
          navigationStore.setTranslation(translations[0].id);
        }

        // NOTE: Auto-loading from /public is disabled
        // Users should install packs via the Packs pane (consolidated packs from GitHub Releases)
        
        if (translations.length === 0) {
          console.log("💡 No translations installed. Please use the Packs pane to install the 'English Translations' pack.");
        }
      } else {
        // No translations found
        console.log("💡 No translations installed. Please use the Packs pane to install packs.");
      }
    } catch (err: unknown) {
      console.error("Error loading translations:", err);
    }
  }

  let autoLoadAttempts = 0;
  const MAX_AUTO_LOAD_ATTEMPTS = 1;

  // @ts-expect-error - Unused function kept for backward compatibility
  async function _autoLoadFromPublic(_clearFirst: boolean) {
    // Prevent infinite retry loop
    if (autoLoadAttempts >= MAX_AUTO_LOAD_ATTEMPTS) {
      console.warn("⚠️ Auto-load already attempted, skipping to avoid infinite loop");
      console.log("💡 Please use the Packs pane to install translations manually");
      return;
    }
    
    autoLoadAttempts++;
    console.log("Loading additional packs...");

    try {
      const { importPackFromUrl } = await import("../adapters/pack-import");

      // Load all translation packs from public directory
      const packsToLoad = [
        "bsb.sqlite",
        "kjv.sqlite",
        "web.sqlite",
        "net.sqlite",
        "lxx2012-english.sqlite",
        "byz-full.sqlite",
        "tr-full.sqlite",
        "lxx-greek.sqlite",
        "hebrew-oshb.sqlite",
      ];

      let loaded = 0;
      let failed = 0;

      for (const packFile of packsToLoad) {
        try {
          console.log(`Loading ${packFile}...`);
          await importPackFromUrl(`/${packFile}`);
          loaded++;
        } catch (err) {
          failed++;
          const errMsg = `Failed to load ${packFile}: ${err instanceof Error ? err.message : String(err)}`;
          console.warn(errMsg);
        }
      }

      console.log(`Loaded ${loaded} packs, ${failed} failed`);

      // Reload translations and debug info (but won't trigger another autoLoad)
      await loadAvailableTranslations();
    } catch (err) {
      const errMsg = `Failed to load translations: ${err instanceof Error ? err.message : String(err)}`;
      console.error(errMsg);
    }
  }

  async function loadChronologicalPack() {
    try {
      // Chronological data is now in the study-tools pack, not a JSON file
      const { readTransaction, openDB } = await import('../adapters/db.js');
      
      // Check if study-tools pack is installed
      const pack = await readTransaction('packs', (store) => 
        store.get('study-tools') || store.get('consolidated-study-tools')
      );
      
      if (!pack) {
        console.log('Study tools pack not installed - chronological mode unavailable');
        return;
      }
      
      // Query chronological_order table from IndexedDB
      const db = await openDB();
      const chronoData = await new Promise<any[]>((resolve) => {
        const tx = db.transaction('chronological_order', 'readonly');
        const store = tx.objectStore('chronological_order');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      
      if (chronoData.length > 0) {
        // Transform to expected format
        chronologicalData = {
          verse_count: chronoData.length,
          verses: chronoData
        };
        console.log(`Loaded chronological pack: ${chronologicalData.verse_count} entries`);
      }
    } catch (e) {
      console.warn('Chronological pack not available:', e);
    }
  }

  // Returns the book/chapter of the chapter section most visible in the reader viewport
  function detectVisibleChapter(): { book: string; chapter: number } | null {
    if (!readerElement) return null;
    const sections = readerElement.querySelectorAll<HTMLElement>('[data-chapter-section]');
    if (sections.length === 0) return null;
    const readerTop = readerElement.scrollTop;
    const readerBottom = readerTop + readerElement.clientHeight;
    let bestBook = '';
    let bestChapter = 0;
    let bestVisible = -1;
    sections.forEach(el => {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      const visibleTop = Math.max(top, readerTop);
      const visibleBottom = Math.min(bottom, readerBottom);
      const visible = Math.max(0, visibleBottom - visibleTop);
      if (visible > bestVisible) {
        bestVisible = visible;
        bestBook = el.dataset.book || '';
        bestChapter = Number(el.dataset.chapter) || 0;
      }
    });
    return bestBook ? { book: bestBook, chapter: bestChapter } : null;
  }

  function saveScrollPosition() {
    // Only save for the main reader (not windowed panes — they have their own contentState)
    if (windowId) return;
    const visible = detectVisibleChapter();
    if (!visible) return;
    try {
      const nav = get(navigationStore);
      localStorage.setItem('projectbible_nav', JSON.stringify({
        translation: currentTranslation,
        book: visible.book,
        chapter: visible.chapter,
        isChronologicalMode,
        showReferences: nav.showReferences ?? false,
        showCommentaries: nav.showCommentaries ?? false,
        selectedCommentaryAuthors: nav.selectedCommentaryAuthors ?? [],
      }));
    } catch {
      // ignore quota / private-browsing errors
    }
  }

  function startScrollDetection() {
    // Clean up any existing listener first
    if (scrollHandler && readerElement) {
      readerElement.removeEventListener("scroll", scrollHandler);
      scrollHandler = null;
    }

    if (!readerElement) {
      return;
    }

    // Create scroll handler with proper reference
    scrollHandler = () => {
      if (!readerElement) return;

      // Consume the synthetic scroll event fired by our own scrollTop=0 reset on navigation
      if (scrollResetPending) {
        scrollResetPending = false;
        lastScrollTop = 0; // scrollTop is 0 after reset — anchor here so first user scroll has correct delta
        return;
      }

      const scrollTop = readerElement.scrollTop;
      const scrollPosition = scrollTop + readerElement.clientHeight;
      const scrollHeight = readerElement.scrollHeight;
      const scrollDelta = scrollTop - lastScrollTop;

      // Update navbar offset based on scroll - it moves with the content
      if (scrollTop < 5) {
        // Near top - always fully visible
        navBarOffset = 0;
      } else if (scrollDelta > 0) {
        // Scrolling down - move navbar up (hide it)
        navBarOffset = Math.max(-68, navBarOffset - scrollDelta);
      } else if (scrollDelta < 0) {
        // Scrolling up - move navbar down (show it)
        navBarOffset = Math.min(0, navBarOffset - scrollDelta);
      }

      lastScrollTop = scrollTop;

      // Load previous chapter when near the top.
      // scrollDelta <= 0: ignore downward synthetic events from our own scrollTop correction.
      // !loading: ignore scroll events that fire during a navigation reset (loadChapter sets loading=true).
      if (scrollTop <= 200 && scrollDelta <= 0 && !isLoadingPrevChapter && !loading) {
        loadPreviousChapter();
      }

      // Check for loading next chapter.
      // !loading: same guard — don't auto-load adjacent chapter mid-navigation.
      if (scrollPosition >= scrollHeight - 200 && !isLoadingNextChapter && !loading) {
        loadNextChapter();
      }

      // Save scroll position after user stops scrolling (debounced)
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveScrollPosition, 500);
    };

    // Attach scroll event listener
    readerElement.addEventListener("scroll", scrollHandler, { passive: true });
  }

  function stopScrollDetection() {
    // Remove event listener properly
    if (scrollHandler && readerElement) {
      readerElement.removeEventListener("scroll", scrollHandler);
      scrollHandler = null;
    }
  }

  async function loadNextChapter() {
    if (isLoadingNextChapter || chapters.length === 0) return;
    isLoadingNextChapter = true;

    try {
      const lastChapter = chapters[chapters.length - 1];
      let nextBook = lastChapter.book;
      let nextChapter = lastChapter.chapter + 1;

      console.log(
        "loadNextChapter - isChronologicalMode:",
        isChronologicalMode,
      );
      console.log(
        "loadNextChapter - chronologicalData loaded:",
        !!chronologicalData,
      );
      console.log(
        "loadNextChapter - current:",
        lastChapter.book,
        lastChapter.chapter,
      );

      if (isChronologicalMode && chronologicalData) {
        console.log("Using chronological order...");
        // Find the LAST verse of the current chapter in chronological order
        const currentChapterVerses = chronologicalData.verses.filter(
          (v: any) =>
            v.book === lastChapter.book && v.chapter === lastChapter.chapter,
        );

        console.log(
          "Found",
          currentChapterVerses.length,
          "verses for current chapter",
        );

        if (currentChapterVerses.length > 0) {
          // Get the highest chrono_index for this chapter
          const lastVerseIndex = Math.max(
            ...currentChapterVerses.map((v: any) => v.chrono_index),
          );

          console.log("Last verse index of current chapter:", lastVerseIndex);

          // Find the next chapter after this index
          const nextChapterData = chronologicalData.verses.find(
            (v: any) =>
              v.chrono_index > lastVerseIndex &&
              (v.book !== lastChapter.book ||
                v.chapter !== lastChapter.chapter),
          );

          if (nextChapterData) {
            nextBook = nextChapterData.book;
            nextChapter = nextChapterData.chapter;
            console.log("Next chapter in chrono order:", nextBook, nextChapter);
          } else {
            // Loop back to beginning
            nextBook = chronologicalData.verses[0].book;
            nextChapter = chronologicalData.verses[0].chapter;
            console.log("Looping to start:", nextBook, nextChapter);
          }
        }
      } else {
        console.log("Using canonical order...");
        const bookInfo = BIBLE_BOOKS.find((b) => b.name === lastChapter.book);
        if (bookInfo && nextChapter > bookInfo.chapters) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(
            (b) => b.name === lastChapter.book,
          );
          if (currentBookIndex < BIBLE_BOOKS.length - 1) {
            nextBook = BIBLE_BOOKS[currentBookIndex + 1].name;
            nextChapter = 1;
          } else {
            // Loop back to Genesis 1
            nextBook = BIBLE_BOOKS[0].name;
            nextChapter = 1;
          }
        }
      }

      // Check if already loaded
      if (
        chapters.some((c) => c.book === nextBook && c.chapter === nextChapter)
      ) {
        isLoadingNextChapter = false;
        return;
      }

      const nextVerses = await textStore.getChapter(
        currentTranslation,
        nextBook,
        nextChapter,
      );

      if (nextVerses.length > 0) {
        const nextHeadingMap = await headingsStore.getChapterHeadings(nextBook, nextChapter);
        const processedVerses = nextVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          const hlEntry = nextHeadingMap.get(v.verse);
          const finalHeading = heading || v.heading || hlEntry?.heading || null;
          return {
            verse: v.verse,
            text: textWithoutHeading,
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
          };
        });

        // Append without triggering navigation update
        chapters = [
          ...chapters,
          { book: nextBook, chapter: nextChapter, verses: processedVerses },
        ];
      }
    } catch (err) {
      console.error("Error loading next chapter:", err);
    } finally {
      isLoadingNextChapter = false;
    }
  }

  async function loadPreviousChapter() {
    if (isLoadingPrevChapter || chapters.length === 0) return;
    isLoadingPrevChapter = true;

    try {
      const firstChapter = chapters[0];
      let prevBook = firstChapter.book;
      let prevChapter = firstChapter.chapter - 1;

      if (isChronologicalMode && chronologicalData) {
        // Find the FIRST verse of the current chapter in chronological order
        const currentChapterVerses = chronologicalData.verses.filter(
          (v: any) =>
            v.book === firstChapter.book && v.chapter === firstChapter.chapter,
        );

        if (currentChapterVerses.length > 0) {
          // Get the lowest chrono_index for this chapter
          const firstVerseIndex = Math.min(
            ...currentChapterVerses.map((v: any) => v.chrono_index),
          );

          // Find previous chapter before this index
          const prevChapterData = chronologicalData.verses
            .slice()
            .reverse()
            .find(
              (v: any) =>
                v.chrono_index < firstVerseIndex &&
                (v.book !== firstChapter.book ||
                  v.chapter !== firstChapter.chapter),
            );

          if (prevChapterData) {
            prevBook = prevChapterData.book;
            prevChapter = prevChapterData.chapter;
          } else {
            // Loop to end
            const lastVerse =
              chronologicalData.verses[chronologicalData.verses.length - 1];
            prevBook = lastVerse.book;
            prevChapter = lastVerse.chapter;
          }
        }
      } else {
        if (prevChapter < 1) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(
            (b) => b.name === firstChapter.book,
          );
          if (currentBookIndex > 0) {
            const prevBookInfo = BIBLE_BOOKS[currentBookIndex - 1];
            prevBook = prevBookInfo.name;
            prevChapter = prevBookInfo.chapters;
          } else {
            // Loop to Revelation 22
            const lastBook = BIBLE_BOOKS[BIBLE_BOOKS.length - 1];
            prevBook = lastBook.name;
            prevChapter = lastBook.chapters;
          }
        }
      }

      // Check if already loaded
      if (
        chapters.some((c) => c.book === prevBook && c.chapter === prevChapter)
      ) {
        isLoadingPrevChapter = false;
        return;
      }

      const prevVerses = await textStore.getChapter(
        currentTranslation,
        prevBook,
        prevChapter,
      );

      if (prevVerses.length > 0) {
        const prevHeadingMap = await headingsStore.getChapterHeadings(prevBook, prevChapter);
        const processedVerses = prevVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          const hlEntry = prevHeadingMap.get(v.verse);
          const finalHeading = heading || v.heading || hlEntry?.heading || null;
          return {
            verse: v.verse,
            text: textWithoutHeading,
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
          };
        });

        // Remember scroll position
        const oldScrollHeight = readerElement.scrollHeight;

        // Prepend without triggering navigation update
        chapters = [
          { book: prevBook, chapter: prevChapter, verses: processedVerses },
          ...chapters,
        ];

        // Wait for Svelte to flush DOM updates, then correct scroll position
        // synchronously. Using await tick() instead of rAF ensures:
        //  1. newScrollHeight is always the post-prepend value (no stale reads)
        //  2. isLoadingPrevChapter stays true until AFTER correction (no re-entry)
        await tick();
        if (readerElement) {
          const newScrollHeight = readerElement.scrollHeight;
          readerElement.scrollTop =
            readerElement.scrollTop + (newScrollHeight - oldScrollHeight);
        }
      }
    } catch (err) {
      console.error("Error loading previous chapter:", err);
    } finally {
      isLoadingPrevChapter = false;
    }
  }

  // Text selection handlers
  function handleTextInteraction(e: MouseEvent | TouchEvent) {
    const target = e.target as HTMLElement;

    // Ignore if clicking on note, navigation bar, or any button/dropdown
    if (target.closest(".inline-note")) return;
    if (target.closest(".navigation-bar")) return;
    if (target.closest("button")) return;
    if (target.closest(".nav-dropdown")) return;
    if (target.closest(".toast")) return;

    // Start long press timer for touch
    if (e.type === "touchstart") {
      // DO NOT preventDefault here - allow native scrolling
      const touch = (e as TouchEvent).touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      hasMoved = false;

      longPressTimer = window.setTimeout(() => {
        // Only trigger selection if user hasn't moved (scrolled)
        if (!hasMoved && touchStartPos) {
          handleTextSelection(touchStartPos.x, touchStartPos.y, target);
        }
      }, 500); // Reduced from 900ms to 500ms for better UX
    }
  }

  function handleTouchMove(e: TouchEvent) {
    // Track if user is scrolling
    if (touchStartPos && !hasMoved) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartPos.x);
      const deltaY = Math.abs(touch.clientY - touchStartPos.y);

      // If moved more than 10px, consider it scrolling
      if (deltaX > 10 || deltaY > 10) {
        hasMoved = true;
        // Cancel long press timer since user is scrolling
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    }
  }

  function handleTouchEnd(_e: TouchEvent) {
    // Cancel long press if finger lifted before timer fires
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    touchStartPos = null;
    hasMoved = false;
  }

  function handleMouseMove(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Clear any previous hover
    if (hoveredWordElement) {
      hoveredWordElement.classList.remove("word-hover");
      hoveredWordElement = null;
    }

    // Don't hover when dragging or when toast is open
    if (isDragging || showToast) return;

    // Ignore special elements
    if (target.closest(".inline-note")) return;
    if (target.closest(".toast")) return;
    if (target.closest(".navigation-bar")) return;
    if (target.closest("button")) return;

    // Only handle if hovering over verse text
    const verseText = target.closest(".verse-text");
    if (!verseText) return;

    // Get the word at cursor position
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    let textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(
        textNode,
        NodeFilter.SHOW_TEXT,
        null,
      );
      const firstText = walker.nextNode();
      if (firstText) textNode = firstText;
      else return;
    }

    const text = textNode.textContent || "";
    const offset = range.startOffset;
    const wordBounds = getWordBounds(text, offset);

    if (wordBounds) {
      const word = text.substring(wordBounds.start, wordBounds.end).trim();
      if (word.length > 0) {
        // Create temporary highlight for hover
        try {
          const hoverRange = document.createRange();
          hoverRange.setStart(textNode, wordBounds.start);
          hoverRange.setEnd(textNode, wordBounds.end);

          // Wrap the word temporarily
          const span = document.createElement("span");
          span.className = "word-hover";
          const contents = hoverRange.extractContents();
          span.appendChild(contents);
          hoverRange.insertNode(span);
          hoveredWordElement = span;
        } catch (err) {
          // Silently fail if can't create hover
        }
      }
    }
  }

  function handleTextClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Ignore if clicking on note
    if (target.closest(".inline-note")) return;

    // Ignore if clicking on toast or drag handles
    if (target.closest(".toast") || target.closest(".drag-handle")) return;

    // Only handle if clicking inside verse text
    if (!target.closest(".verse-text")) return;

    // Clear hover highlight before selecting (unwrap the span)
    if (hoveredWordElement) {
      const parent = hoveredWordElement.parentNode;
      while (hoveredWordElement.firstChild) {
        parent?.insertBefore(hoveredWordElement.firstChild, hoveredWordElement);
      }
      parent?.removeChild(hoveredWordElement);
      hoveredWordElement = null;

      // Normalize the parent to merge adjacent text nodes
      parent?.normalize();
    }

    // After unwrapping, get the element at the click position
    const elementAtPoint = document.elementFromPoint(
      e.clientX,
      e.clientY,
    ) as HTMLElement;

    // Handle click - mouse clicks work immediately
    handleTextSelection(e.clientX, e.clientY, elementAtPoint || target);
  }

  function handleTextSelection(x: number, y: number, target: HTMLElement) {
    // Find the verse text container
    const verseText = target.closest(".verse-text");
    if (!verseText) return;

    // Get verse number from parent verse element
    const verseElement = target.closest(".verse") as HTMLElement;
    const verseNum = verseElement
      ?.querySelector(".verse-number")
      ?.textContent?.trim();
    const verseNumInt = verseNum ? parseInt(verseNum) : null;

    // Check if this is an original language translation
    if (isOriginalLanguage(currentTranslation)) {
      // Greek/Hebrew word click detection
      if (!verseNumInt) return;

      const fullVerseText = verseText.textContent || "";
      const clickInfo = getClickWordInfo(x, y, fullVerseText);

      if (!clickInfo) {
        if (DEBUG_MORPHOLOGY) {
          console.log("❌ Could not determine clicked word");
        }
        return;
      }

      // Look up morphology from cache
      const morph = findMorphologyForClick(
        morphologyCache.get(verseNumInt),
        clickInfo.index,
        clickInfo.text,
        isIndexedPack,
      );

      // Always show toast — same as English words.
      // Morphology may be null (pack not installed / not yet imported); the
      // user can still Highlight, Search, Notes, etc.
      selectedText = clickInfo.text;
      selectedMorphology = morph;
      selectedVerseNumber = verseNumInt;

      if (!morph && DEBUG_MORPHOLOGY) {
        console.log("ℹ️ No morphology data available for this word");
      }

      // Clear any browser text selection
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();

      showToastAt(x, y);
      return;
    }

    // For English translations, use existing word-boundary detection
    const selection = window.getSelection();
    if (!selection) return;

    // Clear any existing selection
    selection.removeAllRanges();

    // Use document.caretRangeFromPoint to get the exact position
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return;

    // Get the text node at click position
    let textNode = range.startContainer;

    // If we clicked on an element, try to get its text content
    if (textNode.nodeType !== Node.TEXT_NODE) {
      // Try to find a text node child
      const walker = document.createTreeWalker(
        textNode,
        NodeFilter.SHOW_TEXT,
        null,
      );
      const firstText = walker.nextNode();
      if (firstText) {
        textNode = firstText;
      } else {
        return; // No text to select
      }
    }

    const text = textNode.textContent || "";
    if (!text.trim()) return;

    const offset = range.startOffset;
    const wordBounds = getWordBounds(text, offset);

    if (wordBounds) {
      selectedText = text.substring(wordBounds.start, wordBounds.end).trim();

      if (!selectedText) return;

      // Create selection range
      try {
        const newRange = document.createRange();
        newRange.setStart(textNode, wordBounds.start);
        newRange.setEnd(textNode, wordBounds.end);
        selectionRange = newRange;

        // Highlight the selection
        highlightSelection(newRange, selectionMode);

        // Show toast
        showToastAt(x, y);
      } catch (err) {
        console.error("Error creating selection range:", err);
        // Silently fail - just don't show selection
      }
    }
  }

  // @ts-expect-error - Unused function kept for potential future use
  function _getClickOffset(element: HTMLElement, x: number): number {
    const range = document.caretRangeFromPoint(x, 0);
    if (range && range.startContainer === element.firstChild) {
      return range.startOffset;
    }
    return 0;
  }

  function getWordBounds(
    text: string,
    offset: number,
  ): { start: number; end: number } | null {
    // Find word boundaries — use Unicode-aware test so Greek and Hebrew
    // characters (and combining marks) are treated as word characters.
    const isWordChar = (ch: string) => /[\p{L}\p{M}\p{N}]/u.test(ch);

    let start = offset;
    let end = offset;

    // Expand left
    while (start > 0 && isWordChar(text[start - 1])) {
      start--;
    }

    // Expand right
    while (end < text.length && isWordChar(text[end])) {
      end++;
    }

    if (start < end) {
      return { start, end };
    }

    return null;
  }

  function highlightSelection(range: Range, mode: "word" | "verse") {
    // Clear previous highlights
    clearHighlights();

    if (mode === "word") {
      // Use browser's native selection for highlighting (non-invasive)
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
      }

      // Create floating drag handles positioned absolutely
      const rects = range.getClientRects();
      // Handles are appended to .text-container (position:relative), so all
      // offsets must be relative to that element's bounding rect — not the
      // scrollable .bible-reader which sits above the NavBar.
      const textContainer = readerElement?.querySelector(".text-container");
      if (rects.length > 0 && textContainer) {
        const firstRect = rects[0];
        const lastRect = rects[rects.length - 1];
        const containerRect = textContainer.getBoundingClientRect();

        // Left handle at start of selection
        const leftHandle = document.createElement("div");
        leftHandle.className = "drag-handle-float left";
        leftHandle.style.position = "absolute";
        leftHandle.style.left = `${firstRect.left - containerRect.left}px`;
        leftHandle.style.top = `${firstRect.top - containerRect.top + textContainer.scrollTop}px`;
        leftHandle.style.height = `${firstRect.height}px`;
        leftHandle.addEventListener("mousedown", (e) => startDrag(e, "left"));
        leftHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, "left"),
          { passive: false },
        );

        // Right handle at end of selection
        const rightHandle = document.createElement("div");
        rightHandle.className = "drag-handle-float right";
        rightHandle.style.position = "absolute";
        rightHandle.style.left = `${lastRect.right - containerRect.left}px`;
        rightHandle.style.top = `${lastRect.top - containerRect.top + textContainer.scrollTop}px`;
        rightHandle.style.height = `${lastRect.height}px`;
        rightHandle.addEventListener("mousedown", (e) => startDrag(e, "right"));
        rightHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, "right"),
          { passive: false },
        );

        textContainer.appendChild(leftHandle);
        textContainer.appendChild(rightHandle);
        highlightedElements.push(leftHandle, rightHandle);
      }
    } else {
      // Highlight the entire verse
      const verseEl = range.startContainer.parentElement?.closest(".verse");
      if (verseEl) {
        verseEl.classList.add("verse-highlighted");
        highlightedElements.push(verseEl as HTMLElement);
        
        // Extract verse number for commentary
        const verseNumStr = verseEl.getAttribute("data-verse");
        if (verseNumStr) {
          selectedVerseNumber = parseInt(verseNumStr, 10);
        }
      }
    }
  }

  function clearSearchHighlight() {
    if (searchHighlightedElement) {
      searchHighlightedElement.classList.remove("search-verse-highlighted");
      searchHighlightedElement = null;
    }
  }

  async function applySearchHighlight(verseNumber: number) {
    clearSearchHighlight();
    await tick();

    const verseEl = readerElement?.querySelector(
      `.verse[data-verse="${verseNumber}"]`,
    ) as HTMLElement | null;

    if (!verseEl) return;

    verseEl.classList.add("search-verse-highlighted");
    searchHighlightedElement = verseEl;
    verseEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearHighlights() {
    // Clear browser selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Remove any DOM elements we added
    highlightedElements.forEach((el) => {
      if (el.classList.contains("verse-highlighted")) {
        el.classList.remove("verse-highlighted");
      } else if (!el.classList.contains("repeat-highlight")) {
        // Don't remove repeat highlights here - they have their own clear function
        el.remove();
      }
    });
    highlightedElements = highlightedElements.filter((el) =>
      el.classList.contains("repeat-highlight"),
    );
  }

  function startDrag(e: MouseEvent, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragEdge = edge;

    // Prevent toast from closing during drag
    document.addEventListener("mousemove", handleDrag, true);
    document.addEventListener("mouseup", stopDrag, true);
  }

  function handleDrag(e: MouseEvent) {
    if (!isDragging || !dragEdge || !selectionRange) return;

    // Get the position of the mouse
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    try {
      const newRange = selectionRange.cloneRange();

      if (dragEdge === "left") {
        // Expand/contract from the left
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setStart(range.startContainer, range.startOffset);
        }
      } else {
        // Expand/contract from the right
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setEnd(range.startContainer, range.startOffset);
        }
      }

      // Update selected text
      selectedText = newRange.toString().trim();

      if (selectedText) {
        // Clear and re-highlight
        selectionRange = newRange;
        highlightSelection(newRange, selectionMode);
      }
    } catch (err) {
      console.error("Error during drag:", err);
    }
  }

  function stopDrag() {
    isDragging = false;
    dragEdge = null;
    document.removeEventListener("mousemove", handleDrag, true);
    document.removeEventListener("touchmove", handleDragTouch, true);
    document.removeEventListener("mouseup", stopDrag, true);
    document.removeEventListener("touchend", stopDrag, true);
  }

  function startDragTouch(e: TouchEvent, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();

    // Cancel any long press
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    isDragging = true;
    dragEdge = edge;

    // Prevent toast from closing during drag
    document.addEventListener("touchmove", handleDragTouch, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", stopDrag, { capture: true });
  }

  function handleDragTouch(e: TouchEvent) {
    if (!isDragging || !dragEdge || !selectionRange) return;
    e.preventDefault();

    const touch = e.touches[0];
    if (!touch) return;

    // Get the position of the touch
    const range = document.caretRangeFromPoint(touch.clientX, touch.clientY);
    if (!range) return;

    try {
      const newRange = selectionRange.cloneRange();

      if (dragEdge === "left") {
        // Expand/contract from the left
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setStart(range.startContainer, range.startOffset);
        }
      } else {
        // Expand/contract from the right
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setEnd(range.startContainer, range.startOffset);
        }
      }

      // Update the selection text
      selectedText = newRange.toString().trim();

      if (selectedText) {
        selectionRange = newRange;
        highlightSelection(newRange, selectionMode);
      }
    } catch (err) {
      console.error("Error during touch drag:", err);
    }
  }

  function showToastAt(x: number, y: number) {
    // Clear any hover highlight
    if (hoveredWordElement) {
      hoveredWordElement.classList.remove("word-hover");
      hoveredWordElement = null;
    }

    // Position toast above the selection to avoid covering the word
    const toastHeight = 90; // Smaller toast now
    const toastWidth = 200;

    // Position above and centered on click
    toastX = Math.min(
      Math.max(x - toastWidth / 2, 10),
      window.innerWidth - toastWidth - 10,
    );
    toastY = Math.max(y - toastHeight - 15, 10); // 15px above selection (5px higher)

    // If too close to top, position below instead
    if (toastY < 70) {
      toastY = y + 30;
    }

    showToast = true;
    justOpenedToast = true;

    // Allow clickOutside to work after a short delay
    setTimeout(() => {
      justOpenedToast = false;
    }, 100);
  }

  function toggleRepeats(word: string) {
    // Normalize the word (lowercase, remove punctuation)
    const normalizedWord = word
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim();

    // If repeats is already active for this word, turn it off
    if (repeatsActive && repeatsWord === normalizedWord) {
      clearRepeats();
      return;
    }

    // Otherwise, activate repeats for this word
    clearRepeats(); // Clear any previous highlights
    repeatsActive = true;
    repeatsWord = normalizedWord;

    // Find and highlight all occurrences of this word in the current chapter
    const textContainer = readerElement?.querySelector(".text-container");
    if (!textContainer) return;

    // Get all verse text elements in the current chapter
    const verseTexts = textContainer.querySelectorAll(".verse-text");

    verseTexts.forEach((verseText) => {
      const walker = document.createTreeWalker(
        verseText,
        NodeFilter.SHOW_TEXT,
        null,
      );

      const textNodes: Text[] = [];
      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }

      textNodes.forEach((textNode) => {
        const text = textNode.textContent || "";
        const words = text.split(/(\s+)/); // Split but keep whitespace

        let hasMatch = false;
        words.forEach((w) => {
          const normalizedW = w
            .toLowerCase()
            .replace(/[^\w\s]/g, "")
            .trim();
          if (normalizedW === normalizedWord && normalizedW.length > 0) {
            hasMatch = true;
          }
        });

        if (hasMatch) {
          // Replace this text node with highlighted spans
          const fragment = document.createDocumentFragment();
          words.forEach((w) => {
            const normalizedW = w
              .toLowerCase()
              .replace(/[^\w\s]/g, "")
              .trim();
            if (normalizedW === normalizedWord && normalizedW.length > 0) {
              const span = document.createElement("span");
              span.className = "repeat-highlight";
              span.textContent = w;
              fragment.appendChild(span);
              highlightedElements.push(span);
            } else {
              fragment.appendChild(document.createTextNode(w));
            }
          });

          textNode.parentNode?.replaceChild(fragment, textNode);
        }
      });
    });
  }

  function clearRepeats() {
    if (!repeatsActive) return;

    repeatsActive = false;
    repeatsWord = "";

    // Remove repeat highlights
    const highlights = document.querySelectorAll(".repeat-highlight");
    highlights.forEach((highlight) => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(
          document.createTextNode(highlight.textContent || ""),
          highlight,
        );
        parent.normalize(); // Merge adjacent text nodes
      }
    });

    highlightedElements = highlightedElements.filter(
      (el) => !el.classList.contains("repeat-highlight"),
    );
  }

  async function handleToastAction(event: CustomEvent) {
    const { action, text } = event.detail;
    // Capture before any async gap — reactive var may be overwritten by a
    // subsequent word click while the dynamic import is resolving.
    const capturedMorphology = selectedMorphology;
    console.log(`Action: ${action} on "${text}"`);

    // TODO: Wire up actual actions
    switch (action) {
      case "dissect":
        // Open lexical modal with morphology data if available
        console.log('🔍 Starting lexicon lookup for:', text);
        console.log('   Current translation:', currentTranslation);
        console.log('   Has morphology:', !!capturedMorphology);
        console.log('   Strong\'s ID:', capturedMorphology?.strongsId);
        
        // Look up lexical data using new consolidated pack system
        (async () => {
          try {
            console.log('🔄 Importing lexicon lookup module...');
            const { lookupWord, lookupStrongs, lookupEnglishWord } = await import('../adapters/lexicon-lookup.js');
            console.log('✅ Module imported successfully');
            
            // Check if this is an English translation
            const englishTranslations = ['kjv', 'web', 'bsb', 'net', 'lxx2012'];
            const isEnglish = englishTranslations.includes(currentTranslation.toLowerCase());
            console.log('🌍 Is English translation:', isEnglish);
            
            if (isEnglish) {
              console.log('📚 Calling lookupEnglishWord for:', text);
              // Look up English word in lexical pack
              const englishEntry = await lookupEnglishWord(text);
              console.log('📚 lookupEnglishWord returned:', englishEntry);
              
              if (englishEntry) {
                console.log('📖 English Word Entry:', englishEntry);
                console.log(`   Word: ${englishEntry.word}`);
                if (englishEntry.ipa_us) console.log(`   Pronunciation (US): /${englishEntry.ipa_us}/`);
                if (englishEntry.pos) console.log(`   Part of Speech: ${englishEntry.pos}`);
                if (englishEntry.synonyms && englishEntry.synonyms.length > 0) {
                  console.log(`   Synonyms (${englishEntry.synonyms.length}): ${englishEntry.synonyms.slice(0, 10).join(', ')}${englishEntry.synonyms.length > 10 ? '...' : ''}`);
                }
                if (englishEntry.antonyms && englishEntry.antonyms.length > 0) {
                  console.log(`   Antonyms (${englishEntry.antonyms.length}): ${englishEntry.antonyms.slice(0, 10).join(', ')}${englishEntry.antonyms.length > 10 ? '...' : ''}`);
                }
                if (englishEntry.grammar) {
                  console.log('   Grammar:', englishEntry.grammar);
                }
                
                // Open modal with results
                console.log('✅ Opening modal with lexical entries');
                lexicalModalStore.open({
                  selectedText: text,
                  strongsId: undefined,
                  morphologyData: null,
                  lexicalEntries: englishEntry,
                });
                return;
              } else {
                console.log(`ℹ️ No lexical data found for "${text}"`);
                console.log('💡 Make sure you have installed the "Lexical Resources Pack" (365 MB) from the Packs menu.');
                lexicalModalStore.open({
                  selectedText: text,
                  strongsId: undefined,
                  morphologyData: null,
                  lexicalEntries: null,
                });
                return;
              }
            }
            
            // If we have a Strong's ID from morphology, look it up directly
            if (capturedMorphology?.strongsId) {
              const entry = await lookupStrongs(capturedMorphology.strongsId);
              if (entry) {
                console.log('Found Strong\'s entry:', entry);
              }
              lexicalModalStore.open({
                selectedText: text,
                strongsId: capturedMorphology.strongsId,
                morphologyData: capturedMorphology,
                lexicalEntries: null,
              });
              return;
            } else if (capturedMorphology) {
              // Have morphology but no Strong's ID
              lexicalModalStore.open({
                selectedText: text,
                strongsId: undefined,
                morphologyData: capturedMorphology,
                lexicalEntries: null,
              });
              return;
            } else {
              // Otherwise look up the word
              const entries = await lookupWord(text);
              if (entries.length > 0) {
                console.log(`Found ${entries.length} lexical entries:`, entries);
              } else {
                console.log('No lexical entries found for:', text);
                console.log('💡 Make sure you have installed the "Lexical Resources Pack" from the Packs menu.');
              }
              lexicalModalStore.open({
                selectedText: text,
                strongsId: undefined,
                morphologyData: null,
                lexicalEntries: null,
              });
              return;
            }
          } catch (error) {
            console.error('Lexicon lookup error:', error);
            lexicalModalStore.open({
              selectedText: text,
              strongsId: undefined,
              morphologyData: capturedMorphology,
              lexicalEntries: null,
            });
          }
        })();
        
        // Modal will be opened by the async function above once data is ready
        showToast = false; // Close the toast
        break;
      case "search":
        // Set search query and trigger search in NavigationBar
        searchQuery.set(text);
        triggerSearch.update((n) => n + 1);
        break;
      case "map":
        alert(`Show on map: ${text}\n\n(Map integration coming soon)`);
        break;
      case "highlight": {
        if (selectedVerseNumber === null) break;
        const hlRef = { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber };
        // Find existing highlight for this verse
        const existingV = chapterVerseHighlights.find(
          h => h.reference.verse === selectedVerseNumber
        ) ?? null;
        const existingW = selectionMode === 'word'
          ? chapterWordHighlights.find(
              h => h.reference.verse === selectedVerseNumber &&
                   h.translation === currentTranslation
            ) ?? null
          : null;
        highlightModalRef = hlRef;
        highlightModalExisting = selectionMode === 'word' ? (existingW ?? existingV) : existingV;
        highlightSelectionType = selectionMode;
        // Capture word offset synchronously now, before any DOM mutations
        pendingWordStart = 0; pendingWordLength = 0;
        if (selectionMode === 'word' && selectionRange) {
          const wSpan = readerElement?.querySelector<HTMLElement>(
            `[data-verse="${selectedVerseNumber}"] .verse-text`
          );
          if (wSpan) {
            const sr = selectionRange;
            let cur = 0, found = false;
            const sn = sr.startContainer, en = sr.endContainer;
            const walkW = (n: Node): void => {
              if (n.nodeType === Node.TEXT_NODE) {
                const t = n as Text;
                if (t === sn) { pendingWordStart = cur + sr.startOffset; found = true; }
                if (t === en) pendingWordLength = (cur + sr.endOffset) - pendingWordStart;
                cur += t.length;
              } else n.childNodes.forEach(walkW);
            };
            walkW(wSpan);
            if (!found) { pendingWordStart = 0; pendingWordLength = 0; }
          }
        }
        highlightModalOpen = true;
        showToast = false;
        break;
      }
      case "save":
        alert(`Save verse: ${text}\n\n(Saved verses coming soon)`);
        break;
      case "notes": {
        // Open note popup for selected verse (requires sign-in).
        // selectedVerseNumber is set in verse mode; in word mode derive it from the DOM.
        let verseNumForNote = selectedVerseNumber;
        if (verseNumForNote === null && selectionRange) {
          const verseEl = (selectionRange.startContainer as Node).parentElement?.closest('.verse') as HTMLElement | null;
          if (verseEl) {
            const n = parseInt(verseEl.getAttribute('data-verse') || '', 10);
            if (!isNaN(n)) verseNumForNote = n;
          }
        }
        if (verseNumForNote !== null) {
          await openNotePopup(verseNumForNote, currentBook, currentChapter);
        }
        showToast = false;
        break;
      }
      case "repeats":
        toggleRepeats(text);
        break;
    }

    // Close toast after action
    if (action !== "dissect") {
      showToast = false;
    }
    clearHighlights();
  }

  function handleModeChange(event: CustomEvent) {
    selectionMode = event.detail;
    if (selectionRange) {
      highlightSelection(selectionRange, selectionMode);
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Don't close if dragging
    if (isDragging) return;

    // Don't close if toast was just opened
    if (justOpenedToast) return;

    if (!target.closest(".selection-highlight") && !target.closest(".toast")) {
      showToast = false;
      clearHighlights();
    }
  }

  onMount(() => {
    textStore = new IndexedDBTextStore();

    // Load user settings
    loadUserSettings();

    // Listen for settings updates
    window.addEventListener("settingsUpdated", handleSettingsUpdate);

    (async () => {
      await loadAvailableTranslations();
      await loadChronologicalPack();
    })();

    // Handle footnote/cross-ref clicks
    const handleNoteClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const noteEl = target.closest(".inline-note") as HTMLElement | null;
      if (!noteEl) return;

      e.preventDefault();
      e.stopPropagation();

      const encodedNote = noteEl.getAttribute("data-note") || "";
      const noteIndex = noteEl.getAttribute("data-note-index") || "";
      const noteText = decodeURIComponent(encodedNote);
      const isXref = noteEl.classList.contains("inline-xref");

      alert(
        `${isXref ? "Cross-reference" : "Footnote"} ${noteIndex}:\n\n${noteText}`,
      );
    };

    readerElement?.addEventListener("click", handleNoteClick, true);

    // Add text selection listeners
    readerElement?.addEventListener("mousemove", handleMouseMove);
    readerElement?.addEventListener("click", handleTextClick);
    readerElement?.addEventListener("touchstart", handleTextInteraction);
    readerElement?.addEventListener("touchmove", handleTouchMove);
    readerElement?.addEventListener("touchend", handleTouchEnd);
    readerElement?.addEventListener("touchcancel", handleTouchEnd);
    document.addEventListener("click", handleClickOutside);

    // Save position when tab is hidden (phone lock, tab switch, close)
    const handleVisibilityChange = () => {
      if (document.hidden) saveScrollPosition();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Reload highlights when a remote change arrives (cross-device sync)
    const unsubscribeHighlightChanges = subscribeToHighlightRemoteChanges(() => {
      const visible = detectVisibleChapter();
      if (visible) {
        loadAndApplyHighlights(visible.book, visible.chapter);
      } else if (chapters.length > 0) {
        loadAndApplyHighlights(chapters[0].book, chapters[0].chapter);
      }
    });

    return () => {
      window.removeEventListener("settingsUpdated", handleSettingsUpdate);
      readerElement?.removeEventListener("click", handleNoteClick, true);
      readerElement?.removeEventListener("mousemove", handleMouseMove);
      readerElement?.removeEventListener("click", handleTextClick);
      readerElement?.removeEventListener("touchstart", handleTextInteraction);
      readerElement?.removeEventListener("touchmove", handleTouchMove);
      readerElement?.removeEventListener("touchend", handleTouchEnd);
      readerElement?.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeHighlightChanges();
      stopScrollDetection();
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      if (longPressTimer) clearTimeout(longPressTimer);

      // Cleanup hover element
      if (hoveredWordElement) {
        const parent = hoveredWordElement.parentNode;
        while (hoveredWordElement.firstChild) {
          parent?.insertBefore(
            hoveredWordElement.firstChild,
            hoveredWordElement,
          );
        }
        parent?.removeChild(hoveredWordElement);
        hoveredWordElement = null;
      }
    };
  });
</script>

{#if showToast}
  <SelectionToast
    x={toastX}
    y={toastY}
    {selectedText}
    isPlace={false}
    mode={selectionMode}
    morphologyData={selectedMorphology}
    on:action={handleToastAction}
    on:modeChange={handleModeChange}
  />
{/if}

{#if notePopupOpen}
  <NotePopup
    book={notePopupBook}
    chapter={notePopupChapter}
    verse={notePopupVerse}
    initialContent={notePopupContent}
    noteId={notePopupNoteId}
    x={notePopupX}
    y={notePopupY}
    width={notePopupW}
    height={notePopupH}
    on:close={() => (notePopupOpen = false)}
    on:noteSaved={handleNoteSaved}
    on:noteDeleted={handleNoteDeleted}
  />
{/if}

{#if highlightModalOpen && highlightModalRef}
  <HighlightModal
    reference={highlightModalRef}
    existingHighlight={highlightModalExisting}
    selectionType={highlightSelectionType}
    on:save={async (e) => {
      if (!highlightModalRef) return;
      const style: HighlightStyle = e.detail;
      highlightModalOpen = false;

      if (highlightSelectionType === 'word' && pendingWordLength > 0) {
        // Remove existing word highlight for this verse+translation if any
        const prev = chapterWordHighlights.find(
          h => h.reference.verse === highlightModalRef!.verse && h.translation === currentTranslation
        );
        if (prev) {
          await userDataStore.deleteWordHighlight(prev.id);
          await syncQueue.enqueue({ type: 'DELETE', table: 'user_word_highlights', id: prev.id });
        }
        // Word offset was captured synchronously at toast action time (before DOM mutations)
        const wordStart = pendingWordStart;
        const wordLength = pendingWordLength;
        const saved = await userDataStore.saveWordHighlight({
          reference: highlightModalRef,
          translation: currentTranslation,
          wordStart, wordLength, style,
        });
        await syncQueue.enqueue({ type: 'INSERT', table: 'user_word_highlights', id: saved.id, data: {
          id: saved.id, book: saved.reference.book, chapter: saved.reference.chapter,
          verse: saved.reference.verse, translation: saved.translation,
          word_start: saved.wordStart, word_length: saved.wordLength,
          style: JSON.stringify(saved.style), created_at: saved.createdAt.toISOString(),
        }});
        chapterWordHighlights = await userDataStore.getChapterWordHighlights(highlightModalRef.book, highlightModalRef.chapter);
      } else {
        // Verse-level
        const prev = chapterVerseHighlights.find(h => h.reference.verse === highlightModalRef!.verse);
        if (prev) {
          await userDataStore.deleteHighlight(prev.id);
          await syncQueue.enqueue({ type: 'DELETE', table: 'user_highlights', id: prev.id });
        }
        const saved = await userDataStore.saveHighlight({ reference: highlightModalRef, style });
        await syncQueue.enqueue({ type: 'INSERT', table: 'user_highlights', id: saved.id, data: {
          id: saved.id, book: saved.reference.book, chapter: saved.reference.chapter,
          verse: saved.reference.verse, color: saved.style.color,
          style: JSON.stringify(saved.style), created_at: saved.createdAt.toISOString(),
        }});
        chapterVerseHighlights = await userDataStore.getChapterHighlights(highlightModalRef.book, highlightModalRef.chapter);
      }
      // Re-apply all highlights for the chapter
      await tick();
      const section = readerElement?.querySelector<HTMLElement>(
        `[data-chapter-section][data-book="${highlightModalRef.book}"][data-chapter="${highlightModalRef.chapter}"]`
      );
      if (section) applyChapterHighlights(section, chapterVerseHighlights, chapterWordHighlights, currentTranslation);
    }}
    on:remove={async () => {
      if (!highlightModalRef) return;
      highlightModalOpen = false;
      if (highlightModalExisting) {
        const isWord = 'wordStart' in highlightModalExisting;
        if (isWord) {
          await userDataStore.deleteWordHighlight(highlightModalExisting.id);
          await syncQueue.enqueue({ type: 'DELETE', table: 'user_word_highlights', id: highlightModalExisting.id });
          chapterWordHighlights = await userDataStore.getChapterWordHighlights(highlightModalRef.book, highlightModalRef.chapter);
        } else {
          await userDataStore.deleteHighlight(highlightModalExisting.id);
          await syncQueue.enqueue({ type: 'DELETE', table: 'user_highlights', id: highlightModalExisting.id });
          chapterVerseHighlights = await userDataStore.getChapterHighlights(highlightModalRef.book, highlightModalRef.chapter);
        }
        // Re-apply after removal
        await tick();
        const section = readerElement?.querySelector<HTMLElement>(
          `[data-chapter-section][data-book="${highlightModalRef.book}"][data-chapter="${highlightModalRef.chapter}"]`
        );
        if (section) applyChapterHighlights(section, chapterVerseHighlights, chapterWordHighlights, currentTranslation);
      }
    }}
    on:close={() => { highlightModalOpen = false; }}
  />
{/if}

<AnnotationPanel
  bind:open={annotationPanelOpen}
  book={annotationPanelBook}
  chapter={annotationPanelChapter}
  verse={annotationPanelVerse}
  tskEntries={annotationPanelTsk}
  commentaryEntries={annotationPanelCommentary}
  initialTab={annotationPanelTab}
  on:close={() => (annotationPanelOpen = false)}
/>

<div class="bible-reader" bind:this={readerElement}>
  <NavigationBar
    {windowId}
    style="transform: translateY({navBarOffset}px); transition: none;"
  />

  <div class="text-container">
    {#if loading && chapters.length === 0}
      <div class="loading">Loading...</div>
    {:else if error}
      <div class="error">{error}</div>
      <p class="error-hint">
        To load Bible text, import a pack using the classic version at
        <a href="/apps/pwa/" target="_blank">localhost:5173</a>
      </p>
    {:else if chapters.length === 0}
      <div class="no-content">No verses found for this chapter.</div>
    {:else}
      {#each chapters as chapterData (`${currentTranslation}-${chapterData.book}-${chapterData.chapter}`)}
        {@const chPlanCtxs = computeAllPlanContexts(chapterData.book, chapterData.chapter)}
        {@const chHarmCtxs = chPlanCtxs.filter((c) => c.type === 'harmony')}
        {@const chStdCtxs = chPlanCtxs.filter((c) => c.type === 'standard')}
        <div class="chapter-section" data-chapter-section data-book={chapterData.book} data-chapter={chapterData.chapter}>
          <div class="chapter-header">
            <h1>{chapterData.book} {chapterData.chapter}</h1>
          </div>
          <div
            class="verses {translationFontClass}"
            class:paragraph-layout={verseLayout === "paragraph"}
            class:nonumber-layout={verseLayout === "paragraph-no-verse-numbers"}
          >
            {#each chapterData.verses as { verse, text, html, heading, headingLevel }, verseIdx (`${currentTranslation}-${chapterData.book}-${chapterData.chapter}-${verse}`)}
              {@const hCtxsForVerse = chHarmCtxs.filter((c) => c.passage.endChapter === chapterData.chapter && (c.passage.endVerse !== null ? verse === c.passage.endVerse : verseIdx === chapterData.verses.length - 1))}
              {#if heading && showSectionHeadings}
                <div class="section-heading section-heading--s{headingLevel || 1}">{heading}</div>
              {/if}
              <div class="verse" data-verse={verse}>
                <span class="verse-number">{verse}</span>
                {#if showCommentaries && commentaryByVerse.has(verse)}
                  {#each [...new Set(commentaryByVerse.get(verse)!.map((e) => e.author))] as author}
                    <span
                      class="anno-icon"
                      style="background:{getAuthorColor(author)}"
                      title={author}
                      role="button"
                      tabindex="0"
                      on:click|stopPropagation={() => openAnnotationPanel(verse, 'commentary', chapterData.book, chapterData.chapter)}
                      on:keypress|stopPropagation={() => openAnnotationPanel(verse, 'commentary', chapterData.book, chapterData.chapter)}
                    >{getAuthorInitials(author)}</span>
                  {/each}
                {/if}
                {#if showReferences && tskByVerse.has(verse)}
                  <span
                    class="anno-ref"
                    style="color:{TSK_COLOR}"
                    title="TSK Cross-References"
                    role="button"
                    tabindex="0"
                    on:click|stopPropagation={() => openAnnotationPanel(verse, 'references', chapterData.book, chapterData.chapter)}
                    on:keypress|stopPropagation={() => openAnnotationPanel(verse, 'references', chapterData.book, chapterData.chapter)}
                  >◆</span>
                {/if}
                <span class="verse-text"
                  >{@html html || renderVerseHtml(text)}</span
                >
                {#if verseNotesMap.has(verse)}
                  <span
                    class="verse-note-icon"
                    role="button"
                    tabindex="0"
                    title="View note"
                    on:click|stopPropagation={() => openNotePopup(verse, chapterData.book, chapterData.chapter)}
                    on:keypress|stopPropagation={(e) => e.key === 'Enter' && openNotePopup(verse, chapterData.book, chapterData.chapter)}
                  >✎</span>
                {/if}
                {#if hCtxsForVerse.length > 0}
                  {#each hCtxsForVerse as hCtx}
                    <div class="harmony-btn-row">
                      {#if hCtx.isLastPassage}
                        <button
                          class="harmony-finish-btn"
                          on:click={() => handleHarmonyCheckAndFinishDay(hCtx)}
                          title="Mark this passage and day complete"
                        >✓ Finish Day ({hCtx.passageIndex + 1} of {hCtx.totalPassages})</button>
                      {:else}
                        <button
                          class="harmony-continue-only-btn"
                          on:click={() => handleHarmonyContinueOnly(hCtx)}
                          title="Go to next passage without marking this one"
                        >Continue ({hCtx.passageIndex + 1} of {hCtx.totalPassages})</button>
                        <button
                          class="harmony-check-continue-btn"
                          on:click={() => handleHarmonyCheckAndContinue(hCtx)}
                          title="Check off this passage and continue"
                        >✓ Check off &amp; Continue</button>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            {/each}
          </div>
          {#if chStdCtxs.some(ctx => ctx.isLastChapter || !ctx.isSequentialNext)}
            <div class="chapter-plan-footer">
              {#each chStdCtxs as ctx}
                {#if ctx.isLastChapter || !ctx.isSequentialNext}
                  <div class="plan-continue-row">
                    <span class="plan-continue-name">📖 {ctx.planName}</span>
                    {#if ctx.isLastChapter}
                      <button
                        class="plan-day-complete-btn"
                        on:click={() => handleStandardDayComplete(ctx)}
                      >✓ Day Complete</button>
                    {:else}
                      <button
                        class="plan-mark-continue-btn"
                        on:click={() => handleMarkAndContinue(ctx, chapterData.book, chapterData.chapter)}
                      >✓ Done — {ctx.nextChapter?.book} {ctx.nextChapter?.chapter} →</button>
                      <button
                        class="plan-continue-only-btn"
                        on:click={() => handleContinueOnly(ctx)}
                      >{ctx.nextChapter?.book} {ctx.nextChapter?.chapter} →</button>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

{#if dayCompleteMessage}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="day-complete-overlay" on:click={() => dayCompleteMessage = null}>
    <div class="day-complete-card" on:click|stopPropagation>
      <div class="day-complete-emoji">🎉</div>
      <p class="day-complete-title">Day Complete!</p>
      <p class="day-complete-plan">{dayCompleteMessage}</p>
      <button class="day-complete-btn" on:click={() => dayCompleteMessage = null}>Great!</button>
    </div>
  </div>
{/if}



<style>
  .bible-reader {
    width: 100%;
    height: 100%;
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: none; /* Disable browser scroll anchoring — we manually correct scrollTop on prepend */
    background: #1a1a1a;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
  }

  .text-container {
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    padding: 80px 20px 100px;
    flex: 1;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }

  .chapter-section {
    margin-bottom: 3rem;
  }

  .chapter-section:first-child .chapter-header {
    margin-top: 0;
  }

  .chapter-header {
    margin: 3rem 0 2rem 0;
    padding-top: 2rem;
    border-top: 2px solid #444;
    text-align: center;
  }

  .chapter-section:first-child .chapter-header {
    border-top: none;
    padding-top: 0;
  }

  .chapter-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .verses {
    line-height: 1.8;
  }

  .verse {
    margin-bottom: 0.5rem;
    position: relative;
    font-size: var(--base-font-size, 18px);
  }

  .verse-number {
    display: inline-block;
    min-width: 2rem;
    font-size: calc(var(--base-font-size, 18px) * 0.5);
    color: #888;
    vertical-align: super;
    margin-right: 0.25rem;
  }

  .verse-text {
    font-size: var(--base-font-size, 1.125rem);
    line-height: var(--line-spacing, 1.8);
    cursor: text;
  }

  /* ── Translation-specific fonts ─────────────────────────────────────── */

  /* KJV / KJVPCE — Gothic blackletter */
  .verses.translation-font-kjv .verse-text {
    font-family: 'BerryRotunda', Georgia, serif;
  }
  .verses.translation-font-kjv .section-heading {
    font-family: 'Teutonic4', 'BerryRotunda', Georgia, serif;
    /* font-size overridden below near .section-heading block */
  }

  /* WEB / BSB — classical open-Bible serif */
  .verses.translation-font-web .verse-text {
    font-family: 'EB Garamond', Georgia, serif;
  }
  .verses.translation-font-web .section-heading {
    font-family: 'Cinzel', Georgia, serif;
  }

  /* Greek source texts — EB Garamond handles polytonic well */
  .verses.translation-font-greek .verse-text {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: calc(var(--base-font-size, 1.125rem) + 1px);
  }
  .verses.translation-font-greek .section-heading {
    font-family: 'Jura', system-ui, sans-serif;
  }

  .anno-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 14px;
    border-radius: 9px;
    font-size: 7px;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    margin: 0 1px;
    vertical-align: super;
    line-height: 1;
    user-select: none;
    flex-shrink: 0;
  }

  .anno-ref {
    color: #D97706; /* amber/gold for TSK diamonds */
    font-size: 10px;
    cursor: pointer;
    margin: 0 1px;
    vertical-align: super;
    user-select: none;
  }

  .verse-note-icon {
    color: #f7c948;
    font-size: 0.82em;
    cursor: pointer;
    margin-left: 0.25em;
    vertical-align: baseline;
    user-select: none;
    opacity: 0.85;
    transition: opacity 0.15s;
  }

  .verse-note-icon:hover {
    opacity: 1;
  }

  /* Harmony reading session inline buttons */
  .harmony-btn-row {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: 0.5em;
    vertical-align: baseline;
  }

  .harmony-continue-only-btn,
  .harmony-check-continue-btn,
  .harmony-finish-btn {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 0.78em;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid;
    vertical-align: baseline;
    transition: background 0.15s, color 0.15s;
    user-select: none;
  }

  .harmony-continue-only-btn {
    background: transparent;
    color: #7ab3f0;
    border-color: #7ab3f0;
  }
  .harmony-continue-only-btn:hover {
    background: #7ab3f0;
    color: #1a1a2e;
  }

  .harmony-check-continue-btn {
    background: transparent;
    color: #a78bfa;
    border-color: #a78bfa;
  }
  .harmony-check-continue-btn:hover {
    background: #a78bfa;
    color: #1a1a2e;
  }

  .harmony-finish-btn {
    background: transparent;
    color: #6fcf97;
    border-color: #6fcf97;
  }
  .harmony-finish-btn:hover {
    background: #6fcf97;
    color: #1a2e1a;
  }

  /* Day complete overlay */
  :global(.day-complete-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  :global(.day-complete-card) {
    background: #1e2a3a;
    border: 1px solid #2e4a6a;
    border-radius: 12px;
    padding: 32px 40px;
    text-align: center;
    max-width: 320px;
    width: 90%;
  }

  :global(.day-complete-emoji) {
    font-size: 48px;
    margin-bottom: 12px;
  }

  :global(.day-complete-title) {
    font-size: 22px;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0 0 6px;
  }

  :global(.day-complete-plan) {
    font-size: 14px;
    color: #aaa;
    margin: 0 0 20px;
  }

  :global(.day-complete-btn) {
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
    color: #fff;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    padding: 10px 28px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  :global(.day-complete-btn):hover {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
  }

  /* Standard plan continue footer — matches harmony pill button style */
  .chapter-plan-footer {
    margin: 0;
    border-top: 1px solid #2e2e2e;
    padding: 10px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #111;
  }

  .plan-continue-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .plan-continue-name {
    font-size: 12px;
    color: #888;
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .plan-mark-continue-btn,
  .plan-continue-only-btn,
  .plan-day-complete-btn {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 0.78em;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid;
    vertical-align: baseline;
    transition: background 0.15s, color 0.15s;
    user-select: none;
  }

  .plan-mark-continue-btn {
    background: transparent;
    color: #a78bfa;
    border-color: #a78bfa;
  }
  .plan-mark-continue-btn:hover {
    background: #a78bfa;
    color: #1a1a2e;
  }

  .plan-continue-only-btn {
    background: transparent;
    color: #7ab3f0;
    border-color: #7ab3f0;
  }
  .plan-continue-only-btn:hover {
    background: #7ab3f0;
    color: #1a1a2e;
  }

  .plan-day-complete-btn {
    background: transparent;
    color: #6fcf97;
    border-color: #6fcf97;
  }
  .plan-day-complete-btn:hover {
    background: #6fcf97;
    color: #1a2e1a;
  }

  /* Highlight text-color global helper (set by highlightRenderer) */
  :global(.hl-text-colored) {
    color: var(--hl-text-color, inherit) !important;
  }

  /* Morphology-tagged words */
  :global(.morphology-word) {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  :global(.morphology-word:hover) {
    background-color: rgba(100, 150, 255, 0.1);
  }

  /* Paragraph layout mode */
  .verses.paragraph-layout .verse {
    display: inline;
    margin-bottom: 0;
  }

  .verses.paragraph-layout .verse-number {
    vertical-align: baseline;
    font-size: calc(var(--base-font-size, 18px) * 0.5);
    color: #888;
  }

  /* No verse numbers layout — paragraph flow, chapter number only */
  .verses.nonumber-layout .verse {
    display: inline;
    margin-bottom: 0;
  }

  .verses.nonumber-layout .verse-number {
    display: none;
  }

  .verses.nonumber-layout .anno-icon {
    display: none;
  }

  .verses.nonumber-layout .anno-ref {
    display: none;
  }

  .verses.nonumber-layout .verse-text::after {
    content: "\00a0\00a0";
  }

  /* Increase font size for mobile devices */
  @media (max-width: 768px) {
    .verse-text {
      font-size: var(--base-font-size, 1.4rem);
      line-height: var(--line-spacing, 2);
    }

    .chapter-header h1 {
      font-size: 2rem;
    }

    .verse-number {
      font-size: calc(var(--base-font-size, 18px) * 0.5);
    }
  }

  /* Remove verse-level hover - we'll handle word-level in JS */
  .section-heading {
    font-weight: 600;
    font-size: calc(var(--base-font-size, 18px) + 3px);
    color: #d0d0d0;
    margin: 24px 0 12px 0;
    padding-top: 12px;
    border-top: 1px solid #444;
  }

  .section-heading--s2 {
    font-weight: 500;
    font-size: calc(var(--base-font-size, 18px) + 1px);
    color: #a8a8a8;
    margin: 14px 0 6px 0;
    padding-top: 0;
    border-top: none;
  }

  /* KJV — larger headings to suit the blackletter aesthetic */
  .verses.translation-font-kjv .section-heading {
    font-size: calc(var(--base-font-size, 18px) + 7px);
  }

  .verses.translation-font-kjv .section-heading--s2 {
    font-size: calc(var(--base-font-size, 18px) + 5px);
  }

  @media (max-width: 768px) {
    .section-heading {
      font-size: calc(var(--base-font-size, 18px) + 3px);
    }
    .section-heading--s2 {
      font-size: calc(var(--base-font-size, 18px) + 1px);
    }
  }

  .section-heading:first-child {
    margin-top: 0;
    border-top: none;
  }

  :global(.inline-note) {
    color: #6699ff;
    cursor: pointer;
    font-size: 0.7em;
    margin: 0 2px;
  }

  :global(.inline-xref) {
    color: #ccc;
  }

  .loading,
  .error,
  .no-content {
    text-align: center;
    padding: 40px 20px;
    color: #888;
    font-size: 1rem;
  }

  .error {
    color: #ff6b6b;
  }

  .error-hint {
    text-align: center;
    color: #888;
    font-size: 0.9rem;
    margin-top: 10px;
  }

  .error-hint a {
    color: #667eea;
    text-decoration: none;
  }

  .error-hint a:hover {
    text-decoration: underline;
  }

  /* Native momentum scrolling on iOS only — no scroll-behavior:smooth because CSS smooth
     overrides behavior:"auto" on programmatic scrolls, causing dozens of events during the
     animation that all satisfy scrollTop<=200 and trigger cascading loadPreviousChapter calls. */
  .bible-reader {
    -webkit-overflow-scrolling: touch;
  }

  /* Text selection highlights */
  .verse-text :global(.word-hover) {
    background: rgba(102, 126, 234, 0.3);
    border-radius: 3px;
    padding: 2px 4px;
    margin: -2px -4px;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.4);
  }

  :global(.selection-highlight) {
    background: rgba(102, 126, 234, 0.3);
    border-radius: 2px;
    position: relative;
    padding: 0 2px;
    margin: 0 -2px;
  }

  :global(.verse-highlighted) {
    background: rgba(102, 126, 234, 0.15);
    border-left: 3px solid #667eea;
    padding-left: 8px;
    margin-left: -8px;
    border-radius: 2px;
  }

  :global(.search-verse-highlighted) {
    background: linear-gradient(
      135deg,
      rgba(255, 183, 77, 0.35) 0%,
      rgba(245, 124, 0, 0.25) 100%
    );
    border-left: 3px solid #f57c00;
    padding-left: 8px;
    margin-left: -8px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 183, 77, 0.25);
  }

  :global(.rp-verse-highlight) {
    isolation: isolate;
    background: linear-gradient(to right, rgba(34, 197, 94, 0.40), transparent);
    background-position: var(--rp-hl-left, 2em) center;
    background-size: 30ch calc(1em + 7px);
    background-repeat: no-repeat;
    border-radius: 3px;
  }

  /* Floating drag handles for text selection */
  :global(.drag-handle-float) {
    position: absolute;
    width: 3px;
    background: #667eea;
    border-radius: 2px;
    cursor: ew-resize;
    z-index: 100;
    opacity: 0.8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    touch-action: none;
    pointer-events: auto;
  }

  :global(.drag-handle-float.left) {
    margin-left: -3px;
  }

  :global(.drag-handle-float.right) {
    margin-left: 0px;
  }

  :global(.drag-handle-float:hover) {
    background: #5568d3;
    opacity: 1;
    width: 4px;
  }

  :global(.drag-handle-float:active) {
    background: #4456c0;
    width: 4px;
  }

  /* Custom selection styling */
  .text-container ::selection {
    background: rgba(102, 126, 234, 0.3);
  }

  /* Repeat highlights */
  :global(.repeat-highlight) {
    background: rgba(255, 193, 7, 0.35);
    border-radius: 3px;
    padding: 2px 4px;
    margin: 0 1px;
    box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.2);
    font-weight: 500;
  }
</style>
