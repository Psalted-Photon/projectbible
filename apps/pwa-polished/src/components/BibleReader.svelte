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
  import { subscribeToUserDataRemoteChanges } from "../adapters/SyncedUserDataStore";
  import { applyChapterHighlights } from "../lib/highlightRenderer";
  import { repeatsStore, normalizeRepeatWord } from "../stores/repeatsStore";
  import type { RepeatGroup } from "../stores/repeatsStore";
  import { repeatHighlightAllRequest } from "../stores/repeatBulkStore";
  import type { RepeatHighlightAllRequest } from "../stores/repeatBulkStore";
  import { applyRepeatsToSection, applyRepeatsToAllSections, clearRepeatsInSection, findRepeatOccurrences } from "../lib/repeatRenderer";
  import { repeatCountsStore } from "../stores/repeatCountsStore";
  import { countWordsInBook } from "../lib/repeatCounts";
  import AudioPlayer from "./AudioPlayer.svelte";
  import BookIntroPanel from "./BookIntroPanel.svelte";
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
  import { BIBLE_BOOKS, normalizeBookName, getBookColor as getCategoryColor } from "../lib/bibleData";
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
  import { annotationReturnStore } from "../stores/annotationReturnStore";

  const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans';

  function bibleReaderGetPlanDisplayName(config: any): string {
    if (config?.name) return config.name;
    if (config?.ordering === 'harmony') return 'Gospel Harmony';
    if (config?.ordering === 'chronological') return 'Chronological Plan';
    return 'Custom Plan';
  }

  function computeAllPlanContexts(book: string, chapter: number, _session?: any): any[] {
    try {
      const session = get(readingSessionStore);
      if (!session) return []; // No active reading session → no plan UI

      const raw = localStorage.getItem(STORAGE_ACTIVE_PLANS);
      if (!raw) return [];
      const activePlans: Array<{ id: string; plan: any }> = JSON.parse(raw);
      const planEntry = activePlans.find(p => p.id === session.planId);
      if (!planEntry) return [];

      const plan = planEntry.plan;
      const todayDay = plan.days?.find((d: any) => d.dayNumber === session.dayNumber);
      if (!todayDay) return [];

      const results: any[] = [];

      if (plan.config?.ordering === 'harmony') {
        const sections: HarmonySection[] = todayDay.harmonySections ?? [];
        const allPassages: HarmonyPassage[] = sections.flatMap((s: HarmonySection) => s.passages);
        const sessionIdx = session.passageIndex ?? 0;
        const p = allPassages[sessionIdx];
        if (!p) return [];
        // Buttons appear at the passage's end chapter
        if (normalizeBookName(p.book) !== book || p.endChapter !== chapter) return [];
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
        const chapIdx = todayChapters.findIndex((c: any) => normalizeBookName(c.book) === book && c.chapter === chapter);
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
  let paneOpened = false; // True after "Open Split View" is tapped
  let readerClientWidth = 0;
  let readerLeft = 0;
  $: if (readerElement && ($windowStore, readerClientWidth)) {
    requestAnimationFrame(() => { readerLeft = readerElement?.getBoundingClientRect().left ?? 0; });
  }

  // Category → mascot color map (matches NavigationBar.svelte book dropdown colors)
  const CATEGORY_COLORS: Record<string, string> = {
    'pentateuch':     '#a67c52',
    'historical':     '#6ca0dc',
    'wisdom':         '#f0c040',
    'major-prophets': '#5c1e99',
    'minor-prophets': '#a45be9',
    'gospels':        '#fc345c',
    'acts':           '#ff6520',
    'pauline':        '#6048cc',
    'general':        '#f2893e',
    'revelation':     '#61f1ff',
  };

  function getBookColor(bookName: string): string {
    const book = BIBLE_BOOKS.find(b => b.name === bookName);
    return book ? (CATEGORY_COLORS[book.category] ?? '#8ab4f8') : '#8ab4f8';
  }

  let verseLayout: "one-per-line" | "paragraph" | "paragraph-no-verse-numbers" = "one-per-line";
  let showSectionHeadings = true;
  let showRedLetter = true;
  let scrollHandler: ((e: Event) => void) | null = null;

  // Red-letter span data loaded lazily from /red-letter-spans.json
  // Format: { [transId]: { ["BOOK:CH:V"]: [{s,e}] } }
  let redLetterData: Record<string, Record<string, { s: number; e: number }[]>> | null = null;
  let redLetterLoading = false;

  /** Load the red-letter spans JSON once and cache it. */
  async function loadRedLetterData(): Promise<void> {
    if (redLetterData !== null || redLetterLoading) return;
    redLetterLoading = true;
    try {
      const res = await fetch('/red-letter-spans.json');
      if (res.ok) redLetterData = await res.json();
    } catch {
      // Network failure — red-letter simply won't display
    } finally {
      redLetterLoading = false;
    }
  }

  /** USFM 3-letter book code lookup (handles both numeric and Roman-numeral pack variants). */
  const BOOK_TO_USFM: Record<string, string> = {
    Matthew:'MAT', Mark:'MRK', Luke:'LUK', John:'JHN', Acts:'ACT', Romans:'ROM',
    'I Corinthians':'1CO', '1 Corinthians':'1CO',
    'II Corinthians':'2CO', '2 Corinthians':'2CO',
    Galatians:'GAL', Ephesians:'EPH', Philippians:'PHP', Colossians:'COL',
    'I Thessalonians':'1TH', '1 Thessalonians':'1TH',
    'II Thessalonians':'2TH', '2 Thessalonians':'2TH',
    'I Timothy':'1TI', '1 Timothy':'1TI',
    'II Timothy':'2TI', '2 Timothy':'2TI',
    Titus:'TIT', Philemon:'PHM', Hebrews:'HEB', James:'JAS',
    'I Peter':'1PE', '1 Peter':'1PE',
    'II Peter':'2PE', '2 Peter':'2PE',
    'I John':'1JN', '1 John':'1JN',
    'II John':'2JN', '2 John':'2JN',
    'III John':'3JN', '3 John':'3JN',
    Jude:'JUD', 'Revelation of John':'REV', Revelation:'REV',
  };

  /**
   * Return a Map from verse number → red-letter spans for the given book/chapter.
   * Requires redLetterData to be loaded and showRedLetter to be true.
   */
  function getChapterRedLetterMap(
    transId: string,
    book: string,
    chapter: number,
  ): Map<number, { s: number; e: number }[]> {
    const map = new Map<number, { s: number; e: number }[]>();
    if (!redLetterData) return map;
    const transSpans = redLetterData[transId.toLowerCase()];
    if (!transSpans) return map;
    const usfm = BOOK_TO_USFM[book];
    if (!usfm) return map;
    const prefix = `${usfm}:${chapter}:`;
    for (const [key, spans] of Object.entries(transSpans)) {
      if (key.startsWith(prefix)) {
        const verse = parseInt(key.slice(prefix.length), 10);
        if (!isNaN(verse)) map.set(verse, spans as { s: number; e: number }[]);
      }
    }
    return map;
  }

  /**
   * Re-render all loaded chapter verse HTML to reflect a change in showRedLetter.
   * Avoids a full DB reload — just re-applies (or removes) span markup.
   */
  async function reRenderRedLetter(): Promise<void> {
    if (showRedLetter && redLetterData === null) await loadRedLetterData();
    chapters = chapters.map((c) => {
      const rlMap = showRedLetter ? getChapterRedLetterMap(currentTranslation, c.book, c.chapter) : new Map();
      return {
        ...c,
        verses: c.verses.map((v) => ({
          ...v,
          html: renderVerseHtml(v.text, rlMap.get(v.verse)),
        })),
      };
    });
  }
  let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Commentary anchor verse-sync
  let verseObserver: IntersectionObserver | null = null;
  let anchorSyncDebounce: ReturnType<typeof setTimeout> | null = null;
  // Key: "book::chapter::verse" — prevents verse-number collisions across chapters in multi-chapter view
  const visibleVersePositions = new Map<string, { book: string; chapter: number; verse: number; top: number }>();
  // Cache of verse element → { book, chapter } resolved at observe-time (avoids repeated DOM walks)
  const verseElInfo = new WeakMap<Element, { book: string; chapter: number }>();
  let lastAnchorVerse: number | null = null; // last verse pushed to commentary windows
  let anchorHighlightedElements: HTMLElement[] = []; // DOM elements with .comm-anchor-highlight
  let prevCommDrifted = false; // for detecting drift→sync transition

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

  // Verse notes map (book|chapter|verse → note id) for all loaded chapters
  let verseNotesMap = new Map<string, string>();

  // Annotation store instances
  const commentaryStore = new IndexedDBCommentaryStore();
  const tskStore = new IndexedDBTskReferenceStore();

  // Annotation data maps (keyed by "book:chapter:verse" to support multiple chapters in infinite scroll)
  let commentaryByVerse = new Map<string, CommentaryEntry[]>();
  let tskByVerse = new Map<string, TskEntry[]>();

  function annotationKey(book: string, chapter: number, verse: number): string {
    return `${book}:${chapter}:${verse}`;
  }

  // Book intro panel state
  let bookIntroPanelOpen = false;
  let bookIntroPanelBook = "";

  function openBookIntroPanel(book: string) {
    bookIntroPanelBook = book;
    bookIntroPanelOpen = true;
  }

  // Annotation panel state
  let annotationPanelOpen = false;
  let annotationPanelVerse = 0;
  let annotationPanelBook = "";
  let annotationPanelChapter = 0;
  let annotationPanelTab: "references" | "commentary" = "references";
  let annotationPanelTsk: TskEntry[] = [];
  let annotationPanelCommentary: CommentaryEntry[] = [];
  let annotationPanelTargetAuthor = '';

  // Reopen annotation panel after back-navigation from a "Go →" link
  let _reopenAnnotationVerse: number | null = null;
  let _reopenAnnotationTab: 'references' | 'commentary' = 'commentary';
  // Local scroll target for window panes (replaces global navigationStore.scrollTargetVerse)
  let _windowScrollTarget: number | null = null;
  // Set at navigate time to remember the navigation came from the intro panel (no auto-reopen)
  let _navigatedFromIntro = false;
  // Set only when user presses Back after intro navigation; consumed by loadChapter / reactive block
  let _reopenBookIntroPanel = false;
  // Verse to highlight after navigating from a commentary popup verse link
  let _commNavHighlightVerse: number | null = null;
  // Verse to highlight after navigating from a link (e.g. Character modal verse list);
  // colored by the target book's category.
  let _linkNavHighlightVerse: number | null = null;

  function handleAnnotationNavigateTo(e: CustomEvent<{ book: string; chapter: number; verse: number }>) {
    const { book, chapter, verse } = e.detail;
    annotationReturnStore.set({
      book: annotationPanelBook,
      chapter: annotationPanelChapter,
      verse: annotationPanelVerse,
      tab: annotationPanelTab,
    });
    annotationPanelOpen = false;
    _commNavHighlightVerse = verse;
    if (windowId) {
      _windowScrollTarget = verse;
      windowStore.updateContentState(windowId, { book, chapter, highlightedVerse: null });
    } else {
      navigationStore.navigateTo(currentTranslation, book, chapter, verse);
    }
  }

  // Reset paneOpened whenever a new annotation return is set
  $: if ($annotationReturnStore !== null) paneOpened = false;

  // Derive navbar display offset — fully hide navbar when back button is active (main reader only)
  $: displayNavOffset = (!windowId && $annotationReturnStore !== null) ? -100 : navBarOffset;

  function handleAnnotationReturn() {
    _commNavHighlightVerse = null;
    const ctx = $annotationReturnStore;
    if (!ctx) return;
    const fromIntro = _navigatedFromIntro;
    _navigatedFromIntro = false;
    annotationReturnStore.set(null);
    if (fromIntro) {
      // User pressed Back after navigating from intro panel — reopen intro panel after load
      bookIntroPanelBook = ctx.book;
      _reopenBookIntroPanel = true;
      if (windowId) {
        _windowScrollTarget = ctx.verse;
        windowStore.updateContentState(windowId, { book: ctx.book, chapter: ctx.chapter, highlightedVerse: null });
      } else {
        navigationStore.navigateTo(currentTranslation, ctx.book, ctx.chapter, ctx.verse);
      }
    } else {
      _reopenAnnotationVerse = ctx.verse;
      _reopenAnnotationTab = ctx.tab;
      if (windowId) {
        windowStore.updateContentState(windowId, { book: ctx.book, chapter: ctx.chapter, highlightedVerse: null });
      } else {
        navigationStore.navigateTo(currentTranslation, ctx.book, ctx.chapter, ctx.verse);
      }
    }
  }

  function handleBookIntroNavigateTo(e: CustomEvent<{ book: string; chapter: number; verse: number }>) {
    const { book, chapter, verse } = e.detail;
    _navigatedFromIntro = true;  // remember origin; panel only reopens when Back is pressed
    bookIntroPanelOpen = false;
    annotationReturnStore.set({ book: bookIntroPanelBook, chapter: 1, verse: 1, tab: 'references' });
    if (windowId) {
      _windowScrollTarget = verse;
      windowStore.updateContentState(windowId, { book, chapter, highlightedVerse: null });
    } else {
      navigationStore.navigateTo(currentTranslation, book, chapter, verse);
    }
  }

  // Annotation toggles (reactive from store)
  $: showReferences = (windowId
    ? (windowState?.contentState?.showReferences ?? $navigationStore.showReferences)
    : $navigationStore.showReferences) ?? false;
  $: selectedCommentaryAuthors = windowId
    ? (windowState?.contentState?.selectedCommentaryAuthors ?? [])
    : ($navigationStore.selectedCommentaryAuthors ?? []);
  $: showCommentaries = selectedCommentaryAuthors.length > 0;

  // All commentary entries for the current chapter (cached; re-filtered when authors change)
  let allCommentaryEntries: CommentaryEntry[] = [];

  // Rebuild the verse map whenever selected authors change
  $: {
    selectedCommentaryAuthors;
    rebuildCommentaryByVerse();
  }

  function rebuildCommentaryByVerse() {
    const map = new Map<string, CommentaryEntry[]>();
    for (const e of allCommentaryEntries) {
      if (selectedCommentaryAuthors.length === 0 || !selectedCommentaryAuthors.includes(e.author)) continue;
      const k = annotationKey(normalizeBookName(e.book), e.chapter, e.verseStart);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
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
  // Pending "Highlight All" request from a repeat pill (bulk mode for the modal)
  let bulkRepeatRequest: RepeatHighlightAllRequest | null = null;
  // When opening the normal Highlight modal on a word that is an active repeat
  // group, show the "this word / all repeating words" toggle.
  let highlightModalRepeatGroup: RepeatGroup | null = null;
  // Cached highlights for current chapter
  let chapterVerseHighlights: UserHighlight[] = [];
  let chapterWordHighlights: UserWordHighlight[] = [];

  // Morphology state
  let selectedMorphology: DBMorphology | null = null;

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
    showRedLetter = settings.showRedLetter !== false; // default true
  }

  // Listen for settings updates
  async function handleSettingsUpdate() {
    const prevRedLetter = showRedLetter;
    loadUserSettings();
    if (prevRedLetter !== showRedLetter) {
      await reRenderRedLetter();
    }
  }

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  // When windowId is set: use per-window contentState; never fall back to global nav
  $: currentBook = windowId
    ? (windowState?.contentState?.book ?? 'Genesis')
    : $navigationStore.book;
  $: currentChapter = windowId
    ? (windowState?.contentState?.chapter ?? 1)
    : $navigationStore.chapter;
  $: currentTranslation = windowId
    ? (windowState?.contentState?.translation ?? 'WEB')
    : $navigationStore.translation;
  $: translationFontClass = getTranslationFontClass(currentTranslation);
  $: isChronologicalMode = windowId ? false : ($navigationStore.isChronologicalMode ?? false);
  $: highlightVerse = windowId
    ? (windowState?.contentState?.highlightedVerse ?? null)
    : ($navigationStore.highlightedVerse ?? null);

  // ---------------------------------------------------------------------------
  // Harmony reading session
  // ---------------------------------------------------------------------------
  // Apply highlight immediately when readingPlanActiveTarget changes but we're already
  // on the target chapter (navKey doesn't change so loadChapter won't fire).
  let _lastRpTargetKey: string | null = null;
  $: {
    // Window panes are isolated — reading plan state is main-reader-only
    if (windowId) { _lastRpTargetKey = null; }
    const rpTarget = windowId ? null : $navigationStore.readingPlanActiveTarget;
    const newKey = rpTarget ? `${rpTarget.book}-${rpTarget.chapter}-${rpTarget.verse ?? 'null'}` : null;
    if (
      newKey !== null &&
      newKey !== _lastRpTargetKey &&
      rpTarget!.book === currentBook &&
      rpTarget!.chapter === currentChapter &&
      chapters.length > 0 &&
      chapters.some(c => c.book === rpTarget!.book && c.chapter === rpTarget!.chapter)
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
        await applyReadingPlanEndHighlight();
      });
    }
    if (newKey === null) _lastRpTargetKey = null;
  }

  // Apply the link-nav category-colored highlight (e.g. from the Character verse list).
  // Handles both same-chapter clicks and cross-book navigation: it only fires once the
  // loaded chapter actually matches the target, so cross-book nav applies after the new
  // chapter renders (not prematurely on the still-loaded old chapter).
  let _lastLinkHlKey: string | null = null;
  $: {
    const lhv = windowId ? null : $navigationStore.linkHighlightVerse;
    const onTarget =
      lhv != null &&
      chapters.length > 0 &&
      chapters.some((c) => c.book === currentBook && c.chapter === currentChapter);
    const key = lhv != null ? `${currentBook}-${currentChapter}-${lhv}` : null;
    if (onTarget && key !== _lastLinkHlKey) {
      _lastLinkHlKey = key;
      _linkNavHighlightVerse = lhv;
      tick().then(async () => {
        const el = readerElement?.querySelector(`.verse[data-verse="${lhv}"]`) as HTMLElement | null;
        if (el) scrollToVerseEl(el);
        await applyLinkNavHighlight();
        navigationStore.clearLinkHighlight();
      });
    }
    if (key === null) _lastLinkHlKey = null;
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
    clearReadingPlanEndHighlight();
    dayCompleteMessage = ctx.planName;
  }

  async function handleMarkAndContinue(ctx: any, book: string, chapter: number) {
    await readingProgressStore.setChapterAction(
      ctx.planId, ctx.dayNumber, ctx.todayChapters, { book, chapter }, 'checked'
    );
    if (ctx.nextChapter) {
      navigationStore.setReadingPlanActiveTarget(ctx.nextChapter.book, ctx.nextChapter.chapter, null, false);
      navigationStore.navigateTo(currentTranslation, ctx.nextChapter.book, ctx.nextChapter.chapter);
      navBarOffset = -68;
    }
  }

  function handleContinueOnly(ctx: any) {
    if (ctx.nextChapter) {
      navigationStore.setReadingPlanActiveTarget(ctx.nextChapter.book, ctx.nextChapter.chapter, null, false);
      navigationStore.navigateTo(currentTranslation, ctx.nextChapter.book, ctx.nextChapter.chapter);
      navBarOffset = -68;
    }
  }

  function handleAudioNextChapter(event: CustomEvent<{ book: string; chapter: number }>) {
    const { book, chapter } = event.detail;
    let nextBook = book;
    let nextChapter = chapter + 1;
    const bookInfo = BIBLE_BOOKS.find(b => b.name === book);
    if (bookInfo && nextChapter > bookInfo.chapters) {
      const idx = BIBLE_BOOKS.findIndex(b => b.name === book);
      nextBook = idx < BIBLE_BOOKS.length - 1 ? BIBLE_BOOKS[idx + 1].name : BIBLE_BOOKS[0].name;
      nextChapter = 1;
    }
    if (nextBook !== book) {
      navigationStore.setBook(nextBook);
    }
    navigationStore.setChapter(nextChapter);
  }

  async function handleStandardDayComplete(ctx: any) {
    await readingProgressStore.markDayComplete(ctx.planId, ctx.dayNumber, ctx.todayChapters);
    readingSessionStore.clearSession();
    navigationStore.clearReadingPlanActiveTarget();
    clearReadingPlanHighlight();
    clearReadingPlanEndHighlight();
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
      // If the chapter is already loaded in the continuous-reading chapters array
      // (e.g. because the user scrolled there and setScrollPosition updated the store),
      // don't reload — just update lastNavigationKey so we don't trigger again.
      // NOTE: always reload when translation changed, even if same book/chapter is cached,
      // because cached verses are from the old translation.
      const alreadyLoaded = chapters.some(
        c => c.book === currentBook && c.chapter === currentChapter
      );

      // Capture previous translation BEFORE updating lastNavigationKey
      const prevTranslation = lastNavigationKey.split("-")[0];
      const translationChanged = !!(prevTranslation && prevTranslation !== currentTranslation);
      lastNavigationKey = navKey;

      if (!alreadyLoaded || translationChanged) {
        console.log("🚀 Triggering loadChapter from reactive block");

        if (translationChanged) {
          console.log(
            `📚 Translation changed from ${prevTranslation} to ${currentTranslation}, verifying book exists...`,
          );
          // Capture scroll target before any async work clears it
          const scrollVerse = windowId ? (_windowScrollTarget ?? null) : ($navigationStore.scrollTargetVerse ?? null);
          _windowScrollTarget = null;
          // Verify the book exists in new translation, fallback if not
          verifyAndLoadChapter(currentTranslation, currentBook, currentChapter, scrollVerse);
        } else {
          const scrollVerse = windowId ? (_windowScrollTarget ?? null) : ($navigationStore.scrollTargetVerse ?? null);
          _windowScrollTarget = null;
          loadChapter(currentTranslation, currentBook, currentChapter, true, scrollVerse);
        }
      } else if (_reopenAnnotationVerse !== null) {
        // Chapter already in DOM (e.g. already appended by infinite scroll) — open panel directly
        openAnnotationPanel(_reopenAnnotationVerse, _reopenAnnotationTab, currentBook, currentChapter);
        _reopenAnnotationVerse = null;
      } else if (_reopenBookIntroPanel) {
        bookIntroPanelOpen = true;
        _reopenBookIntroPanel = false;
      }
    }
  }

  $: if (chapters.length > 0 && highlightVerse) {
    applySearchHighlight(highlightVerse);
  }

  $: if (!highlightVerse) {
    clearSearchHighlight();
  }

  // Commentary anchor: drift = anchor ON but a commentary window is pinned to a different book/chapter
  $: commCheckpointDrifted = ($navigationStore.commentaryAnchored === true) &&
    $windowStore.some(w =>
      w.contentType === 'commentaries' &&
      w.contentState?.book !== undefined &&
      (w.contentState.book !== $navigationStore.book || w.contentState.chapter !== $navigationStore.chapter)
    );

  // Re-sync: when drift clears (user clicked anchor to re-sync), push lastAnchorVerse to all commentary
  // windows so they scroll to the current Bible verse once their entries have loaded
  $: {
    if (prevCommDrifted && !commCheckpointDrifted && lastAnchorVerse !== null) {
      get(windowStore)
        .filter(w => w.contentType === 'commentaries')
        .forEach(w => windowStore.updateContentState(w.id, { highlightedVerse: lastAnchorVerse }));
    }
    prevCommDrifted = commCheckpointDrifted;
  }

  // Union of all checkpoint verse numbers across all open commentary windows
  $: commCheckpoints = [...new Set(
    $windowStore.flatMap(w =>
      w.contentType === 'commentaries' ? ((w.contentState?.checkpoints as number[]) ?? []) : []
    )
  )];

  // Apply/clear amber highlights whenever anchor state, drift, or checkpoints change
  $: if ($navigationStore.commentaryAnchored && !commCheckpointDrifted && commCheckpoints.length > 0 && chapters.length > 0) {
    applyAnchorHighlights(commCheckpoints);
  } else {
    clearAnchorHighlights();
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
      // Different chapter — update window or global nav; loadChapter will pick up scroll target.
      if (windowId) {
        _windowScrollTarget = verse;
        windowStore.updateContentState(windowId, { book, chapter, highlightedVerse: null });
      } else {
        navigationStore.navigateTo(currentTranslation, book, chapter, verse);
      }
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
  function normalizeForComparison(text: string): string {
    // NFD decompose → strip ALL combining diacritics:
    //   U+0300–036F  Greek polytonic accents (and general combining marks)
    //   U+0591–05C7  Hebrew cantillation marks + vowel points
    // Then lowercase and recompose NFC.
    // This lets "αβρααμ" match "Ἀβραὰμ" and "ב" match "בְּ".
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036F\u0591-\u05C7]/g, "")
      .toLowerCase()
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
        // Validate text — OSHB compound words like "בְּ/רֵאשִׁ֖ית" are stored as
        // one entry at word_index=0 but Intl.Segmenter counts '/' as a word
        // boundary, giving the second morpheme a visual index of 1. Guard: if
        // the matched entry's text doesn't correspond to what was clicked, fall
        // through so text-based fallbacks (especially Fallback 3's compound-
        // morpheme split) can locate the correct entry.
        const normClickedPrimary = normalizeForComparison(clickedText);
        const normEntry = normalizeForComparison(byIndex.text ?? '');
        const directOk = normEntry === normClickedPrimary;
        const compoundOk =
          !directOk &&
          !!byIndex.text?.includes('/') &&
          byIndex.text
            .split('/')
            .some((p) => normalizeForComparison(p) === normClickedPrimary);
        if (directOk || compoundOk) {
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
        if (DEBUG_MORPHOLOGY) {
          console.log(
            `⚠️ word_index ${clickedIndex} text mismatch: entry="${byIndex.text}" clicked="${clickedText}" — falling through to text fallbacks`,
          );
        }
      }
    }

    // Fallback 1: exact text match
    let byText = verseMorphs.find((m) => m.text === clickedText);
    if (byText) {
      morphStats.hits++;
      morphStats.textFallback++;
      if (DEBUG_MORPHOLOGY) {
        console.log(`✅ Morphology match by text: "${clickedText}"`, byText);
      }
      return byText;
    }

    // Fallback 2: normalize both sides — strips Greek accents AND Hebrew
    // cantillation/vowel points, lowercases. Fixes e.g. unaccented "αβρααμ"
    // (from BYZ verse text) matching "Ἀβραὰμ" (from OpenGNT morphology).
    const normClicked = normalizeForComparison(clickedText);
    byText = verseMorphs.find(
      (m) => normalizeForComparison(m.text) === normClicked,
    );
    if (byText) {
      morphStats.hits++;
      morphStats.textFallback++;
      if (DEBUG_MORPHOLOGY) {
        console.log(
          `✅ Morphology match by normalized text: "${clickedText}" → "${normClicked}"`,
          byText,
        );
      }
      return byText;
    }

    // Fallback 3: OSHB stores compound morphemes as "prefix/root" e.g.
    // "בְּ/רֵאשִׁ֖ית". Intl.Segmenter splits at '/' so the user clicks only
    // one morpheme part. Match if any part of a compound normalizes to the
    // clicked text.
    byText = verseMorphs.find((m) => {
      if (!m.text.includes('/')) return false;
      return m.text
        .split('/')
        .some((part) => normalizeForComparison(part) === normClicked);
    });
    if (byText) {
      morphStats.hits++;
      morphStats.textFallback++;
      if (DEBUG_MORPHOLOGY) {
        console.log(
          `✅ Morphology match by compound part: "${clickedText}" in "${byText.text}"`,
          byText,
        );
      }
      return byText;
    }

    morphStats.misses++;
    if (DEBUG_MORPHOLOGY) {
      console.log(
        `❌ No morphology match for index ${clickedIndex}, text "${clickedText}", normalized "${normClicked}"`,
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
    verseTextEl?: Element,
  ): { index: number; text: string } | null {
    // Get the character position from click coordinates
    const range = document.caretRangeFromPoint(clickX, clickY);
    if (!range) return null;

    // Compute the absolute character offset within the full verse text string.
    // range.startOffset is relative to range.startContainer (one text node),
    // NOT to the full verse text. If any hover span was not properly unwrapped
    // it splits the text into multiple nodes and startOffset becomes wrong
    // (e.g. offset 3 within the span's text node → always resolves to word 0).
    // We fix this by walking all text nodes inside the verse-text element with
    // a TreeWalker and summing lengths until we reach the caret's node.
    let clickOffset: number;
    if (verseTextEl && range.startContainer.nodeType === Node.TEXT_NODE) {
      let abs = 0;
      let found = false;
      const walker = document.createTreeWalker(verseTextEl, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        if (node === range.startContainer) {
          abs += range.startOffset;
          found = true;
          break;
        }
        abs += (node.textContent || "").length;
        node = walker.nextNode();
      }
      clickOffset = found ? abs : range.startOffset;
    } else {
      clickOffset = range.startOffset;
    }

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
      let lastWordSeg: { index: number; text: string } | null = null;

      for (const segment of segments as any[]) {
        const segmentStart = segment.index;
        const segmentEnd = segment.index + segment.segment.length;

        // Check if click is within this segment
        if (clickOffset >= segmentStart && clickOffset < segmentEnd) {
          if (segment.isWordLike) {
            return { index: wordIndex, text: segment.segment.normalize("NFC") };
          } else {
            // Click landed on '/', punctuation, or cantillation — return the
            // nearest preceding word-like segment. Handles OSHB prefix
            // separator clicks and avoids spurious "❌ Could not determine
            // clicked word" messages in Hebrew/Greek text.
            return lastWordSeg;
          }
        }

        // Count word index for word-like segments
        if (segment.isWordLike) {
          lastWordSeg = { index: wordIndex, text: segment.segment.normalize("NFC") };
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
    // Repeats are persistent/global — loadAndApplyHighlights re-applies them
    // after the new chapter renders; no need to clear here.
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

      // Load red-letter span data if needed
      if (showRedLetter && redLetterData === null) await loadRedLetterData();
      const rlMap = showRedLetter ? getChapterRedLetterMap(translation, book, chapter) : new Map();

      const processedVerses = chapterVerses.map((v) => {
        const { heading, textWithoutHeading } = extractHeading(v.text);
        const hlEntry = chapterHeadingMap.get(v.verse);
        const finalHeading = heading || v.heading || hlEntry?.heading || null;
        const paraStart = textWithoutHeading.startsWith('¶');
        const cleanText = paraStart ? textWithoutHeading.replace(/^¶\s*/, '') : textWithoutHeading;
        return {
          verse: v.verse,
          text: cleanText,
          html: renderVerseHtml(cleanText, rlMap.get(v.verse)),
          heading: finalHeading,
          headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
          paraStart,
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

      // Re-open annotation panel if user navigated back via the floating Back button
      if (_reopenAnnotationVerse !== null) {
        openAnnotationPanel(_reopenAnnotationVerse, _reopenAnnotationTab, book, chapter);
        _reopenAnnotationVerse = null;
      } else if (_reopenBookIntroPanel) {
        bookIntroPanelOpen = true;
        _reopenBookIntroPanel = false;
      }

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
        // Always attempt end highlight — end chapter may differ from start chapter
        await applyReadingPlanEndHighlight();
        if (_commNavHighlightVerse != null) {
          await applyCommNavHighlight();
        }
      }
    } catch (err: unknown) {
      console.error("Error loading chapter:", err);
      error = `Failed to load ${book} ${chapter}. Make sure you have packs installed.`;
      chapters = [];
    } finally {
      loading = false;
      if (chapters.length > 0) checkViewportFill();
    }
  }

  function clearReadingPlanEndHighlight(): void {
    readerElement?.querySelectorAll('.rp-verse-end-highlight').forEach(el => {
      el.classList.remove('rp-verse-end-highlight');
      (el as HTMLElement).style.removeProperty('--rp-hl-right');
    });
  }

  async function applyReadingPlanEndHighlight(): Promise<void> {
    await tick();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const session = get(readingSessionStore);
    if (!session || !readerElement) return;
    clearReadingPlanEndHighlight();
    // Find today's last chapter from plan data
    const raw = localStorage.getItem(STORAGE_ACTIVE_PLANS);
    if (!raw) return;
    const activePlans: Array<{ id: string; plan: any }> = JSON.parse(raw);
    const planEntry = activePlans.find(p => p.id === session.planId);
    if (!planEntry) return;
    const dayData = planEntry.plan.days?.find((d: any) => d.dayNumber === session.dayNumber);
    if (!dayData) return;
    let lastBook: string;
    let lastChapter: number;
    if (planEntry.plan.config?.ordering === 'harmony') {
      const allPassages = (dayData.harmonySections ?? []).flatMap((s: any) => s.passages);
      const last = allPassages[allPassages.length - 1];
      if (!last) return;
      lastBook = normalizeBookName(last.book);
      lastChapter = last.endChapter;
    } else {
      const todayChapters: Array<{ book: string; chapter: number }> = dayData.chapters ?? [];
      if (!todayChapters.length) return;
      const last = todayChapters[todayChapters.length - 1];
      lastBook = normalizeBookName(last.book);
      lastChapter = last.chapter;
    }
    // Only apply if that chapter is currently in the DOM
    const section = readerElement.querySelector<HTMLElement>(
      `[data-chapter-section][data-book="${lastBook}"][data-chapter="${lastChapter}"]`
    );
    if (!section) return;
    // Last .verse in that chapter section
    const allVerses = section.querySelectorAll<HTMLElement>('.verse');
    const verseEl = allVerses[allVerses.length - 1] ?? null;
    if (!verseEl) return;
    const textEl = verseEl.querySelector('.verse-text') as HTMLElement | null;
    const rightOffset = textEl ? textEl.offsetLeft : 32;
    verseEl.style.setProperty('--rp-hl-right', `${rightOffset}px`);
    verseEl.classList.add('rp-verse-end-highlight');
  }

  function clearReadingPlanHighlight(): void {
    readerElement?.querySelectorAll('.rp-verse-highlight').forEach(el => {
      el.classList.remove('rp-verse-highlight');
      (el as HTMLElement).style.removeProperty('--rp-hl-left');
    });
  }

  async function applyReadingPlanHighlight(): Promise<void> {
    await tick();
    // Wait for browser layout to settle before measuring offsetLeft
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
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

  function clearCommNavHighlight(): void {
    readerElement?.querySelectorAll('.comm-nav-verse-highlight').forEach(el => {
      el.classList.remove('comm-nav-verse-highlight');
      (el as HTMLElement).style.removeProperty('--rp-hl-left');
    });
  }

  async function applyCommNavHighlight(): Promise<void> {
    await tick();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (!readerElement || _commNavHighlightVerse == null) return;
    clearCommNavHighlight();
    const verseEl = readerElement.querySelector(
      `.verse[data-verse="${_commNavHighlightVerse}"]`
    ) as HTMLElement | null;
    if (!verseEl) return;
    const textEl = verseEl.querySelector('.verse-text') as HTMLElement | null;
    const leftOffset = textEl ? textEl.offsetLeft : 32;
    verseEl.style.setProperty('--rp-hl-left', `${leftOffset}px`);
    verseEl.classList.add('comm-nav-verse-highlight');
    _commNavHighlightVerse = null;
  }

  function clearLinkNavHighlight(): void {
    readerElement?.querySelectorAll('.link-nav-verse-highlight').forEach(el => {
      el.classList.remove('link-nav-verse-highlight');
      (el as HTMLElement).style.removeProperty('--rp-hl-left');
      (el as HTMLElement).style.removeProperty('--link-hl-color');
    });
  }

  // Highlight the navigated verse with a fade gradient in the target book's category color.
  async function applyLinkNavHighlight(): Promise<void> {
    await tick();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (!readerElement || _linkNavHighlightVerse == null) return;
    clearLinkNavHighlight();
    const verseEl = readerElement.querySelector(
      `.verse[data-verse="${_linkNavHighlightVerse}"]`
    ) as HTMLElement | null;
    if (!verseEl) return;
    const textEl = verseEl.querySelector('.verse-text') as HTMLElement | null;
    const leftOffset = textEl ? textEl.offsetLeft : 32;
    verseEl.style.setProperty('--rp-hl-left', `${leftOffset}px`);
    verseEl.style.setProperty('--link-hl-color', hexToRgba(getCategoryColor(currentBook), 0.45));
    verseEl.classList.add('link-nav-verse-highlight');
    _linkNavHighlightVerse = null;
  }

  function hexToRgba(hex: string, alpha: number): string {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
        // Saved highlights use char offsets, so clear repeat spans first, then
        // re-apply the repeats overlay on top.
        clearRepeatsInSection(section);
        applyChapterHighlights(section, vHl, wHl, currentTranslation);
        applyRepeatsToSection(section, get(repeatsStore));
      }
      // Derive book-intro pills from the (now-synced) highlights.
      await refreshBookIntroPills();
    } catch (err) {
      console.warn('[Highlights] load error:', err);
    }
  }

  async function loadAnnotations(book: string, chapter: number, clearFirst = true) {
    if (clearFirst) {
      allCommentaryEntries = [];
      tskByVerse = new Map<string, TskEntry[]>();
      commentaryByVerse = new Map<string, CommentaryEntry[]>();
    }
    try {
      // Load all data unconditionally — display is controlled reactively by showReferences / selectedCommentaryAuthors
      const [entries, tsk] = await Promise.all([
        commentaryStore.getChapterCommentary(book, chapter),
        tskStore.getChapterReferences(book, chapter),
      ]);
      allCommentaryEntries = clearFirst ? entries : [...allCommentaryEntries, ...entries];
      for (const [verse, list] of tsk) {
        tskByVerse.set(annotationKey(book, chapter, verse), list);
      }
      tskByVerse = tskByVerse; // trigger Svelte reactivity
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
      for (const note of notes) {
        if (note.reference.book === book && note.reference.chapter === chapter && note.text?.trim()) {
          verseNotesMap.set(annotationKey(note.reference.book, note.reference.chapter, note.reference.verse), note.id);
        }
      }
      verseNotesMap = verseNotesMap; // trigger Svelte reactivity
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
    verseNotesMap.set(annotationKey(book, chapter, verse), noteId);
    verseNotesMap = verseNotesMap; // trigger Svelte reactivity
  }

  function handleNoteDeleted(e: CustomEvent<{ book: string; chapter: number; verse: number }>) {
    const { book, chapter, verse } = e.detail;
    verseNotesMap.delete(annotationKey(book, chapter, verse));
    verseNotesMap = verseNotesMap; // trigger Svelte reactivity
  }

  function getTranslationFontClass(id: string): string {
    const t = (id || '').toLowerCase();
    if (t === 'kjv' || t === 'kjvpce') return 'translation-font-kjv';
    if (t === 'web' || t === 'bsb' || t === 'net') return 'translation-font-web';
    // Greek source texts
    const looksEnglish = t.includes('english') || t.includes('brenton');
    if (t === 'byz' || t === 'tr') return 'translation-font-greek';
    if (t.includes('gnt') || t.includes('sblgnt') || t.includes('opengnt')) return 'translation-font-greek';
    if (t.includes('greek')) return 'translation-font-greek';
    const isLxx = t.includes('lxx') || t.includes('septuagint');
    if (isLxx && !looksEnglish) return 'translation-font-greek';
    return '';
  }

  function openAnnotationPanel(verse: number, tab: "references" | "commentary", book = currentBook, chapter = currentChapter, targetAuthor = '') {
    annotationPanelVerse = verse;
    annotationPanelBook = book;
    annotationPanelChapter = chapter;
    annotationPanelTab = tab;
    annotationPanelTargetAuthor = targetAuthor;
    annotationPanelTsk = tskByVerse.get(annotationKey(book, chapter, verse)) ?? [];
    annotationPanelCommentary = commentaryByVerse.get(annotationKey(book, chapter, verse)) ?? [];
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

      // Determine coverage by probing Genesis (data-driven, no hardcoded IDs needed).
      // If Genesis exists → OT-capable translation → go to Genesis.
      // If Genesis also empty → NT-only translation → go to Matthew.
      const genesisVerses = await textStore.getChapter(translation, "Genesis", 1);
      const fallbackBook = (genesisVerses && genesisVerses.length > 0) ? "Genesis" : "Matthew";
      const fallbackChapter = 1;

      console.log(`📍 Falling back to ${fallbackBook} ${fallbackChapter} (Genesis probe: ${genesisVerses?.length ?? 0} verses)`);

      // Update navigation to reflect the fallback
      if (windowId) {
        windowStore.updateContentState(windowId, { book: fallbackBook, chapter: fallbackChapter, highlightedVerse: null });
      } else {
        navigationStore.navigateTo(translation, fallbackBook, fallbackChapter);
      }
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

  // On large screens the entire chapter may fit in the viewport with no scrollbar,
  // so scroll events never fire and loadNextChapter is never triggered.
  // After a chapter loads (or after a next-chapter is appended), call this to
  // proactively fill the viewport by loading additional chapters as needed.
  async function checkViewportFill() {
    if (!readerElement) return;
    await tick();
    if (readerElement.scrollHeight <= readerElement.clientHeight + 200) {
      loadNextChapter();
    }
  }

  async function loadNextChapter() {
    if (isLoadingNextChapter || chapters.length === 0) return;
    isLoadingNextChapter = true;
    let didAddChapter = false;

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
        if (showRedLetter && redLetterData === null) await loadRedLetterData();
        const rlMap = showRedLetter ? getChapterRedLetterMap(currentTranslation, nextBook, nextChapter) : new Map();
        const processedVerses = nextVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          const hlEntry = nextHeadingMap.get(v.verse);
          const finalHeading = heading || v.heading || hlEntry?.heading || null;
          const paraStart = textWithoutHeading.startsWith('¶');
          const cleanText = paraStart ? textWithoutHeading.replace(/^¶\s*/, '') : textWithoutHeading;
          return {
            verse: v.verse,
            text: cleanText,
            html: renderVerseHtml(cleanText, rlMap.get(v.verse)),
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
            paraStart,
          };
        });

        // Append without triggering navigation update
        chapters = [
          ...chapters,
          { book: nextBook, chapter: nextChapter, verses: processedVerses },
        ];
        await loadAnnotations(nextBook, nextChapter, false);
        await applyReadingPlanEndHighlight();
        didAddChapter = true;
      }
    } catch (err) {
      console.error("Error loading next chapter:", err);
    } finally {
      isLoadingNextChapter = false;
      if (didAddChapter) checkViewportFill();
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
        if (showRedLetter && redLetterData === null) await loadRedLetterData();
        const rlMap = showRedLetter ? getChapterRedLetterMap(currentTranslation, prevBook, prevChapter) : new Map();
        const processedVerses = prevVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          const hlEntry = prevHeadingMap.get(v.verse);
          const finalHeading = heading || v.heading || hlEntry?.heading || null;
          const paraStart = textWithoutHeading.startsWith('¶');
          const cleanText = paraStart ? textWithoutHeading.replace(/^¶\s*/, '') : textWithoutHeading;
          return {
            verse: v.verse,
            text: cleanText,
            html: renderVerseHtml(cleanText, rlMap.get(v.verse)),
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
            paraStart,
          };
        });

        // Remember scroll position
        const oldScrollHeight = readerElement.scrollHeight;

        // Prepend without triggering navigation update
        chapters = [
          { book: prevBook, chapter: prevChapter, verses: processedVerses },
          ...chapters,
        ];
        await loadAnnotations(prevBook, prevChapter, false);

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

  /** Fully unwrap the hover span from the DOM and null the reference. */
  function clearHoverHighlight() {
    if (!hoveredWordElement) return;
    const parent = hoveredWordElement.parentNode;
    while (hoveredWordElement.firstChild) {
      parent?.insertBefore(hoveredWordElement.firstChild, hoveredWordElement);
    }
    parent?.removeChild(hoveredWordElement);
    parent?.normalize(); // merge the text nodes back into one
    hoveredWordElement = null;
  }

  function handleMouseMove(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Clear any previous hover — must fully unwrap the span so the DOM text
    // nodes are merged back. Leaving orphan spans splits the text node and
    // corrupts caretRangeFromPoint offsets on the next click.
    clearHoverHighlight();

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
      const clickInfo = getClickWordInfo(x, y, fullVerseText, verseText);

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

      // Build a DOM Range for the clicked GH word so bumper handles,
      // word-level highlighting and dragging work identically to English.
      // getClickWordInfo already called caretRangeFromPoint internally;
      // calling it again here is safe — same coords, clean DOM state.
      const ghCaret = document.caretRangeFromPoint(x, y);
      if (ghCaret) {
        let ghTextNode: Node = ghCaret.startContainer;
        if (ghTextNode.nodeType !== Node.TEXT_NODE) {
          const ghWalker = document.createTreeWalker(
            ghTextNode,
            NodeFilter.SHOW_TEXT,
            null,
          );
          const firstGhText = ghWalker.nextNode();
          if (firstGhText) ghTextNode = firstGhText;
        }
        if (ghTextNode.nodeType === Node.TEXT_NODE) {
          const ghNodeText = ghTextNode.textContent || "";
          const ghBounds = getWordBounds(ghNodeText, ghCaret.startOffset);
          if (ghBounds) {
            try {
              const ghRange = document.createRange();
              ghRange.setStart(ghTextNode, ghBounds.start);
              ghRange.setEnd(ghTextNode, ghBounds.end);
              selectionRange = ghRange;
              highlightSelection(ghRange, selectionMode);
            } catch (ghErr) {
              console.error("GH range creation failed:", ghErr);
            }
          }
        }
      }

      // Clear any residual browser text selection (highlightSelection adds
      // its own selection via addRange, so only clear if no range was built).
      if (!selectionRange) {
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
      }

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
      selectedVerseNumber = verseNumInt;

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

        // For RTL text (Hebrew), the visual "left" handle is the reading-end
        // of the word and the visual "right" handle is the reading-start.
        // Swap the drag-edge assignments so dragging toward reading-start
        // always extends the selection backward and vice-versa.
        const isRTL =
          getComputedStyle(textContainer as Element).direction === "rtl" ||
          currentTranslation === "hebrew-oshb" ||
          currentTranslation === "wlc";

        const startEdge = isRTL ? ("right" as const) : ("left" as const);
        const endEdge = isRTL ? ("left" as const) : ("right" as const);

        // Left handle at start of selection
        const leftHandle = document.createElement("div");
        leftHandle.className = "drag-handle-float left";
        leftHandle.style.position = "absolute";
        leftHandle.style.left = `${firstRect.left - containerRect.left}px`;
        leftHandle.style.top = `${firstRect.top - containerRect.top + textContainer.scrollTop}px`;
        leftHandle.style.height = `${firstRect.height}px`;
        leftHandle.addEventListener("mousedown", (e) => startDrag(e, startEdge));
        leftHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, startEdge),
          { passive: false },
        );

        // Right handle at end of selection
        const rightHandle = document.createElement("div");
        rightHandle.className = "drag-handle-float right";
        rightHandle.style.position = "absolute";
        rightHandle.style.left = `${lastRect.right - containerRect.left}px`;
        rightHandle.style.top = `${lastRect.top - containerRect.top + textContainer.scrollTop}px`;
        rightHandle.style.height = `${lastRect.height}px`;
        rightHandle.addEventListener("mousedown", (e) => startDrag(e, endEdge));
        rightHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, endEdge),
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

  // Commentary anchor: highlight all checkpoint verses in BibleReader (no scrolling)
  async function applyAnchorHighlights(checkpoints: number[]) {
    clearAnchorHighlights();
    await tick();
    if (!readerElement) return;
    for (const n of checkpoints) {
      const el = readerElement.querySelector(`.verse[data-verse="${n}"]`) as HTMLElement | null;
      if (el) {
        el.classList.add('comm-anchor-highlight');
        anchorHighlightedElements.push(el);
      }
    }
  }

  function clearAnchorHighlights() {
    for (const el of anchorHighlightedElements) {
      el.classList.remove('comm-anchor-highlight');
    }
    anchorHighlightedElements = [];
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
      } else if (!el.classList.contains("repeat-hl")) {
        // Don't remove repeat highlights here - they have their own clear function
        el.remove();
      }
    });
    highlightedElements = highlightedElements.filter((el) =>
      el.classList.contains("repeat-hl"),
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
    // Re-assert word mode so a drag can't silently flip the selection type
    if (selectionRange) {
      selectionMode = 'word';
    }
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
    // Clear any hover highlight — full unwrap required (see clearHoverHighlight)
    clearHoverHighlight();

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

  // Toggle a word in the persistent, global Repeats overlay. The reactive
  // statement on $repeatsStore re-applies the in-text highlights everywhere.
  function toggleRepeats(word: string) {
    repeatsStore.toggle(word);
  }

  // Re-paint repeat highlights across all rendered chapter sections. Called
  // reactively whenever the repeats store changes, and after the DOM settles.
  async function repaintRepeats(groups: RepeatGroup[]) {
    await tick();
    if (!readerElement) return;
    applyRepeatsToAllSections(readerElement, groups);
  }

  // Re-apply the global repeats overlay whenever the tracked words change or a
  // new chapter scrolls into view (referencing chapters keeps it reactive).
  $: if (readerElement && chapters) void repaintRepeats($repeatsStore);

  // A repeat pill requested "Highlight All" — open the modal in bulk mode.
  $: if ($repeatHighlightAllRequest) {
    const req = $repeatHighlightAllRequest;
    repeatHighlightAllRequest.set(null);
    openBulkHighlightModal(req);
  }

  function openBulkHighlightModal(req: RepeatHighlightAllRequest) {
    bulkRepeatRequest = req;
    highlightModalRepeatGroup = null;
    highlightSelectionType = 'word';
    highlightModalExisting = null;
    highlightModalRef = { book: currentBook, chapter: currentChapter, verse: 1 };
    highlightModalOpen = true;
  }

  // Expand a scope into the list of (book, chapter) targets to scan.
  function getScopeChapters(scope: 'chapter' | 'book'): { book: string; chapter: number }[] {
    if (scope === 'chapter') return [{ book: currentBook, chapter: currentChapter }];
    const b = BIBLE_BOOKS.find((x) => x.name === currentBook);
    const n = b?.chapters ?? 1;
    return Array.from({ length: n }, (_, i) => ({ book: currentBook, chapter: i + 1 }));
  }

  // A book-intro pill, derived from synced word-highlights carrying a repeatWord.
  type IntroPill = { book: string; word: string; label: string; color: string; highlightIds: string[] };

  // Convert a repeat group into real, saved word highlights across the scope.
  async function applyBulkRepeatHighlight(req: RepeatHighlightAllRequest, style: HighlightStyle) {
    const targets = getScopeChapters(req.scope);
    // Stamp each highlight with the repeat word (rides inside the synced style)
    // so the book-intro pill can be derived from — and sync with — the highlights.
    const stampedStyle: HighlightStyle = { ...style, repeatWord: req.label };
    // Skip occurrences already highlighted for this word+translation (so
    // re-highlighting, or chapter-then-book, doesn't create duplicates).
    const existing = await userDataStore.getBookWordHighlights(currentBook);
    const taken = new Set(
      existing
        .filter((h) => h.translation === currentTranslation)
        .map((h) => `${h.reference.chapter}:${h.reference.verse}:${h.wordStart}`),
    );
    const tmp = document.createElement('div');
    for (const t of targets) {
      let verses: any[] | null = null;
      try {
        verses = await textStore.getChapter(currentTranslation, t.book, t.chapter);
      } catch {
        continue;
      }
      if (!verses) continue;
      for (const v of verses) {
        const { textWithoutHeading } = extractHeading(v.text);
        const cleanText = textWithoutHeading.replace(/^¶\s*/, '');
        tmp.innerHTML = renderVerseHtml(cleanText);
        const rendered = tmp.textContent || '';
        const occs = findRepeatOccurrences(rendered, req.word);
        for (const occ of occs) {
          if (taken.has(`${t.chapter}:${v.verse}:${occ.wordStart}`)) continue;
          const saved = await userDataStore.saveWordHighlight({
            reference: { book: t.book, chapter: t.chapter, verse: v.verse },
            translation: currentTranslation,
            wordStart: occ.wordStart,
            wordLength: occ.wordLength,
            style: stampedStyle,
          });
          await syncQueue.enqueue({
            type: 'INSERT',
            table: 'user_word_highlights',
            id: saved.id,
            data: {
              id: saved.id, book: t.book, chapter: t.chapter, verse: v.verse,
              translation: currentTranslation, word_start: saved.wordStart,
              word_length: saved.wordLength, style: JSON.stringify(saved.style),
              created_at: saved.createdAt.toISOString(),
            },
          });
        }
      }
    }
    // Drop the scratch repeat group (removes the navbar pill + soft coloring).
    repeatsStore.remove(req.word);
    // Re-render highlights on every currently loaded chapter (also derives pills).
    for (const c of chapters) {
      await loadAndApplyHighlights(c.book, c.chapter);
    }
    await refreshBookIntroPills();
  }

  // ── Repeat counts + book-intro relocation ──────────────────────────────────

  // Book-intro pills, derived from synced word-highlights carrying a repeatWord.
  let introPillsByBook = new Map<string, IntroPill[]>();

  // Rebuild intro pills for every distinct loaded book from saved highlights.
  async function refreshBookIntroPills() {
    const books = Array.from(new Set(chapters.map((c) => c.book)));
    if (currentBook && !books.includes(currentBook)) books.push(currentBook);
    const next = new Map<string, IntroPill[]>();
    for (const book of books) {
      let rows: UserWordHighlight[] = [];
      try {
        rows = await userDataStore.getBookWordHighlights(book);
      } catch {
        continue;
      }
      const byWord = new Map<string, IntroPill>();
      for (const h of rows) {
        const label = h.style?.repeatWord;
        if (!label) continue;
        const key = normalizeRepeatWord(label);
        if (!key) continue;
        const pill = byWord.get(key);
        if (pill) {
          pill.highlightIds.push(h.id);
        } else {
          byWord.set(key, { book, word: key, label, color: h.style.color, highlightIds: [h.id] });
        }
      }
      if (byWord.size > 0) next.set(book, [...byWord.values()]);
    }
    introPillsByBook = next; // reassign for reactivity (also re-triggers counts)
  }

  // Recompute occurrence counts (current book) for scratch + permanent words.
  async function refreshRepeatCounts(
    book: string,
    translation: string,
    repeats: RepeatGroup[],
    pillsByBook: Map<string, IntroPill[]>,
  ) {
    const words = new Set<string>();
    for (const g of repeats) words.add(g.word);
    for (const p of pillsByBook.get(book) ?? []) words.add(p.word);
    if (words.size === 0 || !book || !translation) {
      repeatCountsStore.set(new Map());
      return;
    }
    const map = await countWordsInBook(translation, book, [...words]);
    repeatCountsStore.set(map);
  }

  // Recompute counts when book/translation, scratch words, or derived pills change.
  $: void refreshRepeatCounts(currentBook, currentTranslation, $repeatsStore, introPillsByBook);

  // Readable text color over a (typically light) highlight color.
  function repeatPillTextColor(hex: string): string {
    const h = hex.replace('#', '');
    if (h.length < 6) return '#1a1a1a';
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#1a1a1a' : '#fff';
  }

  // Intro-area pill dropdown state (keyed by `${book}:${word}`)
  let introMenuKey: string | null = null;
  let introMenuView: 'main' | 'scope' = 'main';

  function toggleIntroMenu(book: string, word: string) {
    const key = `${book}:${word}`;
    if (introMenuKey === key) {
      introMenuKey = null;
    } else {
      introMenuKey = key;
      introMenuView = 'main';
    }
  }

  function introHighlightAll(rec: IntroPill, scope: 'chapter' | 'book') {
    introMenuKey = null;
    repeatHighlightAllRequest.set({ word: rec.word, label: rec.label, scope, colorIndex: 0 });
  }

  async function introDeselect(rec: IntroPill) {
    introMenuKey = null;
    for (const id of rec.highlightIds) {
      try {
        await userDataStore.deleteWordHighlight(id);
        await syncQueue.enqueue({ type: 'DELETE', table: 'user_word_highlights', id });
      } catch {
        // ignore already-deleted
      }
    }
    for (const c of chapters) {
      await loadAndApplyHighlights(c.book, c.chapter);
    }
    await refreshBookIntroPills();
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
            const { lookupWord, lookupStrongs, lookupEnglishWord, lookupPerson } = await import('../adapters/lexicon-lookup.js');
            console.log('✅ Module imported successfully');

            // Resolve the clicked word as a biblical character, disambiguating by
            // the verse it was clicked in (handles homonyms like the six Marys).
            const verseRefForPerson = selectedVerseNumber != null
              ? { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber }
              : null;
            const characterData = await lookupPerson(text, verseRefForPerson);
            if (characterData) console.log('👤 Character match:', characterData.person.id, 'byVerse:', characterData.matchedByVerse);

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
                  characterData,
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
                  characterData,
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
                characterData,
                selectedText: text,
                strongsId: capturedMorphology.strongsId,
                morphologyData: capturedMorphology,
                lexicalEntries: null,
              });
              return;
            } else if (capturedMorphology) {
              // Have morphology but no Strong's ID
              lexicalModalStore.open({
                characterData,
                selectedText: text,
                strongsId: undefined,
                morphologyData: capturedMorphology,
                lexicalEntries: null,
              });
              return;
            } else if (isOriginalLanguage(currentTranslation)) {
              // Original language word with no morphology in IDB — pack may not
              // be installed yet or this specific form has no match.
              // Open the modal in a "no data" state; don't fall through to the
              // English lexicon lookup.
              console.log(`ℹ️ No morphology found for original-language word: "${text}"`);
              lexicalModalStore.open({
                characterData,
                selectedText: text,
                strongsId: undefined,
                morphologyData: null,
                lexicalEntries: null,
              });
              return;
            } else {
              // English word — look up in lexical pack
              const entries = await lookupWord(text);
              if (entries.length > 0) {
                console.log(`Found ${entries.length} lexical entries:`, entries);
              } else {
                console.log('No lexical entries found for:', text);
                console.log('💡 Make sure you have installed the "Lexical Resources Pack" from the Packs menu.');
              }
              lexicalModalStore.open({
                characterData,
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
              characterData,
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
        bulkRepeatRequest = null;
        // If this word is an active repeat group, the modal shows the
        // "this word / all repeating words" toggle.
        highlightModalRepeatGroup = selectionMode === 'word'
          ? (get(repeatsStore).find(g => g.word === normalizeRepeatWord(text)) ?? null)
          : null;
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

    if (!target.closest(".intro-repeat-wrap")) introMenuKey = null;

    if (!target.closest(".selection-highlight") && !target.closest(".toast")) {
      showToast = false;
      clearHighlights();
    }
  }

  // Commentary anchor: re-observe verses after each chapter load
  $: if (chapters.length > 0 && readerElement) {
    tick().then(setupVerseObserver);
  }

  function setupVerseObserver() {
    if (verseObserver) {
      verseObserver.disconnect();
      verseObserver = null;
    }
    visibleVersePositions.clear();
    if (!readerElement) return;

    verseObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const verseNum = parseInt(el.dataset.verse ?? '0', 10);
          if (verseNum <= 0) continue;
          const info = verseElInfo.get(el);
          if (!info) continue;
          const key = `${info.book}::${info.chapter}::${verseNum}`;
          if (entry.isIntersecting) {
            visibleVersePositions.set(key, { book: info.book, chapter: info.chapter, verse: verseNum, top: entry.boundingClientRect.top });
          } else {
            visibleVersePositions.delete(key);
          }
        }

        if (visibleVersePositions.size === 0) return;

        // Pick the entry closest to the top of the visible zone
        let topEntry: { book: string; chapter: number; verse: number; top: number } | null = null;
        let minTop = Infinity;
        for (const e of visibleVersePositions.values()) {
          if (e.top >= 0 && e.top < minTop) { minTop = e.top; topEntry = e; }
        }
        // Fall back: nearest to top regardless of sign
        if (!topEntry) {
          let closestTop = Infinity;
          for (const e of visibleVersePositions.values()) {
            if (Math.abs(e.top) < closestTop) { closestTop = Math.abs(e.top); topEntry = e; }
          }
        }

        if (!topEntry) return;

        if (anchorSyncDebounce) clearTimeout(anchorSyncDebounce);
        const captured = { ...topEntry };
        anchorSyncDebounce = setTimeout(() => {
          // Always update navbar position — this is what keeps the navbar and
          // commentary in sync as the user scrolls through multiple chapters.
          // Window panes must NOT write back to global nav — they are isolated.
          if (!windowId) {
            navigationStore.setScrollPosition(captured.book, captured.chapter);
          }

          if (!(get(navigationStore).commentaryAnchored ?? false)) return;
          lastAnchorVerse = captured.verse;
          // Push directly to each commentary window's contentState — never touches
          // $navigationStore.highlightedVerse so applySearchHighlight never fires (no loop)
          get(windowStore)
            .filter(w => w.contentType === 'commentaries')
            .forEach(w => windowStore.updateContentState(w.id, { highlightedVerse: captured.verse }));
        }, 150);
      },
      {
        root: readerElement,
        threshold: 0,
        rootMargin: '-5% 0px -50% 0px', // top 45% of viewport is the active zone
      }
    );

    const verseEls = readerElement.querySelectorAll<HTMLElement>('.verse[data-verse]');
    verseEls.forEach(el => {
      // Resolve and cache book/chapter by walking up to the nearest chapter-section
      const section = el.closest('[data-book][data-chapter]') as HTMLElement | null;
      if (section) {
        verseElInfo.set(el, { book: section.dataset.book!, chapter: parseInt(section.dataset.chapter!, 10) });
      }
      verseObserver!.observe(el);
    });
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

    // Reload note icons when a remote change arrives (cross-device sync)
    const unsubscribeNoteChanges = subscribeToUserDataRemoteChanges(() => {
      const visible = detectVisibleChapter();
      if (visible) {
        loadVerseNotes(visible.book, visible.chapter);
      } else if (chapters.length > 0) {
        loadVerseNotes(chapters[0].book, chapters[0].chapter);
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
      unsubscribeNoteChanges();
      stopScrollDetection();
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
      if (longPressTimer) clearTimeout(longPressTimer);
      if (anchorSyncDebounce) clearTimeout(anchorSyncDebounce);
      if (verseObserver) { verseObserver.disconnect(); verseObserver = null; }

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
    bulkDescription={bulkRepeatRequest
      ? `All “${bulkRepeatRequest.label}” · ${bulkRepeatRequest.scope === 'chapter' ? 'Current Chapter' : 'Entire Book'}`
      : null}
    isRepeatWord={highlightModalRepeatGroup !== null}
    on:save={async (e) => {
      if (!highlightModalRef) return;
      const { style, applyToAllRepeats } = e.detail;
      highlightModalOpen = false;

      if (bulkRepeatRequest) {
        const req = bulkRepeatRequest;
        bulkRepeatRequest = null;
        await applyBulkRepeatHighlight(req, style);
        return;
      }

      // Word that is an active repeat group, with "all repeating words" chosen:
      // apply to every occurrence in the current chapter.
      if (applyToAllRepeats && highlightModalRepeatGroup) {
        const grp = highlightModalRepeatGroup;
        highlightModalRepeatGroup = null;
        await applyBulkRepeatHighlight(
          { word: grp.word, label: grp.label, scope: 'chapter', colorIndex: grp.colorIndex },
          style,
        );
        return;
      }

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
      if (section) {
        clearRepeatsInSection(section);
        applyChapterHighlights(section, chapterVerseHighlights, chapterWordHighlights, currentTranslation);
        applyRepeatsToSection(section, get(repeatsStore));
      }
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
          // A relocated book-intro pill may now have lost a highlight — re-derive.
          await refreshBookIntroPills();
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
        if (section) {
          clearRepeatsInSection(section);
          applyChapterHighlights(section, chapterVerseHighlights, chapterWordHighlights, currentTranslation);
          applyRepeatsToSection(section, get(repeatsStore));
        }
      }
    }}
    on:close={() => { highlightModalOpen = false; bulkRepeatRequest = null; highlightModalRepeatGroup = null; }}
  />
{/if}

<BookIntroPanel
  open={bookIntroPanelOpen}
  book={bookIntroPanelBook}
  on:close={() => (bookIntroPanelOpen = false)}
  on:navigateTo={handleBookIntroNavigateTo}
/>

<AnnotationPanel
  bind:open={annotationPanelOpen}
  book={annotationPanelBook}
  chapter={annotationPanelChapter}
  verse={annotationPanelVerse}
  tskEntries={annotationPanelTsk}
  commentaryEntries={annotationPanelCommentary}
  initialTab={annotationPanelTab}
  targetAuthor={annotationPanelTargetAuthor}
  panelLeft={readerLeft}
  panelWidth={readerClientWidth}
  on:close={() => (annotationPanelOpen = false)}
  on:navigateTo={handleAnnotationNavigateTo}
/>


<div class="bible-reader" bind:this={readerElement} bind:clientWidth={readerClientWidth}>
  <NavigationBar
    {windowId}
    style="transform: translateY({windowId ? navBarOffset : displayNavOffset}px); transition: transform 0.25s ease;"
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
        {@const chPlanCtxs = computeAllPlanContexts(chapterData.book, chapterData.chapter, $readingSessionStore)}
        {@const chHarmCtxs = chPlanCtxs.filter((c) => c.type === 'harmony')}
        {@const chStdCtxs = chPlanCtxs.filter((c) => c.type === 'standard')}
        <div class="chapter-section" data-chapter-section data-book={chapterData.book} data-chapter={chapterData.chapter}>
          <div class="chapter-header">
            <h1>{chapterData.book} {chapterData.chapter}</h1>
            {#if chapterData.chapter === 1}
              <div class="intro-row">
              <button
                class="book-intro-btn"
                on:click={() => openBookIntroPanel(chapterData.book)}
                title="Introduction to {chapterData.book}"
              >📖 Introduction</button>
              {#each (introPillsByBook.get(chapterData.book) ?? []) as rec (rec.word)}
                <div class="intro-repeat-wrap">
                  <button
                    class="intro-repeat-pill"
                    style="--irp-bg: {rec.color}; --irp-fg: {repeatPillTextColor(rec.color)};"
                    class:open={introMenuKey === `${rec.book}:${rec.word}`}
                    on:click|stopPropagation={() => toggleIntroMenu(rec.book, rec.word)}
                    title="Highlighted repeat: {rec.label}"
                  >
                    <span class="intro-repeat-label">{rec.label}</span>
                    {#if $repeatCountsStore.get(rec.word) !== undefined}
                      <span class="repeat-pill-count">({$repeatCountsStore.get(rec.word)})</span>
                    {/if}
                    <span class="intro-repeat-caret">{introMenuKey === `${rec.book}:${rec.word}` ? '▴' : '▾'}</span>
                  </button>
                  {#if introMenuKey === `${rec.book}:${rec.word}`}
                    <div class="intro-repeat-menu" on:click|stopPropagation on:keydown|stopPropagation role="menu" tabindex="-1">
                      {#if introMenuView === 'main'}
                        <button class="intro-repeat-item" on:click|stopPropagation={() => (introMenuView = 'scope')}>Highlight All ▸</button>
                        <button class="intro-repeat-item" on:click|stopPropagation={() => introDeselect(rec)}>Deselect All</button>
                      {:else}
                        <button class="intro-repeat-item intro-repeat-back" on:click|stopPropagation={() => (introMenuView = 'main')}>‹ Highlight all in…</button>
                        <button class="intro-repeat-item" on:click|stopPropagation={() => introHighlightAll(rec, 'chapter')}>Current Chapter</button>
                        <button class="intro-repeat-item" on:click|stopPropagation={() => introHighlightAll(rec, 'book')}>Current Book</button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
              </div>
            {/if}
            <AudioPlayer book={chapterData.book} chapter={chapterData.chapter} on:nextchapter={handleAudioNextChapter} />
          </div>
          <div
            class="verses {translationFontClass}"
            class:paragraph-layout={verseLayout === "paragraph"}
            class:nonumber-layout={verseLayout === "paragraph-no-verse-numbers"}
          >
            {#each chapterData.verses as { verse, text, html, heading, headingLevel, paraStart }, verseIdx (`${currentTranslation}-${chapterData.book}-${chapterData.chapter}-${verse}`)}
              {@const hCtxsForVerse = chHarmCtxs.filter((c) => c.passage.endChapter === chapterData.chapter && (c.passage.endVerse !== null ? verse === c.passage.endVerse : verseIdx === chapterData.verses.length - 1))}
              {#if heading && showSectionHeadings}
                <div class="section-heading section-heading--s{headingLevel || 1}">{heading}</div>
              {/if}
              <div class="verse" class:para-start={paraStart} data-verse={verse}>
                <span class="verse-number">{verse}</span>
                {#if showCommentaries && commentaryByVerse.has(annotationKey(chapterData.book, chapterData.chapter, verse))}
                  {#each [...new Set(commentaryByVerse.get(annotationKey(chapterData.book, chapterData.chapter, verse))!.map((e) => e.author))] as author}
                    <span
                      class="anno-icon"
                      style="background:radial-gradient(circle, {getAuthorColor(author)} 0%, {getAuthorColor(author)} 20%, #431407 100%)"
                      title={author}
                      role="button"
                      tabindex="0"
                      on:click|stopPropagation={() => openAnnotationPanel(verse, 'commentary', chapterData.book, chapterData.chapter, author)}
                      on:keypress|stopPropagation={() => openAnnotationPanel(verse, 'commentary', chapterData.book, chapterData.chapter, author)}
                    >{getAuthorInitials(author)}</span>
                  {/each}
                {/if}
                {#if showReferences && tskByVerse.has(annotationKey(chapterData.book, chapterData.chapter, verse))}
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
                {#if verseNotesMap.has(annotationKey(chapterData.book, chapterData.chapter, verse)) && $userProfileStore.isSignedIn}
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

{#if !windowId && $annotationReturnStore !== null}
  {@const bookColor = getBookColor($annotationReturnStore.book)}
  <div class="annotation-return-bar" style="left: {readerLeft + readerClientWidth / 2}px;">
    <button
      class="annotation-return-fixed"
      style="border-color: {bookColor}; color: {bookColor};"
      on:click={handleAnnotationReturn}
      aria-label="Return to previous verse"
    >
      ← Back to {$annotationReturnStore.book} {$annotationReturnStore.chapter}:{$annotationReturnStore.verse}
    </button>
    {#if !paneOpened}
      <button
        class="annotation-return-fixed"
        style="border-color: {bookColor}; color: {bookColor};"
        on:click={() => {
          const edge = window.innerWidth > window.innerHeight ? 'right' : 'bottom';
          const id = windowStore.createWindow(edge, 50);
          if (id) windowStore.setWindowContent(id, 'bible', { translation: currentTranslation, book: currentBook, chapter: currentChapter, highlightedVerse: highlightVerse });
          paneOpened = true;
        }}
        aria-label="Open in split view"
      >
        Open Split View
      </button>
    {/if}
  </div>
{/if}


<style>
  /* ——— Fixed annotation back button bar ——— */
  .annotation-return-bar {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1001;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .annotation-return-fixed {
    background: #1c1c1c;
    border: 1px solid;
    border-radius: 8px;
    padding: 0 12px;
    height: 38px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
  }

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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
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

  .book-intro-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #b8c8e8;
    font-size: 0.82rem;
    padding: 5px 13px;
    border-radius: 20px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    letter-spacing: 0.02em;
  }

  .book-intro-btn:hover {
    background: rgba(100, 160, 255, 0.18);
    border-color: rgba(100, 160, 255, 0.4);
    color: #d0e4ff;
  }

  /* Relocated repeat pills, beside the Introduction button */
  .intro-row {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .intro-repeat-wrap {
    position: relative;
    display: inline-flex;
  }

  .intro-repeat-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--irp-bg);
    color: var(--irp-fg);
    border: none;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 20px;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition: filter 0.15s;
  }
  .intro-repeat-pill:hover,
  .intro-repeat-pill.open { filter: brightness(1.08); }

  .intro-repeat-caret { font-size: 0.7em; opacity: 0.85; }
  .intro-repeat-pill .repeat-pill-count { font-weight: 700; opacity: 0.85; font-variant-numeric: tabular-nums; }

  .intro-repeat-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 50;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 4px;
    min-width: 160px;
    text-align: left;
  }

  .intro-repeat-item {
    display: block;
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #e0e0e0;
    text-align: left;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .intro-repeat-item:hover { background: #3a3a3a; }
  .intro-repeat-back { color: #999; font-weight: 600; }

  .verses {
    line-height: var(--line-spacing, 1.8);
  }

  .verse {
    margin-bottom: 0;
    position: relative;
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.8);
  }

  .verse-number {
    display: inline-block;
    min-width: 0;
    font-size: calc(var(--base-font-size, 18px) * 0.5);
    color: #888;
    vertical-align: super;
    margin-right: 0.1rem;
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
    font-family: 'Cinzel Decorative', Georgia, serif;
  }

  /* Greek source texts — EB Garamond handles polytonic well */
  .verses.translation-font-greek .verse-text {
    font-family: 'EB Garamond', Georgia, serif;
    font-size: calc(var(--base-font-size, 1.125rem) + 1px);
  }
  .verses.translation-font-greek .section-heading {
    font-family: 'Cinzel Decorative', Georgia, serif;
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

  .verses.paragraph-layout .verse.para-start {
    display: block;
    margin-top: 1em;
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

  .verses.nonumber-layout .verse.para-start {
    display: block;
    margin-top: 1em;
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

  .verse.para-start {
    margin-top: 1.2em;
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

  /* Commentary-link navigation highlight — gold/yellow, same gradient style as rp-verse-highlight */
  :global(.comm-nav-verse-highlight) {
    isolation: isolate;
    background: linear-gradient(to right, rgba(255, 215, 0, 0.45), transparent);
    background-position: var(--rp-hl-left, 2em) center;
    background-size: 30ch calc(1em + 7px);
    background-repeat: no-repeat;
    border-radius: 3px;
  }

  /* Link navigation highlight (e.g. Character verse list) — color set per book category */
  :global(.link-nav-verse-highlight) {
    isolation: isolate;
    background: linear-gradient(to right, var(--link-hl-color, rgba(255, 215, 0, 0.45)), transparent);
    background-position: var(--rp-hl-left, 2em) center;
    background-size: 30ch calc(1em + 7px);
    background-repeat: no-repeat;
    border-radius: 3px;
  }

  /* End-of-reading bookmark — brown, gradient reversed (right-to-left) */
  :global(.rp-verse-end-highlight) {
    isolation: isolate;
    background: linear-gradient(to left, rgba(139, 90, 43, 0.40), transparent);
    background-position: right center;
    background-size: 30ch calc(1em + 7px);
    background-repeat: no-repeat;
    border-radius: 3px;
  }

  /* Commentary anchor checkpoint highlights — amber, half width, half opacity of .rp-verse-highlight */
  :global(.comm-anchor-highlight) {
    isolation: isolate;
    background: linear-gradient(to right, rgba(251, 146, 60, 0.20), transparent);
    background-position: var(--rp-hl-left, 2em) center;
    background-size: 15ch calc(1em + 7px);
    background-repeat: no-repeat;
    border-radius: 3px;
  }

  /* Floating drag handles for text selection */
  :global(.drag-handle-float) {
    position: absolute;
    width: 32px;
    background: transparent;
    border-radius: 0;
    cursor: ew-resize;
    z-index: 100;
    touch-action: none;
    pointer-events: auto;
    overflow: visible;
  }

  :global(.drag-handle-float)::before {
    content: none;
  }

  /* The visible blue bar lives in ::after, centered in the 32px hit zone */
  :global(.drag-handle-float)::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 3px;
    background: #667eea;
    border-radius: 2px;
    opacity: 0.8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  :global(.drag-handle-float.left) {
    margin-left: -16px;
  }

  :global(.drag-handle-float.right) {
    margin-left: -16px;
  }

  :global(.drag-handle-float:hover)::after {
    background: #5568d3;
    opacity: 1;
    width: 4px;
  }

  :global(.drag-handle-float:active)::after {
    background: #4456c0;
    width: 4px;
  }

  /* Custom selection styling */
  .text-container ::selection {
    background: rgba(102, 126, 234, 0.3);
  }

  /* Repeat highlights */
  /* Repeats overlay — soft, translucent scratch highlights. No padding/margin
     so wrapping a word never changes layout (keeps infinite-scroll height math
     stable). Colors mirror REPEAT_COLORS in lib/repeatColors.ts. */
  :global(.repeat-hl) {
    border-radius: 3px;
    font-weight: 500;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  :global(.repeat-hl-0) { background: rgba(255, 193, 7, 0.30);  box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.55); }
  :global(.repeat-hl-1) { background: rgba(56, 178, 232, 0.28); box-shadow: 0 0 0 1px rgba(56, 178, 232, 0.55); }
  :global(.repeat-hl-2) { background: rgba(52, 199, 124, 0.28); box-shadow: 0 0 0 1px rgba(52, 199, 124, 0.55); }
  :global(.repeat-hl-3) { background: rgba(244, 114, 160, 0.28); box-shadow: 0 0 0 1px rgba(244, 114, 160, 0.55); }
  :global(.repeat-hl-4) { background: rgba(167, 130, 240, 0.28); box-shadow: 0 0 0 1px rgba(167, 130, 240, 0.55); }
  :global(.repeat-hl-5) { background: rgba(255, 138, 101, 0.28); box-shadow: 0 0 0 1px rgba(255, 138, 101, 0.55); }
  :global(.repeat-hl-6) { background: rgba(45, 212, 191, 0.28);  box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.55); }
</style>
