<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import NavigationBar from "./NavigationBar.svelte";
  import SelectionToast from "./SelectionToast.svelte";
  import RadialSelectionMenu from "./RadialSelectionMenu.svelte";
  import {
    outerRadius as radialOuterRadius,
    radialItemCount,
    type RadialItemOpts,
  } from "../lib/radialMenu";
  import NotePopup from "./NotePopup.svelte";
  import { userProfileStore } from "../stores/userProfileStore";
  import { profileModalStore } from "../stores/profileModalStore";
  import AnnotationPanel from "./AnnotationPanel.svelte";
  import HighlightModal from "./HighlightModal.svelte";
  import { IndexedDBUserDataStore } from "../adapters/UserDataStore";
  import { subscribeToHighlightRemoteChanges } from "../adapters/SyncedHighlightAdapter";
  import { subscribeToUserDataRemoteChanges } from "../adapters/SyncedUserDataStore";
  import { applyChapterHighlights } from "../lib/highlightRenderer";
  import { isTextEntry } from "../lib/isTextEntry";
  import {
    resolveWordAt,
    comparePos,
    sameSection,
    selectionSegments,
    segmentsText,
    segmentsWordCount,
    paintSelection,
    clearPaintedSelection,
    segmentsToDomRange,
    charRangeToDomRange,
    posFromRange,
    getWordBounds,
    wordContextAround,
  } from "../lib/wordSelection";
  import type { WordPos, Segment } from "../lib/wordSelection";
  import { repeatsStore, normalizeRepeatWord } from "../stores/repeatsStore";
  import type { RepeatGroup } from "../stores/repeatsStore";
  import { repeatHighlightAllRequest } from "../stores/repeatBulkStore";
  import type { RepeatHighlightAllRequest } from "../stores/repeatBulkStore";
  import { applyRepeatsToSection, applyRepeatsToAllSections, clearRepeatsInSection, findRepeatOccurrences } from "../lib/repeatRenderer";
  import { applyPlaceMarkersToAllSections, loadPlacePhrases } from "../lib/placeMarkerRenderer";
  import { repeatCountsStore } from "../stores/repeatCountsStore";
  import { countWordsInBook } from "../lib/repeatCounts";
  import AudioPlayer from "./AudioPlayer.svelte";
  import TtsPlayer from "./TtsPlayer.svelte";
  import { FEATURES } from "../config";
  import {
    synthesizeWordSpeech,
    unlockTtsAudio,
    isVoiceInstalled,
    greekSpeechRoute,
  } from "../adapters/tts";
  import { speechWordText, canSpeakOriginal } from "../lib/tts/originalText";
  import BookIntroPanel from "./BookIntroPanel.svelte";
  import { syncQueue } from "../lib/sync/SyncQueueService";
  import type { UserHighlight, UserWordHighlight, HighlightStyle } from "@projectbible/core";
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { openMapWindow } from "../lib/openMapWindow";
  import { searchQuery, triggerSearch } from "../stores/searchStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { IndexedDBTextStore } from "../lib/adapters";
  import { renderVerseHtml, extractHeading, verseStructure } from "../lib/verseRendering";
  import { BIBLE_BOOKS, normalizeBookName } from "../lib/bibleData";
  import { getSettings, getInterlinearSettings, getTtsSettings } from "../adapters/settings";
  import type { InterlinearSettings } from "../adapters/settings";
  import { ttsCurrentVerse } from "../stores/audioStore";
  import { getSharedTtsAudio } from "../adapters/tts";
  import { readingPosition, isReadingActive, currentVerseWindow } from "../lib/tts/readingEngine";
  import { startGlow } from "../lib/ttsGlow";
  import {
    showVerseHighlight,
    clearVerseHighlight,
    clearVerseHighlightsFor,
    reapplyVerseHighlights,
    findVerseEl,
    slotFor,
    waitForTextToSettle,
    categoryColorFor,
    PLAN_START_COLOR,
    PLAN_END_COLOR,
  } from "../lib/verseHighlight";
  import { expandRmacCode, expandOshbCode } from "../lib/morphologyExpander";
  import { readTransaction } from "../adapters/db";
  import type { DBMorphology } from "../adapters/db";
  import { HeadingsStore } from "../adapters/HeadingsStore";
  import { IndexedDBArtStore } from "../adapters/ArtStore";
  import type { ArtScene } from "@projectbible/core";
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
          // Normalized on both sides: plan data carries plural forms ("Psalms")
          // while `book` is already canonical, so a raw compare never matched
          // and a Psalms day always showed the jump buttons.
          isSequentialNext: nextCh !== null && normalizeBookName(nextCh.book) === book && nextCh.chapter === chapter + 1,
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
  const artStore = new IndexedDBArtStore();
  let chapters: Array<{
    book: string;
    chapter: number;
    verses: Array<{
      verse: number;
      text: string;
      html?: string;
      interlinearHtml?: string;
      heading?: string | null;
      headingLevel?: number | null;
      paraStart?: boolean;
      poetryLevel?: 0 | 1 | 2;
      stanzaBreak?: boolean;
    }>;
  }> = [];
  let loading = true;
  let error = "";
  let chronologicalData: any = null;
  let isLoadingNextChapter = false;
  let isLoadingPrevChapter = false;
  let lastNavigationKey = "";
  /** Bumped by every loadChapter call so a slow one can tell it was overtaken. */
  let loadChapterTicket = 0;
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
  let showArt = true;
  let showRedLetter = true;
  /** Dotted underline under multi-word place names (opt-in, needs ISBE pack). */
  let showPlaceMarkers = false;
  /** Flips true once the place-name gazetteer has loaded, to re-trigger a repaint. */
  let placePhrasesLoaded = false;
  let themedTitles = true;
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
  /**
   * Suppression window for the scroll write-back.
   *
   * The IntersectionObserver keeps the navbar in step by writing the visible
   * chapter back into the store on a 150ms debounce. That write has no idea a
   * deliberate navigation just happened, so a timer armed a moment before you
   * tapped "continue" would fire afterwards and quietly put you back in the
   * chapter you just left. Any intentional move now cancels the pending write
   * and ignores anything the observer reports for a beat after.
   */
  let suppressScrollSyncUntil = 0;

  /** Call before any deliberate navigation, so the scroll write-back can't undo it. */
  function beginDeliberateNavigation(): void {
    if (anchorSyncDebounce) {
      clearTimeout(anchorSyncDebounce);
      anchorSyncDebounce = null;
    }
    suppressScrollSyncUntil = Date.now() + 600;
  }
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
  // Biblical-art scenes anchored in the currently rendered chapters, keyed "book:chapter:verse"
  let artByVerse = new Map<string, ArtScene[]>();

  function annotationKey(book: string, chapter: number, verse: number): string {
    return `${book}:${chapter}:${verse}`;
  }

  // Rebuild the art-icon map for the chapters currently on screen.
  async function rebuildArtByVerse(chs: typeof chapters, enabled: boolean) {
    if (!enabled || !chs || chs.length === 0) {
      if (artByVerse.size > 0) artByVerse = new Map();
      return;
    }
    const map = new Map<string, ArtScene[]>();
    for (const ch of chs) {
      const scenes = await artStore.getScenesForChapter(ch.book, ch.chapter);
      for (const s of scenes) {
        const key = annotationKey(s.book, s.chapter, s.verse);
        const arr = map.get(key) ?? [];
        arr.push(s);
        map.set(key, arr);
      }
    }
    artByVerse = map;
  }
  $: rebuildArtByVerse(chapters, showArt);

  // Open the Art window docked to the edge that fits the current orientation
  // (landscape / desktop → right, portrait → bottom). The reader text reflows
  // into the remaining space — same docking used for split view.
  function openArtWindow(scene: ArtScene) {
    const edge = window.innerWidth > window.innerHeight ? 'right' : 'bottom';
    const id = windowStore.createWindow(edge, 50);
    if (id) {
      windowStore.setWindowContent(id, 'art', {
        sceneId: scene.id,
        book: scene.book,
        chapter: scene.chapter,
        verse: scene.verse,
      });
    }
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
  // Where the "start here" mark belongs now lives in the navigation store as
  // linkHighlight (book + chapter + verse), not in component-local numbers.
  // A bare verse number could not say which chapter it meant, and the reader
  // holds several at once.

  function handleAnnotationNavigateTo(e: CustomEvent<{ book: string; chapter: number; verse: number }>) {
    const { book, chapter, verse } = e.detail;
    annotationReturnStore.set({
      book: annotationPanelBook,
      chapter: annotationPanelChapter,
      verse: annotationPanelVerse,
      tab: annotationPanelTab,
    });
    annotationPanelOpen = false;
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
  /** The toast component, for measuring it before deciding where it goes. */
  let toastComp: SelectionToast | null = null;
  /** False until placeToast has measured and positioned it — see SelectionToast. */
  let toastPlaced = false;
  /** The lines the toast must keep clear of. Kept so a scroll can re-place it. */
  let toastAnchor: ToastAnchor | null = null;
  /** Which selection menu the user picked. See settings.selectionMenu. */
  let selectionMenu: "classic" | "radial" = "radial";
  /** Is *this* opening a ring? Fixed at open time so it can't change mid-use. */
  let radialActive = false;
  let radialCX = 0;
  let radialCY = 0;
  let radialLine = 32;
  let selectedText = "";
  /** Clicked word resolved to a biblical character — relabels Define → Bio. */
  let selectedIsPerson = false;
  /** Guards against a slow person lookup landing after the next word click. */
  let personLabelToken = 0;
  /** Located places tied to the clicked character. Empty means no Map seat. */
  let selectedPersonPlaces: { name: string; latitude: number; longitude: number; modernName?: string | null; placeType?: string | null }[] = [];
  /** Clicked word resolved to an ISBE place/entry — relabels Define → More Info. */
  let selectedIsbeKind: "place" | "entry" | null = null;
  /**
   * Is there somewhere to put on a map? A place is its own location; a character
   * is the places their story touches, and gets no seat when there are none.
   */
  $: selectionHasMap = selectedIsPerson
    ? selectedPersonPlaces.length > 0
    : selectedIsbeKind === "place";
  /** Neighbouring words captured at click time, for multi-word phrase expansion. */
  let selectedContext: { before: string[]; after: string[] } | null = null;
  let selectionMode: "word" | "verse" = "word";
  let selectionRange: Range | null = null;

  // --- Whole-word drag selection ---------------------------------------
  // The selection's source of truth is a pair of words: the one the gesture
  // started on and the one it currently reaches. Everything else (the painted
  // spans, the toast text, the saved highlights) is derived from these two.
  // Character offsets are used rather than live Ranges because painting the
  // selection splits text nodes, which would invalidate a Range.
  let selAnchor: WordPos | null = null;
  let selFocus: WordPos | null = null;
  let selectedSegments: Segment[] = [];
  let selectedWordCount = 0;
  /** True from pointer-down on a word until release — suppresses native selection. */
  let dragSelecting = false;
  /** Set once a gesture has committed to selecting rather than scrolling. */
  let dragArmed = false;
  /** Next tap extends the selection instead of replacing it (the Extend chip). */
  let extendArmed = false;

  const ARM_PX = 8;          // finger travel before a touch gesture picks a lane
  const MOUSE_ARM_PX = 3;    // mouse has no scroll to protect, so it commits sooner
  const HOLD_MS = 300;       // holding still also starts a selection
  const AUTOSCROLL_EDGE = 60;
  const AUTOSCROLL_PX = 8;

  interface WordDrag {
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    holdTimer: number | null;
  }
  let wordDrag: WordDrag | null = null;
  let dragFrame: number | null = null;
  let autoScrollFrame: number | null = null;

  /**
   * Counts pointer gestures so handleClickOutside can tell "the click that
   * belongs to the tap which just opened this toast" from a genuine click
   * elsewhere. The old 100ms timer was enough only because the native text
   * selection suppressed the click; now that we paint our own selection, the
   * click always fires and the timer would be a race.
   */
  let pointerSeq = 0;
  let toastPointerSeq = -1;

  /** Bumper press tracking, so a tap on one dismisses but a drag still adjusts. */
  let edgeDragOrigin: { x: number; y: number } | null = null;
  let edgeDragMoved = false;
  const EDGE_TAP_SLOP = 6;
  let searchHighlightedElement: HTMLElement | null = null;
  let dayCompleteMessage: string | null = null;
  let highlightedElements: HTMLElement[] = [];
  let isDragging = false;
  let dragEdge: "left" | "right" | null = null;
  let hoveredWordElement: HTMLElement | null = null;
  let justOpenedToast = false;

  // Track selected verse number for commentary
  let selectedVerseNumber: number | null = null;

  // Highlight state
  const userDataStore = new IndexedDBUserDataStore();
  let highlightModalOpen = false;
  let highlightModalRef: { book: string; chapter: number; verse: number } | null = null;
  let highlightModalExisting: UserHighlight | UserWordHighlight | null = null;
  let highlightSelectionType: 'verse' | 'word' = 'verse';
  /**
   * Character runs captured when Highlight is tapped, one per verse the
   * selection touches. Captured synchronously before the modal opens, because
   * opening it tears down the painted spans the offsets were measured against.
   */
  let pendingWordSpans: { verse: number; wordStart: number; wordLength: number }[] = [];
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

  // Read Aloud can pronounce the selected word only when it is an actual
  // Greek word from the interlinear — English selections have nothing to say
  // in the original, and Hebrew has no shippable voice yet.
  $: selectionCanSpeak =
    FEATURES.ttsReadAloud &&
    selectedMorphology?.language === "greek" &&
    canSpeakOriginal(currentTranslation);

  /** Speak one original-language word, from a tap. */
  async function speakOriginalWord(word: string, language?: string) {
    const text = speechWordText(word ?? "", language ?? "greek");
    if (!text) return;
    // Must happen inside the tap, before any await, or iOS refuses to play.
    unlockTtsAudio();
    try {
      const route = greekSpeechRoute();
      if (!(await isVoiceInstalled(route.voiceId))) {
        showTtsVoiceNeeded = route.voiceId;
        return;
      }
      // The voice cannot say a short word on its own; the worker speaks it
      // inside a carrier and cuts it back out, rejecting anything it cannot
      // verify. Logged here, on the main thread, because eruda cannot see
      // console output from inside a Web Worker.
      console.log(
        `🔊 word "${text}" voice=${route.voiceId} espeak=${route.espeakVoice}`
      );
      const blob = await synthesizeWordSpeech(text, route.voiceId, {
        espeakVoice: route.espeakVoice,
        substitutions: route.substitutions,
      });
      const audio = getSharedTtsAudio();
      audio.src = URL.createObjectURL(blob);
      audio.playbackRate = 1;
      await audio.play();
    } catch (err) {
      console.warn(`🔊 could not speak "${text}":`, err);
      speakFailedWord = text;
      setTimeout(() => { if (speakFailedWord === text) speakFailedWord = null; }, 2500);
    }
  }

  /** Word we could not pronounce cleanly, shown briefly instead of bad audio. */
  let speakFailedWord: string | null = null;

  /** Voice id the user needs to download before a tap-to-speak will work. */
  let showTtsVoiceNeeded: string | null = null;

  // Morphology cache state
  let morphologyCache = new Map<number, DBMorphology[]>();
  let isIndexedPack = false;

  // Interlinear (Greek/Hebrew) display state — toggled from the NavigationBar;
  // this component just reads the prefs to drive rendering.
  let interlinearSettings: InterlinearSettings = getInterlinearSettings();
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
    showArt = settings.showArt !== false; // default true
    showRedLetter = settings.showRedLetter !== false; // default true
    showPlaceMarkers = settings.showPlaceMarkers === true; // default false
    selectionMenu = settings.selectionMenu === "classic" ? "classic" : "radial";
    if (showPlaceMarkers && !placePhrasesLoaded) {
      void loadPlacePhrases().then(() => { placePhrasesLoaded = true; });
    }
    themedTitles = settings.themedTitles !== false; // default true
    interlinearSettings = getInterlinearSettings();
    const tts = getTtsSettings();
    ttsHighlightVerse = tts.highlightVerse;
    ttsGlowFollow = tts.glowFollow;
  }

  // ── Read Aloud follow-along ────────────────────────────────────────────────
  // Two independent effects: tinting the spoken verse, and a soft glow drifting
  // along its words. Either, both, or neither.
  let ttsHighlightVerse = true;
  let ttsGlowFollow = false;
  let glowCleanup: (() => void) | null = null;
  let glowTicket = 0;

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /** Nudge the spoken verse back into view, but only once it drifts out of a
   *  comfortable band — so it never fights manual scrolling. */
  function followVerseIntoView(verseEl: HTMLElement): void {
    if (!readerElement) return;
    const containerRect = readerElement.getBoundingClientRect();
    const rect = verseEl.getBoundingClientRect();
    const topBand = containerRect.top + containerRect.height * 0.15;
    const bottomBand = containerRect.top + containerRect.height * 0.8;
    if (rect.top >= topBand && rect.bottom <= bottomBand) return;
    const target =
      readerElement.scrollTop + (rect.top - containerRect.top) - containerRect.height * 0.35;
    readerElement.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  async function onSpokenVerseChanged(
    current: { book: string; chapter: number; verse: number } | null,
    glowOn: boolean,
    highlightOn: boolean,
  ): Promise<void> {
    // Ticket guard: there's an await below, so a newer call can overtake this
    // one. Without this, the newer call would find glowCleanup still null,
    // clean up nothing, then overwrite the handle — abandoning a running glow
    // with no way to stop it.
    const ticket = ++glowTicket;
    glowCleanup?.();
    glowCleanup = null;
    if (!current || (!glowOn && !highlightOn)) return;

    await tick();
    if (ticket !== glowTicket) return; // overtaken while waiting

    const verseEl = readerElement?.querySelector<HTMLElement>(
      `[data-chapter-section][data-book="${current.book}"][data-chapter="${current.chapter}"] .verse[data-verse="${current.verse}"]`,
    );
    if (!verseEl) return;

    followVerseIntoView(verseEl);
    if (glowOn && !prefersReducedMotion()) {
      // Playback is stitched into long segments, so the glow has to be told
      // where this verse sits inside the one being played — it can no longer
      // assume the audio element is the verse.
      const verseWindow = get(currentVerseWindow);
      if (!verseWindow || verseWindow.durationSeconds <= 0) return;
      const cleanup = startGlow(verseEl, getSharedTtsAudio(), verseWindow);
      if (ticket !== glowTicket) cleanup(); // overtaken during setup
      else glowCleanup = cleanup;
    }
  }

  $: onSpokenVerseChanged($ttsCurrentVerse, ttsGlowFollow, ttsHighlightVerse);

  // ── Follow Read Aloud ──────────────────────────────────────────────────────
  // The engine leads; the page follows. When reading moves into a chapter that
  // is not on screen, bring the page to it — but only in the main reader and
  // only while the app is visible. Reading itself never depends on this; if the
  // phone is pocketed there is nothing to look at and nothing to do.
  let lastFollowedChapter = "";
  $: if (!windowId && $readingPosition) {
    const key = `${$readingPosition.book}-${$readingPosition.chapter}`;
    if (key !== lastFollowedChapter) {
      lastFollowedChapter = key;
      followReadingPosition($readingPosition.book, $readingPosition.chapter);
    }
  }

  function followReadingPosition(book: string, chapter: number): void {
    if (typeof document !== "undefined" && document.hidden) return;
    if (currentBook === book && currentChapter === chapter) return;
    if (normalizeBookName(book) !== normalizeBookName(currentBook)) {
      navigationStore.setBook(book);
    }
    navigationStore.setChapter(chapter);
  }

  // Starting to read reveals the navbar, because that is where the controls now
  // live — otherwise they would appear somewhere the user cannot see.
  let wasReadingActive = false;
  $: if ($isReadingActive !== wasReadingActive) {
    wasReadingActive = $isReadingActive;
    if ($isReadingActive) navBarOffset = 0;
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
  $: isInterlinearActive =
    interlinearSettings.enabled && isOriginalLanguage(currentTranslation);
  $: isInterlinearRtl = isHebrewTranslation(currentTranslation);
  $: isChronologicalMode = windowId ? false : ($navigationStore.isChronologicalMode ?? false);
  $: highlightVerse = windowId
    ? (windowState?.contentState?.highlightedVerse ?? null)
    : ($navigationStore.highlightedVerse ?? null);

  // ---------------------------------------------------------------------------
  // Harmony reading session
  // ---------------------------------------------------------------------------
  // Apply highlight immediately when readingPlanActiveTarget changes but we're already
  // on the target chapter (navKey doesn't change so loadChapter won't fire).
  // The key carries the target's `at` stamp, so tapping the same passage again
  // is a fresh event and scrolls again. Without it a repeat tap was swallowed —
  // and it took the pending scroll target with it, leaving a stale verse in the
  // store for the next unrelated navigation to jump to.
  let _lastRpTargetKey: string | null = null;
  $: {
    // Window panes are isolated — reading plan state is main-reader-only
    if (windowId) { _lastRpTargetKey = null; }
    const rpTarget = windowId ? null : $navigationStore.readingPlanActiveTarget;
    const newKey = rpTarget
      ? `${rpTarget.book}-${rpTarget.chapter}-${rpTarget.verse ?? 'null'}-${rpTarget.at}`
      : null;
    const loaded =
      !!rpTarget &&
      chapters.length > 0 &&
      chapters.some(c => c.book === rpTarget.book && c.chapter === rpTarget.chapter);
    if (newKey !== null && newKey !== _lastRpTargetKey && loaded) {
      _lastRpTargetKey = newKey;
      const scrollVerse = $navigationStore.scrollTargetVerse;
      // Consumed here rather than inside the branch below: a target that turned
      // out to have nothing to scroll to still has to be cleared, or it waits
      // in the store and hijacks a later navigation.
      if (scrollVerse != null) navigationStore.clearScrollTarget();
      const target = rpTarget!;
      const goTo = scrollVerse ?? target.verse;
      tick().then(async () => {
        // Only scroll when a verse was actually named. A chapter-level plan
        // target lands you at the top of the chapter, where verse 1 is already
        // in view — scrolling to it would push the chapter title off screen.
        if (goTo != null) {
          await scrollToTarget(target.book, target.chapter, goTo);
          // The scroll waits on webfonts, which on a cold cache is long enough
          // for another navigation to land. If one did, that one owns the page.
          if (get(navigationStore).readingPlanActiveTarget?.at !== target.at) return;
        }
        await applyReadingPlanHighlight();
        await applyReadingPlanEndHighlight();
      });
    }
    if (newKey === null && _lastRpTargetKey !== null) {
      // Plan finished or cleared — take its marks with it.
      _lastRpTargetKey = null;
      clearReadingPlanHighlight();
      clearReadingPlanEndHighlight();
    }
  }

  // The "start here" mark for link navigation. It fires only once the target's
  // own chapter is actually loaded, so a cross-book jump paints the new chapter
  // rather than the old one still on screen. It does not consume the target:
  // leaving the chapter and coming back shows the mark again, the same way the
  // reading plan one does. The two used to follow opposite rules.
  let _lastLinkHlKey: string | null = null;
  $: {
    const lh = windowId ? null : $navigationStore.linkHighlight;
    const loaded =
      !!lh &&
      chapters.length > 0 &&
      chapters.some((c) => c.book === lh.book && c.chapter === lh.chapter);
    const key = lh ? `${lh.book}-${lh.chapter}-${lh.verse}-${lh.at}` : null;
    if (key !== null && key !== _lastLinkHlKey && loaded) {
      _lastLinkHlKey = key;
      const target = lh!;
      tick().then(async () => {
        await scrollToTarget(target.book, target.chapter, target.verse);
        // Overtaken while waiting on webfonts — the newer navigation wins.
        if (get(navigationStore).linkHighlight?.at !== target.at) return;
        await applyLinkNavHighlight();
      });
    }
    if (key === null && _lastLinkHlKey !== null) {
      // Stepped away by hand, or went back to a spot that carried no mark.
      _lastLinkHlKey = null;
      clearLinkNavHighlight();
    }
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

  /**
   * Continue to the next chapter of a plan.
   *
   * `clearReadingPlanHighlight()` first, which the harmony handlers always did
   * and these two never did: they assumed the chapter reload would wipe the old
   * mark off the DOM, and when the next chapter was already on screen from
   * scrolling there was no reload, so the old mark stayed and a second one was
   * added beside it.
   *
   * `false` for the highlight argument because the plan paints its own green.
   */
  function continueToChapter(next: { book: string; chapter: number }) {
    beginDeliberateNavigation();
    clearReadingPlanHighlight();
    navigationStore.setReadingPlanActiveTarget(next.book, next.chapter, null, false);
    navigationStore.navigateTo(currentTranslation, next.book, next.chapter, null, false);
    navBarOffset = -68;
  }

  async function handleMarkAndContinue(ctx: any, book: string, chapter: number) {
    await readingProgressStore.setChapterAction(
      ctx.planId, ctx.dayNumber, ctx.todayChapters, { book, chapter }, 'checked'
    );
    if (ctx.nextChapter) continueToChapter(ctx.nextChapter);
  }

  function handleContinueOnly(ctx: any) {
    if (ctx.nextChapter) continueToChapter(ctx.nextChapter);
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
      // Claimed up front so this block can't re-enter and start the same load
      // on every reactive tick. loadChapter then re-commits it to describe the
      // chapter that actually landed, which is the part that was missing: if
      // something moved the store while a load was in flight, the key used to
      // keep describing where we were headed rather than where we ended up, so
      // the mismatch was never noticed and never corrected.
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
    // "Already loaded" means the chapter is in the DOM, not that it matches the
    // navigation store — the scroll handler rewrites the store's book and
    // chapter as the user moves, so those can name a neighbour while the
    // chapter we want is still mounted and perfectly scrollable.
    beginDeliberateNavigation();
    if (findVerseEl(readerElement, book, chapter, verse)) {
      void scrollToTarget(book, chapter, verse);
    } else {
      // Different chapter — update window or global nav; loadChapter will pick up scroll target.
      if (windowId) {
        _windowScrollTarget = verse;
        windowStore.updateContentState(windowId, { book, chapter, highlightedVerse: null });
      } else {
        // The reading plan paints its own green mark, so no category one here.
        navigationStore.navigateTo(currentTranslation, book, chapter, verse, false);
      }
    }
  }

  /**
   * Scroll to a verse, named by its own chapter, once the page has stopped
   * moving.
   *
   * Landing accurately needs two things the old code did not do. First, wait:
   * the reader's typefaces all load with `font-display: swap`, so measuring
   * before they arrive measures the fallback metrics and the text reflows out
   * from under the scroll. Second, look again: `.main-content` animates its
   * width for 300ms whenever a side pane opens or closes as part of the same
   * navigation, and repeat markers, place markers and note icons are injected
   * later still. So we re-check once the transition is over and correct the
   * landing — unless the user has taken the scroll themselves, in which case
   * we leave it alone rather than fight them.
   */
  async function scrollToTarget(
    book: string,
    chapter: number,
    verse: number | null,
  ): Promise<void> {
    if (!readerElement) return;
    beginDeliberateNavigation();
    await waitForTextToSettle();
    if (!readerElement) return;
    const el = findVerseEl(readerElement, book, chapter, verse);
    if (!el) return;
    scrollToVerseEl(el);
    const settledAt = readerElement.scrollTop;
    window.setTimeout(() => {
      if (!readerElement || !el.isConnected) return;
      // Anything more than a pixel or two means the user is scrolling; theirs wins.
      if (Math.abs(readerElement.scrollTop - settledAt) > 2) return;
      const containerTop = readerElement.getBoundingClientRect().top;
      const drift = el.getBoundingClientRect().top - containerTop;
      if (Math.abs(drift - 8) > 4) scrollToVerseEl(el);
    }, 360);
  }

  // Scroll to a verse element, pulling in any immediately-preceding section heading
  // that falls within 55% of the screen height above the verse.
  function scrollToVerseEl(verseEl: HTMLElement): void {
    const budget = window.innerHeight * 0.55;
    let scrollTarget: HTMLElement = verseEl;
    // Compare positions rather than adding up sibling heights. In paragraph
    // layout a verse is an inline box whose height is the union of every line
    // it touches, so the running total overshot the budget almost immediately
    // and the heading above was never picked up.
    const verseTop = verseEl.getBoundingClientRect().top;
    let prev = verseEl.previousElementSibling as HTMLElement | null;
    while (prev) {
      if (verseTop - prev.getBoundingClientRect().top > budget) break;
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

  // ── Interlinear (Greek/Hebrew) ──────────────────────────────────────
  function escapeInterlinearText(value: string): string {
    return (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isHebrewTranslation(translationId: string): boolean {
    const id = (translationId || "").toLowerCase();
    return id === "wlc" || id === "hebrew-oshb" || id.includes("hebrew");
  }

  // Build the stacked per-word interlinear HTML for one verse from its
  // morphology entries. Every layer span is always emitted; which layers are
  // visible is decided by CSS classes on the .verses container, so toggling a
  // layer never requires a rebuild.
  function buildInterlinearHtml(entries: DBMorphology[] | undefined): string {
    if (!entries || entries.length === 0) return "";
    const sorted = [...entries].sort(
      (a, b) =>
        (a.word_index ?? a.wordPosition ?? 0) -
        (b.word_index ?? b.wordPosition ?? 0),
    );
    let html = "";
    sorted.forEach((m, i) => {
      const idx = m.word_index ?? m.wordPosition ?? i;
      const orig = m.text || m.word || "";
      const gloss = m.gloss_en || m.gloss || "";
      const translit = m.transliteration || "";
      const lemma = m.lemma || "";
      const strongs = m.strongsId || "";
      const rawParse = m.morph_code || m.parsing || "";
      const lang = m.language || "greek";
      const parseText =
        lang === "hebrew" || lang === "aramaic"
          ? expandOshbCode(rawParse)
          : expandRmacCode(rawParse);
      html +=
        `<span class="il-word" data-word-index="${idx}"` +
        ` data-word="${escapeAttribute(orig)}"` +
        ` data-lemma="${escapeAttribute(lemma)}"` +
        ` data-strongs="${escapeAttribute(strongs)}"` +
        ` data-gloss="${escapeAttribute(gloss)}"` +
        ` data-transliteration="${escapeAttribute(translit)}"` +
        ` data-parsing="${escapeAttribute(rawParse)}"` +
        ` data-language="${escapeAttribute(lang)}">` +
        `<span class="il-orig">${escapeInterlinearText(orig)}</span>` +
        `<span class="il-gloss">${escapeInterlinearText(gloss)}</span>` +
        `<span class="il-translit">${escapeInterlinearText(translit)}</span>` +
        `<span class="il-lemma">${escapeInterlinearText(lemma)}</span>` +
        `<span class="il-parse" title="${escapeAttribute(rawParse)}">${escapeInterlinearText(parseText)}</span>` +
        `<span class="il-strongs">${escapeInterlinearText(strongs)}</span>` +
        `</span>`;
    });
    return html;
  }

  // Morphology packs don't carry a per-word transliteration for every word
  // (Hebrew has none at all), so fall back to the Strong's lexicon's
  // dictionary-form transliteration for any word that has a Strong's id.
  // Mutates the entries in place before interlinear HTML is baked; a missing
  // Lexical pack just leaves the fields empty.
  async function fillMissingTransliterations(entries: DBMorphology[]) {
    try {
      const missing = entries.filter((m) => !m.transliteration && m.strongsId);
      if (missing.length === 0) return;
      const { getStrongsTransliterations } = await import(
        "../adapters/lexicon-lookup.js"
      );
      const translits = await getStrongsTransliterations(
        missing.map((m) => m.strongsId!),
      );
      for (const m of missing) {
        const translit = translits.get(m.strongsId!);
        if (translit) m.transliteration = translit;
      }
    } catch (error) {
      console.warn("Transliteration fallback unavailable:", error);
    }
  }

  // Query the morphology store for one chapter without disturbing the global
  // morphologyCache. Used to bake interlinear HTML for appended chapters.
  async function fetchChapterMorphology(
    translation: string,
    book: string,
    chapter: number,
  ): Promise<Map<number, DBMorphology[]>> {
    const map = new Map<number, DBMorphology[]>();
    try {
      const { openDB } = await import("../adapters/db");
      const db = await openDB();
      const tx = db.transaction("morphology", "readonly");
      const store = tx.objectStore("morphology");
      const index = store.index("verse_ref");
      const MORPH_ID_ALIAS: Record<string, string> = { SBLGNT: "sblgnt" };
      const morphTranslation =
        MORPH_ID_ALIAS[translation] ?? translation.toLowerCase();
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
          } else resolve(entries);
        };
        request.onerror = () => reject(request.error);
      });
      await fillMissingTransliterations(results);
      results.forEach((m) => {
        if (!map.has(m.verse)) map.set(m.verse, []);
        map.get(m.verse)!.push(m);
      });
    } catch (err) {
      console.warn("fetchChapterMorphology failed:", err);
    }
    return map;
  }

  // Interlinear word tap: resolve morphology straight from the cache/dataset,
  // bypassing the Intl.Segmenter reconstruction used for plain verse text.
  function handleInterlinearWordClick(
    ilWord: HTMLElement,
    verseNumInt: number,
    x: number,
    y: number,
  ) {
    const idxAttr = ilWord.getAttribute("data-word-index");
    const idx = idxAttr !== null ? parseInt(idxAttr, 10) : NaN;
    const ds = ilWord.dataset;

    let morph: DBMorphology | null =
      morphologyCache
        .get(verseNumInt)
        ?.find((m) => (m.word_index ?? m.wordPosition) === idx) ?? null;

    if (!morph) {
      // Appended chapters aren't in the global cache — reconstruct from dataset.
      morph = {
        word_index: isNaN(idx) ? 0 : idx,
        book: "",
        chapter: 0,
        verse: verseNumInt,
        text: ds.word || "",
        lemma: ds.lemma || "",
        transliteration: ds.transliteration || "",
        strongsId: ds.strongs || undefined,
        morph_code: ds.parsing || "",
        language: (ds.language as DBMorphology["language"]) || "greek",
        translationId: currentTranslation,
        gloss_en: ds.gloss || "",
      };
    }

    selectedText = ds.word || morph.text || "";
    selectedContext = null; // interlinear original-language word: no English phrase context
    selectedMorphology = morph;
    selectedVerseNumber = verseNumInt;

    // Select the original-word span for visual feedback + word-level actions.
    selectionRange = null;
    const origEl = ilWord.querySelector(".il-orig");
    if (origEl) {
      try {
        const r = document.createRange();
        r.selectNodeContents(origEl);
        selectionRange = r;
        highlightSelection(r, selectionMode);
      } catch (err) {
        console.error("Interlinear range creation failed:", err);
      }
    }
    if (!selectionRange) {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
    showToastAt(x, y);
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

    // Ticket guard: this function awaits several times, so a newer call can
    // overtake it. Without one, a slow load that started first could finish
    // last and put its chapter on screen after the user had already moved on —
    // which is how tapping a reading plan's "continue" could bounce you back to
    // the chapter you just left. Same pattern as onSpokenVerseChanged.
    const ticket = ++loadChapterTicket;

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
      if (ticket !== loadChapterTicket) return; // overtaken while fetching

      console.log(`   Fetched ${chapterVerses?.length || 0} verses from DB`);

      if (!chapterVerses || chapterVerses.length === 0) {
        console.warn(`No verses found for ${translation} ${book} ${chapter}`);
        loading = false;
        // The key stays committed on purpose. A pack with no verses for this
        // chapter will fail identically every time, and clearing it here would
        // have the reactive block retry the same load on every tick.
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
          ...verseStructure(cleanText),
        };
      });

      console.log(`   Processed ${processedVerses.length} verses`);
      console.log(
        `   First verse text: "${processedVerses[0]?.text.substring(0, 50)}..."`,
      );

      // Reset chapters array and scroll to top
      chapters = [{ book, chapter, verses: processedVerses }];
      // Committed only now that a chapter has actually landed. Setting it
      // before the load meant a load that bailed or lost a race left the key
      // claiming this destination was handled, and nothing would retry it
      // until you navigated somewhere else and back — the "works on the
      // second tap" behaviour.
      lastNavigationKey = `${translation}-${book}-${chapter}-${isChronologicalMode}`;

      console.log(
        "   Chapters array AFTER assignment:",
        chapters.map(
          (c) => `${c.book} ${c.chapter} (${c.verses.length} verses)`,
        ),
      );

      // Load morphology cache if original language translation
      if (isOriginalLanguage(translation)) {
        await loadMorphologyCache(translation, book, chapter);
        if (ticket !== loadChapterTicket) return; // overtaken while loading morphology
        // Pre-build interlinear HTML so toggling the view is instant (no reload).
        // Layer visibility is handled in CSS, so this is built once per load.
        chapters = chapters.map((c) => ({
          ...c,
          verses: c.verses.map((v) => ({
            ...v,
            interlinearHtml: buildInterlinearHtml(morphologyCache.get(v.verse)),
          })),
        }));
      } else {
        // Clear morphology cache for non-original-language translations
        morphologyCache.clear();
        isIndexedPack = false;
      }

      // Load annotation data (commentary + TSK references)
      await loadAnnotations(book, chapter);
      if (ticket !== loadChapterTicket) return; // overtaken while loading annotations

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
      if (ticket !== loadChapterTicket) return; // overtaken while loading highlights

      if (resetScroll && readerElement) {
        // Set flag BEFORE tick so any clamp-induced scroll event is consumed
        scrollResetPending = true;
        await tick(); // flush DOM so scrollHeight reflects the new single-chapter content
        lastScrollTop = 0;
        readerElement.scrollTop = 0; // direct assignment — always instant, ignores scroll-behavior CSS
        if (scrollToVerse != null) {
          // Cleared before the await, not after: the scroll waits on fonts, and
          // leaving the target set across that gap let another navigation pick
          // it up and jump somewhere the user never asked for. Window panes read
          // their own target and must not clear the main reader's.
          if (!windowId) navigationStore.clearScrollTarget();
          await scrollToTarget(book, chapter, scrollToVerse);
        }
        const rpTarget = $navigationStore.readingPlanActiveTarget;
        if (rpTarget && rpTarget.book === book && rpTarget.chapter === chapter) {
          _lastRpTargetKey = `${rpTarget.book}-${rpTarget.chapter}-${rpTarget.verse ?? 'null'}-${rpTarget.at}`;
          await applyReadingPlanHighlight();
        }
        // Always attempt end highlight — end chapter may differ from start chapter
        await applyReadingPlanEndHighlight();
        // Svelte rebuilt the verse elements, so any mark painted on the old ones
        // is gone. Put back whatever is still aimed at a chapter now on screen —
        // this is what makes a link mark survive leaving and coming back, which
        // it never used to.
        reapplyVerseHighlights(readerElement, windowId);
      }
    } catch (err: unknown) {
      if (ticket !== loadChapterTicket) return; // a newer load owns the screen
      console.error("Error loading chapter:", err);
      error = `Failed to load ${book} ${chapter}. Make sure you have packs installed.`;
      chapters = [];
    } finally {
      // Only the newest load may clear the loading flag or top up the viewport.
      // An overtaken one doing so would let the scroll handlers fire against a
      // chapter that is on its way out.
      if (ticket === loadChapterTicket) {
        loading = false;
        if (chapters.length > 0) checkViewportFill();
      }
    }
  }

  function clearReadingPlanEndHighlight(): void {
    clearVerseHighlight(slotFor('plan-end', windowId));
  }

  async function applyReadingPlanEndHighlight(): Promise<void> {
    await tick();
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
    showVerseHighlight(
      readerElement,
      slotFor('plan-end', windowId),
      { book: lastBook, chapter: lastChapter, verse: null, last: true },
      { color: PLAN_END_COLOR, side: 'end' },
    );
  }

  function clearReadingPlanHighlight(): void {
    clearVerseHighlight(slotFor('plan-start', windowId));
  }

  async function applyReadingPlanHighlight(): Promise<void> {
    await tick();
    const target = $navigationStore.readingPlanActiveTarget;
    if (!readerElement || !target) {
      clearReadingPlanHighlight();
      return;
    }
    // Scoped to the target's own chapter. The old version asked the whole
    // reader for a verse number, and with several chapters mounted at once
    // that answered with whichever chapter sat highest in the DOM — which is
    // why continuing a plan so often marked a chapter you had already read.
    showVerseHighlight(
      readerElement,
      slotFor('plan-start', windowId),
      { book: target.book, chapter: target.chapter, verse: target.verse },
      { color: PLAN_START_COLOR },
    );
  }

  // The "start here" mark for any link navigation, in the target book's
  // category color. Reading plan is the only thing that carries its own color.
  function clearLinkNavHighlight(): void {
    clearVerseHighlight(slotFor('nav', windowId));
  }

  async function applyLinkNavHighlight(): Promise<void> {
    await tick();
    const target = $navigationStore.linkHighlight;
    if (!readerElement || !target) return;
    showVerseHighlight(
      readerElement,
      slotFor('nav', windowId),
      { book: target.book, chapter: target.chapter, verse: target.verse },
      {
        color: categoryColorFor(target.book),
        rtl: isHebrewTranslation(currentTranslation),
      },
    );
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
      const notes = await userDataStore.getChapterNotes(book, chapter);
      // Rebuild this chapter's keys rather than only adding: a note deleted on
      // another device would otherwise leave its ✎ on the verse until reload.
      const keep = new Set(
        notes
          .filter((n) => n.text?.trim())
          .map((n) => annotationKey(n.reference.book, n.reference.chapter, n.reference.verse)),
      );
      const prefix = `${book}:${chapter}:`; // annotationKey without the verse
      for (const key of [...verseNotesMap.keys()]) {
        if (key.startsWith(prefix) && !keep.has(key)) verseNotesMap.delete(key);
      }
      for (const note of notes) {
        if (note.text?.trim()) {
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
    // Hebrew source texts. This class carries no styling — it exists so the
    // Custom theme's latin-only typeface never lands on Hebrew script.
    if (!looksEnglish && (t === 'wlc' || t === 'bhs' || t.includes('hebrew') || t.includes('masoretic'))) {
      return 'translation-font-hebrew';
    }
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

      await fillMissingTransliterations(results);

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

      // Never grow the document mid-drag. Prepending a chapter corrects
      // scrollTop by the height added, which would yank the text out from
      // under the finger and leave the selection tracking the wrong words.
      if (!dragArmed) {
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
      }

      // The toast is position:fixed, so a scroll would leave it pointing at
      // nothing. Keep it over its selection, or drop it once that scrolls away.
      if (showToast) repositionToastToSelection();

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
      // Which array this append belongs to. loadChapter replaces `chapters`
      // wholesale, so an append that started before a navigation would
      // otherwise land on the new chapter and stitch the old book onto it.
      const appendTicket = loadChapterTicket;
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
        const nextMorph = isOriginalLanguage(currentTranslation)
          ? await fetchChapterMorphology(currentTranslation, nextBook, nextChapter)
          : null;
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
            interlinearHtml: nextMorph ? buildInterlinearHtml(nextMorph.get(v.verse)) : undefined,
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
            paraStart,
            ...verseStructure(cleanText),
          };
        });

        // Append without triggering navigation update
        if (appendTicket !== loadChapterTicket) return; // a navigation replaced the list
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
      const appendTicket = loadChapterTicket;
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
        const prevMorph = isOriginalLanguage(currentTranslation)
          ? await fetchChapterMorphology(currentTranslation, prevBook, prevChapter)
          : null;
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
            interlinearHtml: prevMorph ? buildInterlinearHtml(prevMorph.get(v.verse)) : undefined,
            heading: finalHeading,
            headingLevel: finalHeading ? (hlEntry?.level ?? 1) : null,
            paraStart,
            ...verseStructure(cleanText),
          };
        });

        if (appendTicket !== loadChapterTicket) return; // a navigation replaced the list

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

  // ---------------------------------------------------------------------
  // Whole-word drag selection
  // ---------------------------------------------------------------------

  /** A short tick so whole-word snapping is felt, not just seen. Android only. */
  function haptic(ms: number) {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* iOS Safari has no vibrate — silently skip */
    }
  }

  /** Elements where a press means something other than "select this word". */
  function isSelectionExempt(target: HTMLElement | null): boolean {
    if (!target) return true;
    return !!(
      target.closest(".inline-note") ||
      target.closest(".navigation-bar") ||
      target.closest("button") ||
      target.closest(".nav-dropdown") ||
      target.closest(".toast") ||
      target.closest(".drag-handle-float") ||
      target.closest("[contenteditable='true']")
    );
  }

  /** Recompute the derived selection state from the anchor/focus pair. */
  function refreshSelectionFromPair() {
    if (!selAnchor || !selFocus) {
      selectedSegments = [];
      selectedWordCount = 0;
      return;
    }
    selectedSegments = selectionSegments(selAnchor, selFocus);
    selectedText = segmentsText(selectedSegments);
    selectedWordCount = segmentsWordCount(selectedSegments);
    selectedVerseNumber = selectedSegments[0]?.verse ?? selectedVerseNumber;
    paintSelection(selectedSegments, readerElement);
    selectionRange = segmentsToDomRange(selectedSegments);
  }

  function cancelWordDrag() {
    if (wordDrag?.holdTimer) clearTimeout(wordDrag.holdTimer);
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    wordDrag = null;
    dragArmed = false;
    dragSelecting = false;
    stopAutoScroll();
  }

  /**
   * Owns toast dismissal, for every gesture anywhere in the app.
   *
   * Runs on document in the capture phase so it sees a press before any other
   * handler and can stop the event reaching them. The rule it enforces: once a
   * toast is showing you either use it or dismiss it — nothing new gets
   * highlighted, and a fresh selection takes a second, deliberate tap.
   */
  function handleToastGuard(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Count every gesture, not just ones that land on verse text. The
    // "don't close the toast we just opened" check depends on this advancing.
    pointerSeq++;

    if (!showToast) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Anywhere the user types. Dismissing runs clearHighlights, which clears
    // the document selection — that takes the caret with it just as the tap
    // that focused the field lands.
    if (isTextEntry(target)) return;

    // The toast's own buttons are the other half of "use it or dismiss it".
    if (target.closest(".toast")) return;

    // A bumper press is undecided at this point: a drag adjusts the selection,
    // a tap dismisses. stopDrag settles it on release.
    if (target.closest(".drag-handle-float")) return;

    // Extend and Shift-click exist to make the next tap stretch the selection.
    if (extendArmed || e.shiftKey) return;

    // Presses on the text itself never reach here — the scrim covers them and
    // handles its own dismissal. What is left is everything outside the reader
    // text: the nav bar, other windows, blank chrome. Those dismiss the toast
    // and are then left alone, so their buttons still act in a single tap.
    dismissSelection();
    // A hover wrapper left over from a mouse must not outlive the toast.
    clearHoverHighlight();
  }

  /**
   * Press on the invisible layer covering the text: dismiss, and nothing else.
   *
   * Deliberately no preventDefault — a finger drag that starts here has to keep
   * scrolling the reader, which it does by chaining to the scrollable ancestor.
   */
  function handleScrimPress() {
    dismissSelection();
    clearHoverHighlight();
  }

  function handlePointerDown(e: PointerEvent) {
    // Secondary mouse buttons keep their normal meaning.
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (isSelectionExempt(target)) return;
    if (!target.closest(".verse-text")) return;

    // The Extend chip turns the next tap into "stretch to here" — no drag
    // needed. Shift-click is the desktop equivalent and needs no chip.
    if ((extendArmed || e.shiftKey) && selAnchor) {
      e.preventDefault();
      const pos = resolveWordAt(e.clientX, e.clientY, {
        interlinear: isInterlinearActive,
      });
      if (pos && sameSection(selAnchor, pos)) {
        extendArmed = false;
        selFocus = pos;
        refreshSelectionFromPair();
        haptic(15);
        finishWordSelection(e.clientX, e.clientY);
      }
      return;
    }

    // Toast goes away the instant a new gesture starts, and stays away
    // through the drag — it reappears on release, over the finished phrase.
    showToast = false;
    clearHighlights();
    clearPaintedSelection(readerElement);
    clearHoverHighlight();
    selectedSegments = [];
    selectedWordCount = 0;
    // Back to the word every time. Verse is a deliberate choice about the
    // selection you have, not a mode you leave switched on — most taps are
    // about the word you just tapped. Only a committed drag used to reset it,
    // so a plain tap kept selecting whole verses for the rest of the session.
    // Extend and shift-click return above this, so they still grow what's there.
    selectionMode = "word";

    // Suppress the OS text-selection UI (magnifier, callout, blue handles)
    // for the whole gesture. Must be set now, not on arming, because iOS
    // decides to show the callout well before our 300ms hold elapses.
    dragSelecting = true;
    dragArmed = false;

    // Stop the browser starting its own letter-by-letter selection drag.
    if (e.pointerType === "mouse") e.preventDefault();

    wordDrag = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      holdTimer: null,
    };

    // Holding still also starts a selection. That is the escape hatch for a
    // phrase that begins at the end of a line and continues on the next one,
    // where the first movement is downward and would otherwise scroll.
    if (e.pointerType !== "mouse") {
      wordDrag.holdTimer = window.setTimeout(() => {
        if (wordDrag && !dragArmed) armWordDrag();
      }, HOLD_MS);
    }
  }

  /** Commit the gesture to selecting. From here on, direction stops mattering. */
  function armWordDrag() {
    if (!wordDrag) return;

    const pos = resolveWordAt(wordDrag.startX, wordDrag.startY, {
      interlinear: isInterlinearActive,
    });
    if (!pos) {
      cancelWordDrag();
      return;
    }

    dragArmed = true;
    if (wordDrag.holdTimer) {
      clearTimeout(wordDrag.holdTimer);
      wordDrag.holdTimer = null;
    }

    selAnchor = pos;
    selFocus = pos;
    selectionMode = "word";
    refreshSelectionFromPair();
    haptic(15);

    try {
      readerElement?.setPointerCapture(wordDrag.pointerId);
    } catch {
      /* capture is a nicety — the document-level fallbacks still work */
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!wordDrag || e.pointerId !== wordDrag.pointerId) return;

    wordDrag.lastX = e.clientX;
    wordDrag.lastY = e.clientY;

    if (!dragArmed) {
      const dx = Math.abs(e.clientX - wordDrag.startX);
      const dy = Math.abs(e.clientY - wordDrag.startY);

      if (wordDrag.pointerType === "mouse") {
        if (Math.max(dx, dy) > MOUSE_ARM_PX) armWordDrag();
        return;
      }

      if (Math.max(dx, dy) <= ARM_PX) return;
      // Sideways means the finger is tracing a phrase; up or down means it is
      // scrolling the page. This is the one moment where direction decides.
      if (dx > dy) armWordDrag();
      else cancelWordDrag();
      return;
    }

    if (dragFrame === null) {
      dragFrame = requestAnimationFrame(() => {
        dragFrame = null;
        updateDragFocus();
      });
    }
  }

  /** Move the far end of the selection to whatever word is under the pointer. */
  function updateDragFocus() {
    if (!wordDrag || !dragArmed || !selAnchor) return;

    const pos = resolveWordAt(wordDrag.lastX, wordDrag.lastY, {
      interlinear: isInterlinearActive,
    });

    // A null hit (finger over a footnote marker, a margin, or chrome) simply
    // leaves the selection where it was rather than collapsing it.
    if (pos && sameSection(selAnchor, pos)) {
      const changed =
        !selFocus || selFocus.verse !== pos.verse || selFocus.start !== pos.start;
      if (changed) {
        selFocus = pos;
        refreshSelectionFromPair();
        haptic(8);
      }
    }

    maybeAutoScroll();
  }

  function handlePointerUp(e: PointerEvent) {
    if (!wordDrag || e.pointerId !== wordDrag.pointerId) return;

    const { startX, startY, pointerId } = wordDrag;
    const armed = dragArmed;
    const releaseX = e.clientX;
    const releaseY = e.clientY;

    if (wordDrag.holdTimer) clearTimeout(wordDrag.holdTimer);
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
    stopAutoScroll();
    try {
      readerElement?.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    wordDrag = null;
    dragArmed = false;
    dragSelecting = false;

    if (!armed) {
      // Never committed to a drag: this was a plain tap. Same path as before,
      // except the toast now appears on release instead of after a 500ms hold.
      selectWordAtPoint(startX, startY);
      return;
    }

    finishWordSelection(releaseX, releaseY);
  }

  function handlePointerCancel(e: PointerEvent) {
    if (!wordDrag || e.pointerId !== wordDrag.pointerId) return;
    // The browser took the gesture over to scroll the page.
    cancelWordDrag();
    clearPaintedSelection(readerElement);
    selectedSegments = [];
    selectedWordCount = 0;
  }

  /**
   * Block the page from scrolling once the gesture belongs to us. touch-action
   * on .verse is pan-y, so a gesture that armed on sideways movement (or on a
   * still hold) has not started scrolling yet, and preventDefault still holds.
   */
  function handleTouchMoveBlock(e: TouchEvent) {
    if (dragArmed) e.preventDefault();
  }

  /** Single-word tap: hand off to the existing rich lookup path unchanged. */
  function selectWordAtPoint(x: number, y: number) {
    clearHoverHighlight();
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el || !el.closest(".verse-text")) return;
    handleTextSelection(x, y, el);
  }

  /**
   * Release with a committed selection. One word behaves exactly like a tap so
   * Define/Bio/More Info keep working; a phrase takes the multi-word path and
   * skips the single-term lookups entirely.
   */
  function finishWordSelection(x: number, y: number) {
    if (!selAnchor || !selFocus || selectedSegments.length === 0) return;

    if (selectedWordCount <= 1) {
      // Re-enter through the normal single-word path, aimed at the middle of
      // the anchor word so the result does not depend on where the finger
      // stopped (which may have drifted into a gap).
      clearPaintedSelection(readerElement);
      const r = charRangeToDomRange(
        selAnchor.textEl,
        selAnchor.start,
        selAnchor.end - selAnchor.start,
      );
      const rect = r?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        selectWordAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      } else {
        selectWordAtPoint(x, y);
      }
      return;
    }

    // Multi-word: the single-term lookups do not apply, so bump the token to
    // void any in-flight person/ISBE request and clear their labels.
    personLabelToken++;
    selectedIsPerson = false;
    selectedPersonPlaces = [];
    selectedIsbeKind = null;
    selectedContext = null;
    selectionMode = "word";

    refreshSelectionFromPair();
    addSelectionHandles();
    showToastAt(x, y, { lookup: false });
  }

  // --- Auto-scroll while dragging near the top/bottom of the reader -------

  /** How far to nudge the reader this frame: negative up, positive down, 0 idle. */
  function autoScrollDelta(): number {
    if (!readerElement || !wordDrag || !dragArmed) return 0;
    const rect = readerElement.getBoundingClientRect();
    if (wordDrag.lastY - rect.top < AUTOSCROLL_EDGE) return -AUTOSCROLL_PX;
    if (rect.bottom - wordDrag.lastY < AUTOSCROLL_EDGE) return AUTOSCROLL_PX;
    return 0;
  }

  function maybeAutoScroll() {
    if (autoScrollDelta() === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollFrame !== null) return;

    // Re-read the delta every frame rather than closing over it, so lifting
    // the finger away from the edge stops the creep instead of re-arming it.
    const step = () => {
      autoScrollFrame = null;
      const delta = autoScrollDelta();
      if (delta === 0 || !readerElement) return;
      readerElement.scrollTop += delta;
      autoScrollFrame = requestAnimationFrame(step);
      updateDragFocus();
    };
    autoScrollFrame = requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
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

  /** True when (x, y) falls inside one of the hover span's line boxes. */
  function isPointInHoveredWord(x: number, y: number): boolean {
    if (!hoveredWordElement || !hoveredWordElement.isConnected) return false;
    const rects = hoveredWordElement.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  function handleMouseMove(e: PointerEvent) {
    const target = e.target as HTMLElement;

    // A finger has nothing to hover with — it is either on the glass or off it,
    // so previewing "the word you are about to tap" is meaningless. A mouse,
    // trackpad or stylus can genuinely float above a word, and those keep it.
    // Listening on pointermove rather than mousemove is what makes the pointer
    // type visible here; mousemove alone cannot tell a finger from a mouse.
    if (e.pointerType === "touch") return;

    // Interlinear mode uses CSS :hover on .il-word; skip the text-node
    // hover-wrap (it would corrupt the per-word structure + click offsets).
    if (isInterlinearActive) {
      clearHoverHighlight();
      return;
    }

    // Don't hover when dragging or when toast is open. dragSelecting covers the
    // word-drag gesture: the hover wrapper splits text nodes, which would
    // corrupt the caret offsets the drag reads on every frame.
    if (isDragging || showToast || dragSelecting) {
      clearHoverHighlight();
      return;
    }

    // Ignore special elements
    if (
      target.closest(".inline-note") ||
      target.closest(".toast") ||
      target.closest(".navigation-bar") ||
      target.closest("button")
    ) {
      clearHoverHighlight();
      return;
    }

    // Only handle if hovering over verse text. Resolve this BEFORE clearing —
    // clearHoverHighlight() detaches the span, and a detached e.target has no
    // ancestors, so .closest() would return null and the highlight would never
    // be rebuilt (that alternation is what made the hover strobe).
    const verseText = target.closest(".verse-text");
    if (!verseText) {
      clearHoverHighlight();
      return;
    }

    // Still inside the word we already highlighted — leave the DOM alone.
    // Rebuilding on every mousemove forced a reflow of the verse each event
    // and prevented the fade-in transition from ever running.
    if (isPointInHoveredWord(e.clientX, e.clientY)) return;

    // Clear any previous hover — must fully unwrap the span so the DOM text
    // nodes are merged back. Leaving orphan spans splits the text node and
    // corrupts caretRangeFromPoint offsets on the next click.
    clearHoverHighlight();

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

  // The old click handler lived here. Taps now arrive via handlePointerUp,
  // which routes an uncommitted press to selectWordAtPoint — that unwraps the
  // hover span and re-resolves the element before calling in here, exactly as
  // the click path used to.
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

    // Interlinear mode: each word is its own .il-word span carrying
    // data-word-index — resolve it directly and skip the segmenter path.
    const ilWord = target.closest?.(".il-word") as HTMLElement | null;
    if (ilWord && verseNumInt) {
      handleInterlinearWordClick(ilWord, verseNumInt, x, y);
      return;
    }

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
      selectedContext = null; // original-language word: no English phrase context
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
      // Capture neighbouring words so ISBE phrase expansion can rejoin "Red Sea".
      selectedContext = wordContext(text, wordBounds.start, wordBounds.end);

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

  // wordContext / getWordBounds now live in lib/wordSelection.ts so the drag
  // engine and the click paths agree on where a word starts and ends.
  const wordContext = wordContextAround;

  /**
   * Position the two fine-tune bumpers at the ends of the current selection.
   * Split out of highlightSelection so the drag engine can call it directly
   * after painting a multi-verse phrase.
   */
  function addSelectionHandles() {
    const range = selectionRange;
    if (!range) return;

    // Handles are appended to .text-container (position:relative), so all
    // offsets must be relative to that element's bounding rect — not the
    // scrollable .bible-reader which sits above the NavBar.
    const rects = range.getClientRects();
    const textContainer = readerElement?.querySelector(".text-container");
    if (rects.length === 0 || !textContainer) return;

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

  function highlightSelection(range: Range, mode: "word" | "verse") {
    // Clear previous highlights
    clearHighlights();

    if (mode === "word") {
      // Adopt the range into the anchor/focus model, then paint it with our
      // own spans. The browser's native selection is deliberately not used:
      // on a phone it summons the OS magnifier and copy callout, which fight
      // the drag, and it cannot express a whole-word-snapped range anyway.
      const pos = posFromRange(range);
      if (pos) {
        selAnchor = pos;
        selFocus = pos;
        refreshSelectionFromPair();
      } else {
        // Range didn't resolve to a place we can paint. Drop the pair rather
        // than leaving a stale one behind, and fall back to a single-word
        // toast so Define doesn't vanish on a word we simply couldn't map.
        selAnchor = null;
        selFocus = null;
        selectedSegments = [];
        selectedWordCount = 1;
        selectionRange = range;
      }
      addSelectionHandles();
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

  // A search result is a link like any other, so it gets the same mark in the
  // same book category color. It used to be an orange bordered box that matched
  // nothing else in the app, and in the main reader it never appeared at all.
  function clearSearchHighlight() {
    // Only clears a mark this function actually put there. It is called from a
    // reactive statement that runs whenever `highlightVerse` is falsy — which in
    // the main reader is always — so without this guard it would wipe the mark
    // every link navigation had just painted into the same slot.
    if (!searchHighlightedElement) return;
    searchHighlightedElement = null;
    clearVerseHighlight(slotFor('nav', windowId));
  }

  // Commentary anchor: mark all checkpoint verses in BibleReader (no scrolling).
  // Not a link navigation, so it keeps its own amber look rather than the book
  // category color. Scoped to the chapter like everything else now — unscoped,
  // it marked whichever loaded chapter happened to hold that verse number.
  async function applyAnchorHighlights(checkpoints: number[]) {
    clearAnchorHighlights();
    await tick();
    if (!readerElement) return;
    for (const n of checkpoints) {
      const el = findVerseEl(readerElement, currentBook, currentChapter, n);
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
    await tick();
    if (!readerElement) return;
    const verseEl = showVerseHighlight(
      readerElement,
      slotFor('nav', windowId),
      { book: currentBook, chapter: currentChapter, verse: verseNumber },
      { color: categoryColorFor(currentBook), rtl: isHebrewTranslation(currentTranslation) },
    );
    if (!verseEl) return;
    searchHighlightedElement = verseEl;
    // One landing behaviour for the whole app. This used to centre the verse
    // with scrollIntoView while every other jump put it near the top, so the
    // same verse arrived in a different place depending on how you got there.
    void scrollToTarget(currentBook, currentChapter, verseNumber);
  }

  function clearHighlights() {
    // Clear browser selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Unwrap the painted word-selection spans. The anchor/focus pair is left
    // alone — highlightSelection clears before it repaints, and the Extend
    // chip still needs the anchor after the visual selection is torn down.
    clearPaintedSelection(readerElement);

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

  /**
   * Put the toast away and take the selection with it.
   *
   * Unlike clearHighlights, this also drops the anchor/focus pair. Once the
   * user has dismissed, there is no selection left to extend — leaving the pair
   * behind would let a later Shift-click stretch from a word that is no longer
   * on screen.
   */
  function dismissSelection() {
    showToast = false;
    extendArmed = false;
    selAnchor = null;
    selFocus = null;
    selectedSegments = [];
    selectedWordCount = 0;
    // Nothing selected means nothing to be in verse mode about — so the next
    // tap starts on the word whichever way you got here.
    selectionMode = "word";
    clearHighlights();
  }

  function startDrag(e: MouseEvent, edge: "left" | "right") {
    // Only the primary button adjusts an edge, same rule as handleToastGuard.
    if (e.button !== 0) return;

    // Drop the phantom press that a tap leaves behind.
    //
    // A tap builds its bumpers synchronously, during pointerup — so by the time
    // the browser replays that same tap as compatibility mouse events, there are
    // two 32px hit strips sitting on the word's edges that did not exist when the
    // finger went down. On a word narrower than the strips (of, the, and, God)
    // they cover it entirely, the replayed mousedown lands on one, and the
    // matching mouseup reaches stopDrag as a tap — which dismisses the selection
    // milliseconds after it appeared.
    //
    // Replays carry no pointerdown, so pointerSeq still points at the gesture
    // that opened the toast. A real press, finger or mouse, always fires a
    // pointerdown first and handleToastGuard counts it, so a genuine bumper tap
    // still dismisses and a genuine bumper drag still widens the selection.
    if (showToast && pointerSeq === toastPointerSeq) return;

    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragEdge = edge;
    edgeDragOrigin = { x: e.clientX, y: e.clientY };
    edgeDragMoved = false;

    // Prevent toast from closing during drag
    document.addEventListener("mousemove", handleDrag, true);
    document.addEventListener("mouseup", stopDrag, true);
  }

  /**
   * Move one end of the selection to the whole word under (x, y).
   *
   * The bumpers used to nudge a raw character offset, which is why widening a
   * selection felt like steering a cursor. They now move the anchor/focus pair,
   * so every step lands on a word boundary. "left" moves whichever end reads
   * first, "right" whichever reads last, regardless of which one is the anchor.
   */
  function moveSelectionEdge(x: number, y: number) {
    if (!dragEdge || !selAnchor || !selFocus) return;

    const pos = resolveWordAt(x, y, { interlinear: isInterlinearActive });
    if (!pos || !sameSection(selAnchor, pos)) return;

    const anchorIsFirst = comparePos(selAnchor, selFocus) <= 0;
    const movingAnchor = dragEdge === "left" ? anchorIsFirst : !anchorIsFirst;

    if (movingAnchor) selAnchor = pos;
    else selFocus = pos;

    clearHighlights();
    refreshSelectionFromPair();
    addSelectionHandles();
  }

  /** Did this bumper press travel far enough to count as a drag rather than a tap? */
  function trackEdgeDrag(x: number, y: number): boolean {
    if (!edgeDragOrigin) return true;
    if (!edgeDragMoved) {
      const dx = Math.abs(x - edgeDragOrigin.x);
      const dy = Math.abs(y - edgeDragOrigin.y);
      if (Math.max(dx, dy) > EDGE_TAP_SLOP) edgeDragMoved = true;
    }
    return edgeDragMoved;
  }

  function handleDrag(e: MouseEvent) {
    if (!isDragging || !dragEdge) return;
    if (!trackEdgeDrag(e.clientX, e.clientY)) return;
    moveSelectionEdge(e.clientX, e.clientY);
  }

  function stopDrag() {
    const wasTap = !edgeDragMoved;
    isDragging = false;
    dragEdge = null;
    edgeDragOrigin = null;
    edgeDragMoved = false;
    document.removeEventListener("mousemove", handleDrag, true);
    document.removeEventListener("touchmove", handleDragTouch, true);
    document.removeEventListener("mouseup", stopDrag, true);
    document.removeEventListener("touchend", stopDrag, true);

    // A press on a bumper that never travelled is a tap, and a tap anywhere
    // outside the toast means "put this away". Without this the two bumpers
    // are dead zones sitting right where a thumb naturally lands.
    if (wasTap) {
      dismissSelection();
      return;
    }

    // Re-assert word mode so a drag can't silently flip the selection type
    if (selectionRange) {
      selectionMode = 'word';
    }
  }

  function startDragTouch(e: TouchEvent, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();

    // Cancel any word drag that armed before the finger reached the bumper
    cancelWordDrag();

    isDragging = true;
    dragEdge = edge;
    const t0 = e.touches[0];
    edgeDragOrigin = t0 ? { x: t0.clientX, y: t0.clientY } : null;
    edgeDragMoved = false;

    // Prevent toast from closing during drag
    document.addEventListener("touchmove", handleDragTouch, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", stopDrag, { capture: true });
  }

  function handleDragTouch(e: TouchEvent) {
    if (!isDragging || !dragEdge) return;
    e.preventDefault();

    const touch = e.touches[0];
    if (!touch) return;
    if (!trackEdgeDrag(touch.clientX, touch.clientY)) return;
    moveSelectionEdge(touch.clientX, touch.clientY);
  }

  /**
   * The lines the toast has to stay off: the top of the selection's first line
   * and the bottom of its last, each with its own centre so the toast sits over
   * whichever end it ends up beside.
   */
  interface ToastAnchor {
    top: number;
    bottom: number;
    topCenterX: number;
    bottomCenterX: number;
    /** Centre of the first line — where the radial menu's hole goes. */
    centerX: number;
    centerY: number;
    /** The first line's box height. Sizes the radial menu's gaps. */
    lineHeight: number;
  }

  /** Gap between the toast and the selection, and between it and the screen edge. */
  const TOAST_GAP = 10;
  const TOAST_MARGIN = 8;

  /**
   * Where the current selection sits on screen.
   *
   * Zero-area rects are dropped: a range over freshly split text nodes can
   * report one, and it would otherwise drag the anchor to the top-left corner
   * and make the toast look like it had come loose from the word.
   *
   * The fallback point is used when the click resolved a word but not a
   * paintable range (highlightSelection's null-pos branch) — the toast then
   * clears a notional line around the finger rather than sitting under it.
   */
  function selectionAnchor(fallbackX?: number, fallbackY?: number): ToastAnchor | null {
    const rects = selectionRange ? Array.from(selectionRange.getClientRects()) : [];
    const solid = rects.filter((r) => r.width > 0 && r.height > 0);

    if (solid.length > 0) {
      let first = solid[0];
      let last = solid[0];
      for (const r of solid) {
        if (r.top < first.top) first = r;
        if (r.bottom > last.bottom) last = r;
      }
      return {
        top: first.top,
        bottom: last.bottom,
        topCenterX: first.left + first.width / 2,
        bottomCenterX: last.left + last.width / 2,
        centerX: first.left + first.width / 2,
        centerY: first.top + first.height / 2,
        lineHeight: Math.max(first.height, cssLineHeight()),
      };
    }

    if (fallbackX === undefined || fallbackY === undefined) return null;
    const line = Math.max(24, cssLineHeight());
    return {
      top: fallbackY - line / 2,
      bottom: fallbackY + line / 2,
      topCenterX: fallbackX,
      bottomCenterX: fallbackX,
      centerX: fallbackX,
      centerY: fallbackY,
      lineHeight: line,
    };
  }

  /**
   * The reader's line box in px. A selection rect only spans the glyphs, not the
   * leading around them, so the radial menu asks for the real line height —
   * that is what makes its gaps open and close with the font-size slider.
   */
  function cssLineHeight(): number {
    const el = readerElement?.querySelector<HTMLElement>(".verse-text");
    if (!el) return 0;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return Number.isFinite(lh) ? lh : 0;
  }

  /**
   * The toast's last measured size, reused by the scroll path so following a
   * selection down the page costs no extra layout work.
   */
  let toastSize = { w: 200, h: 120 };

  /**
   * Measure the rendered toast rather than assuming a size. The button grid
   * grows and shrinks with the selection and the buttons don't wrap, so the old
   * fixed guess ran short and left the toast sitting back over its own word.
   */
  async function measureToast() {
    await tick();
    // On the opening call the component mounts inside this same flush, so give
    // the binding one more turn to land rather than falling back to a guess.
    let r = toastComp?.rect();
    if (!r) {
      await tick();
      r = toastComp?.rect();
    }
    if (r && r.width > 0 && r.height > 0) toastSize = { w: r.width, h: r.height };
  }

  /**
   * Put the toast beside the selection, never on top of it. Above the first line
   * is preferred; below the last line is the fallback; only when neither side
   * can hold it does it clamp to the roomier side.
   */
  function positionToast(anchor: ToastAnchor) {
    if (radialActive) {
      positionRadial(anchor);
      return;
    }

    const { w, h } = toastSize;

    // Top limit is the reader's own top edge, so the toast never rides up over
    // the navigation bar; bottom limit is the screen.
    const safeTop = Math.max(
      TOAST_MARGIN,
      readerElement?.getBoundingClientRect().top ?? TOAST_MARGIN,
    );
    const safeBottom = window.innerHeight - TOAST_MARGIN;

    const above = anchor.top - TOAST_GAP - h;
    const below = anchor.bottom + TOAST_GAP;

    let y: number;
    let centerX: number;
    if (above >= safeTop) {
      y = above;
      centerX = anchor.topCenterX;
    } else if (below + h <= safeBottom) {
      y = below;
      centerX = anchor.bottomCenterX;
    } else if (anchor.top - safeTop >= safeBottom - anchor.bottom) {
      y = Math.max(safeTop, above);
      centerX = anchor.topCenterX;
    } else {
      y = Math.min(safeBottom - h, below);
      centerX = anchor.bottomCenterX;
    }

    toastX = Math.min(
      Math.max(centerX - w / 2, TOAST_MARGIN),
      Math.max(TOAST_MARGIN, window.innerWidth - w - TOAST_MARGIN),
    );
    toastY = y;
    toastPlaced = true;
  }

  // --- Radial menu placement ---------------------------------------------

  /** The inputs that decide which buttons the ring shows, and so how many. */
  function radialOpts(): RadialItemOpts {
    return {
      mode: selectionMode,
      wordCount: selectedWordCount,
      isPlace: selectionHasMap,
      isPerson: selectedIsPerson,
      moreInfo: !selectedIsPerson && selectedIsbeKind !== null,
      extendArmed,
      canSpeak: selectionCanSpeak,
    };
  }

  function radialOuter(anchor: ToastAnchor): number {
    return radialOuterRadius(anchor.lineHeight, radialItemCount(radialOpts()));
  }

  /** Is there room for the ring at all? The reader can be a narrow docked pane. */
  function radialFits(anchor: ToastAnchor): boolean {
    if (!readerElement) return false;
    const b = readerElement.getBoundingClientRect();
    const need = radialOuter(anchor) * 2 + TOAST_MARGIN * 2;
    return b.width >= need && b.height >= need;
  }

  /**
   * Centre the ring on the word.
   *
   * Horizontally it slides to fit — that costs nothing, because the two gaps run
   * along the word's own line, so a word pushed off-centre simply sits in the
   * left or right opening and stays readable. Clamped against the reader, not
   * the window: the reader can be one pane of several.
   *
   * Vertically there is no clamp at all. Moving the ring off the word's line
   * would put an arc over the word, which is the one thing it exists to avoid —
   * showToastAt nudges the page instead, before we ever get here.
   */
  function positionRadial(anchor: ToastAnchor) {
    const outer = radialOuter(anchor);
    const b = readerElement?.getBoundingClientRect();
    const left = (b?.left ?? 0) + TOAST_MARGIN;
    const right = (b?.right ?? window.innerWidth) - TOAST_MARGIN;

    radialLine = anchor.lineHeight;
    radialCX =
      right - left >= outer * 2
        ? Math.min(Math.max(anchor.centerX, left + outer), right - outer)
        : (left + right) / 2;
    radialCY = anchor.centerY;
    toastPlaced = true;
  }

  /**
   * Scroll the reader just enough that a full ring fits above and below the word,
   * and report how far the content moved so the caller can place against where
   * the word is about to be. Text starts about 80px from the top of the screen
   * and the ring wants ~125px, so the first line or two of a screen need a nudge
   * of around 50px. Returns 0 when there is already room, or when the scroller
   * has nothing left to give.
   */
  function nudgeRingIntoView(anchor: ToastAnchor): number {
    if (!readerElement) return 0;

    const outer = radialOuter(anchor);
    const b = readerElement.getBoundingClientRect();
    const short = b.top + TOAST_MARGIN - (anchor.centerY - outer);
    const over = anchor.centerY + outer - (b.bottom - TOAST_MARGIN);

    let shift = short > 0 ? short : over > 0 ? -over : 0;
    if (shift === 0) return 0;

    // Scrolling up moves the content down. Take only what the scroller has.
    const room =
      shift > 0
        ? readerElement.scrollTop
        : readerElement.scrollHeight - readerElement.clientHeight - readerElement.scrollTop;
    shift = Math.sign(shift) * Math.min(Math.abs(shift), Math.max(0, room));
    if (shift === 0) return 0;

    readerElement.scrollBy({ top: -shift, behavior: "smooth" });
    return shift;
  }

  /** Measure, then place. Used when the toast opens or its contents change. */
  async function placeToast(anchor: ToastAnchor) {
    // The ring derives its own size, so there is nothing to measure.
    if (radialActive) {
      positionToast(anchor);
      return;
    }
    await measureToast();
    if (!showToast) return;
    positionToast(anchor);
  }

  /**
   * Re-measure and re-place the toast where it already is. Its contents change
   * after it opens — the Bio / More Info labels resolve asynchronously, Map
   * appears, the Word/Verse toggle rewrites the whole grid — and any of those
   * can make it wider or taller than it was when it was first positioned.
   */
  function replaceToastInPlace() {
    if (showToast && toastAnchor) void placeToast(toastAnchor);
  }

  /**
   * Re-anchor the open toast over its selection after a scroll.
   * Hides it once the selection leaves the viewport — the selection itself and
   * the armed Extend chip both survive, so scroll-then-tap still works.
   */
  function repositionToastToSelection() {
    if (!readerElement) return;
    const anchor = selectionAnchor();
    if (!anchor) return;

    const bounds = readerElement.getBoundingClientRect();
    if (anchor.bottom < bounds.top || anchor.top > bounds.bottom) {
      showToast = false;
      return;
    }

    // Its contents haven't changed, only where it has to sit, so reuse the size
    // measured when it opened rather than reflowing it on every scroll event.
    toastAnchor = anchor;
    positionToast(anchor);
  }

  function showToastAt(x: number, y: number, opts: { lookup?: boolean } = {}) {
    const { lookup = true } = opts;
    // Clear any hover highlight — full unwrap required (see clearHoverHighlight)
    clearHoverHighlight();

    // Measure off the selection's own line boxes, not the finger: the toast has
    // to clear the word you tapped, and on a phrase that wraps it has to clear
    // every line of it.
    toastAnchor = selectionAnchor(x, y);
    toastPlaced = false;

    // Clear the previous word's labels up front. The lookups below refill them,
    // but the ring counts its buttons from these to size itself, and it must not
    // do that against the word you tapped a moment ago.
    selectedIsPerson = false;
    selectedPersonPlaces = [];
    selectedIsbeKind = null;

    // Decided once per opening and held for the life of the menu, so a label
    // resolving later can't swap the whole UI out from under a finger.
    radialActive = selectionMenu === "radial" && !!toastAnchor && radialFits(toastAnchor);

    if (radialActive && toastAnchor) {
      // Make room first, then place against where the word is about to be — the
      // scroll is smooth, and waiting for it would open the ring half off-screen.
      const shift = nudgeRingIntoView(toastAnchor);
      if (shift !== 0) {
        toastAnchor = {
          ...toastAnchor,
          top: toastAnchor.top + shift,
          bottom: toastAnchor.bottom + shift,
          centerY: toastAnchor.centerY + shift,
        };
      }
    }

    showToast = true;
    justOpenedToast = true;
    toastPointerSeq = pointerSeq;

    if (toastAnchor) void placeToast(toastAnchor);

    // Resolve "is this a character?" in the background so the Define button can
    // relabel itself to Bio. Both flags were cleared above, so the menu never
    // flashes the wrong label, and the token guard drops a stale answer if you
    // click another word while the lookup is in flight.
    const token = ++personLabelToken;
    const word = selectedText;
    const ctx = selectedContext;
    const personRef =
      selectedVerseNumber != null
        ? { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber }
        : null;
    // A phrase has no single term to look up, so the caller turns this off and
    // the toast drops Define/Bio/More Info instead of guessing.
    if (lookup && word && selectionMode === "word") {
      import("../adapters/lexicon-lookup.js")
        .then(async ({ resolveClickedPersonId, getPersonPlaces, classifyIsbeClick }) => {
          // Person outranks ISBE for the label, so resolve it first and only fall
          // back to the ISBE ("More Info") check when it isn't a character.
          const personId = await resolveClickedPersonId(word, personRef);
          if (token !== personLabelToken) return;
          selectedIsPerson = personId !== null;
          if (personId !== null) {
            // A character keeps the Bio label, but can still earn a Map seat:
            // the places their story touches are worth seeing laid out. Only
            // when there are some — an unplaced minor name gets Bio alone.
            const places = await getPersonPlaces(personId);
            if (token !== personLabelToken) return;
            selectedPersonPlaces = places;
            replaceToastInPlace();
            return;
          }
          const kind = await classifyIsbeClick({
            word,
            before: ctx?.before,
            after: ctx?.after,
            ref: personRef,
          });
          if (token !== personLabelToken) return;
          selectedIsbeKind = kind;
          if (kind) replaceToastInPlace();
        })
        .catch(() => {});
    }

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

  // Re-paint repeat highlights (and, on top, place markers) across all rendered
  // chapter sections. Called reactively whenever the repeats store, the place-marker
  // setting, or the rendered chapters change. Repeats are applied first; the place
  // markers only wrap pure-text runs, so the two never nest or corrupt each other.
  async function repaintRepeats(groups: RepeatGroup[], placeMarkers: boolean) {
    await tick();
    if (!readerElement) return;
    applyRepeatsToAllSections(readerElement, groups);
    applyPlaceMarkersToAllSections(readerElement, placeMarkers);
  }

  // Re-apply the overlays whenever the tracked words change, the place-marker
  // setting toggles, or a new chapter scrolls into view (referencing chapters
  // keeps it reactive).
  $: if (readerElement && chapters) void repaintRepeats($repeatsStore, showPlaceMarkers && placePhrasesLoaded);

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
    const capturedContext = selectedContext;
    console.log(`Action: ${action} on "${text}"`);

    // TODO: Wire up actual actions
    switch (action) {
      case "speak":
        void speakOriginalWord(capturedMorphology?.text || text, capturedMorphology?.language);
        showToast = false;
        break;

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
            const { lookupWord, lookupStrongs, lookupEnglishWord, lookupPerson, resolveIsbeClick } = await import('../adapters/lexicon-lookup.js');
            console.log('✅ Module imported successfully');

            // Resolve the clicked word as a biblical character, disambiguating by
            // the verse it was clicked in (handles homonyms like the six Marys).
            const verseRefForPerson = selectedVerseNumber != null
              ? { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber }
              : null;
            const characterData = await lookupPerson(text, verseRefForPerson);
            if (characterData) console.log('👤 Character match:', characterData.person.id, 'byVerse:', characterData.matchedByVerse);

            // Not a character? Try ISBE. A place (possibly via a multi-word phrase
            // like "Red Sea") or a general encyclopedia entry opens the ISBE modal,
            // taking precedence over the plain dictionary definition.
            if (!characterData) {
              const isbe = await resolveIsbeClick({
                word: text,
                before: capturedContext?.before,
                after: capturedContext?.after,
                ref: verseRefForPerson,
              });
              if (isbe) {
                console.log('📕 ISBE match:', isbe.kind, isbe.primaryName, isbe.phrase ? `(phrase: ${isbe.phrase})` : '');
                isbeModalStore.open({
                  kind: isbe.kind,
                  entryId: isbe.entryId,
                  placeId: isbe.placeId ?? null,
                  primaryName: isbe.primaryName,
                });
                showToast = false;
                return;
              }
            }

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
      case "map": {
        // A character goes straight to the map window: their places are several
        // and scattered, which is the one thing the Encyclopedia's single-marker
        // Map tab cannot show. A place opens that tab, where the article sits a
        // tap away, and the tab's own button carries it on to the window.
        if (selectedIsPerson && selectedPersonPlaces.length) {
          // Left open if the six-window cap turned us down, so the tap visibly
          // did nothing rather than quietly dismissing the menu for nothing.
          if (openMapWindow(text, selectedPersonPlaces)) showToast = false;
          break;
        }
        const mapPersonRef = selectedVerseNumber != null
          ? { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber }
          : null;
        (async () => {
          try {
            const { resolveIsbeClick } = await import('../adapters/lexicon-lookup.js');
            const isbe = await resolveIsbeClick({
              word: text,
              before: capturedContext?.before,
              after: capturedContext?.after,
              ref: mapPersonRef,
            });
            if (!isbe || isbe.kind !== 'place') return;
            isbeModalStore.open({
              kind: 'place',
              entryId: isbe.entryId,
              placeId: isbe.placeId ?? null,
              primaryName: isbe.primaryName,
              tab: 'map',
            });
          } catch (error) {
            console.error('Error opening map for selection:', error);
          }
        })();
        showToast = false;
        break;
      }
      case "highlight": {
        if (selectedVerseNumber === null) break;
        const hlRef = { book: currentBook, chapter: currentChapter, verse: selectedVerseNumber };
        // Capture the selection's character runs now, synchronously, before the
        // modal opens and the painted spans are torn down. One run per verse,
        // so a phrase that crosses a verse boundary saves as several records.
        pendingWordSpans =
          selectionMode === 'word'
            ? selectedSegments.map(s => ({
                verse: s.verse,
                wordStart: s.start,
                wordLength: s.length,
              }))
            : [];
        // Find existing highlight for this verse
        const existingV = chapterVerseHighlights.find(
          h => h.reference.verse === selectedVerseNumber
        ) ?? null;
        // Only a highlight that actually overlaps the selection counts as the
        // one being edited. Two separate phrases can live in the same verse.
        const existingW = selectionMode === 'word'
          ? chapterWordHighlights.find(h =>
              h.translation === currentTranslation &&
              pendingWordSpans.some(p =>
                p.verse === h.reference.verse &&
                p.wordStart < h.wordStart + h.wordLength &&
                h.wordStart < p.wordStart + p.wordLength
              )
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
      case "extend":
        // Arm the next tap to stretch the selection instead of replacing it.
        // Everything stays on screen — the toast, the painted words, the anchor
        // — so you can even scroll away before tapping the far end.
        extendArmed = !extendArmed;
        // "Extend" ↔ "Tap a word…" is a wider button, so the toast changes size.
        replaceToastInPlace();
        return;
    }

    // Close toast after action
    if (action !== "dissect") {
      showToast = false;
    }
    extendArmed = false;
    clearHighlights();
  }

  function handleModeChange(event: CustomEvent) {
    selectionMode = event.detail;

    // Going back to Word: repaint from the anchor/focus pair, not from the
    // Range. A phrase spanning verses has no single Range that survives the
    // round trip, and re-deriving from the pair keeps it whole.
    if (selectionMode === "word" && selAnchor && selFocus) {
      clearHighlights();
      refreshSelectionFromPair();
      addSelectionHandles();
    } else if (selectionRange) {
      highlightSelection(selectionRange, selectionMode);
    }

    // The toggle swaps which buttons the grid holds, so the toast changes size.
    replaceToastInPlace();
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Anywhere the user types — see handleToastGuard. This runs on every click
    // in the app, so without it clicking into any text field anywhere clears
    // the document selection and the caret goes with it.
    if (isTextEntry(target)) return;

    // Don't close if dragging
    if (isDragging) return;

    // Don't close if toast was just opened
    if (justOpenedToast) return;
    // Don't close on the click that trails the very gesture which opened it.
    if (showToast && pointerSeq === toastPointerSeq) return;

    if (!target.closest(".intro-repeat-wrap")) introMenuKey = null;

    // Dismissal proper is handleToastGuard's job now — it fires on pointer-down
    // rather than on click, so by the time we get here the toast is normally
    // already gone. This stays as the backstop for clicks with no pointer
    // sequence behind them (keyboard activation, synthetic clicks).
    if (!target.closest(".selection-highlight") && !target.closest(".toast")) {
      dismissSelection();
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
          anchorSyncDebounce = null;
          // Always update navbar position — this is what keeps the navbar and
          // commentary in sync as the user scrolls through multiple chapters.
          // Window panes must NOT write back to global nav — they are isolated.
          // Skipped entirely just after a deliberate navigation, which this
          // would otherwise undo.
          if (!windowId && Date.now() >= suppressScrollSyncUntil) {
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

    // Open the ISBE indexes now rather than on the first tapped word. The ring
    // sizes itself the moment it opens and will not grow a seat afterwards, so
    // whether Map appears at all came down to whether this lookup had ever been
    // run before — the first place you tapped in a session lost that race, and
    // every one after it won.
    import("../adapters/lexicon-lookup.js")
      .then(({ warmIsbeLookup }) => warmIsbeLookup())
      .catch(() => {});

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

    // Text selection. Pointer events cover finger, pen and mouse in one path;
    // the extra non-passive touchmove exists only to stop the page scrolling
    // once a drag has committed to selecting.
    // Dismissal runs on document in the capture phase so it sees every press
    // first — including presses on chrome the reader's own handler ignores —
    // and can stop the event before anything selects or opens.
    document.addEventListener("pointerdown", handleToastGuard, true);

    readerElement?.addEventListener("pointermove", handleMouseMove);
    readerElement?.addEventListener("pointerdown", handlePointerDown);
    // move/up/cancel live on window, not the reader: a press that is released
    // outside the reader (or off the edge of the screen) must still end the
    // gesture, or user-select:none would stay stuck on the text.
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    readerElement?.addEventListener("touchmove", handleTouchMoveBlock, {
      passive: false,
    });
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
      glowCleanup?.();
      glowCleanup = null;
      // Drop this reader's marks along with their observers and timers. Only
      // its own — the main view and any window panes each keep their own.
      clearVerseHighlightsFor(windowId);
      window.removeEventListener("settingsUpdated", handleSettingsUpdate);
      readerElement?.removeEventListener("click", handleNoteClick, true);
      readerElement?.removeEventListener("pointermove", handleMouseMove);
      document.removeEventListener("pointerdown", handleToastGuard, true);
      readerElement?.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      readerElement?.removeEventListener("touchmove", handleTouchMoveBlock);
      document.removeEventListener("click", handleClickOutside);
      cancelWordDrag();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeHighlightChanges();
      unsubscribeNoteChanges();
      stopScrollDetection();
      if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
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
  {#if radialActive}
    <RadialSelectionMenu
      cx={radialCX}
      cy={radialCY}
      lineHeight={radialLine}
      placed={toastPlaced}
      {selectedText}
      isPlace={selectionHasMap}
      isPerson={selectedIsPerson}
      moreInfo={!selectedIsPerson && selectedIsbeKind !== null}
      mode={selectionMode}
      wordCount={selectedWordCount}
      {extendArmed}
      canSpeak={selectionCanSpeak}
      on:action={handleToastAction}
      on:modeChange={handleModeChange}
    />
  {:else}
    <SelectionToast
      bind:this={toastComp}
      placed={toastPlaced}
      x={toastX}
      y={toastY}
      {selectedText}
      isPlace={selectionHasMap}
      isPerson={selectedIsPerson}
      moreInfo={!selectedIsPerson && selectedIsbeKind !== null}
      mode={selectionMode}
      wordCount={selectedWordCount}
      {extendArmed}
      canSpeak={selectionCanSpeak}
      on:action={handleToastAction}
      on:modeChange={handleModeChange}
    />
  {/if}
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

      if (highlightSelectionType === 'word' && pendingWordSpans.length > 0) {
        // Character runs were captured at toast-action time, before the painted
        // spans came down. A phrase spanning verses saves one record per verse.
        const spans = pendingWordSpans;

        // Replace only what this selection actually covers, so an unrelated
        // phrase elsewhere in the same verse survives.
        const overlapping = chapterWordHighlights.filter(h =>
          h.translation === currentTranslation &&
          spans.some(p =>
            p.verse === h.reference.verse &&
            p.wordStart < h.wordStart + h.wordLength &&
            h.wordStart < p.wordStart + p.wordLength
          )
        );
        for (const prev of overlapping) {
          await userDataStore.deleteWordHighlight(prev.id);
          await syncQueue.enqueue({ type: 'DELETE', table: 'user_word_highlights', id: prev.id });
        }

        for (const span of spans) {
          const saved = await userDataStore.saveWordHighlight({
            reference: { book: highlightModalRef.book, chapter: highlightModalRef.chapter, verse: span.verse },
            translation: currentTranslation,
            wordStart: span.wordStart, wordLength: span.wordLength, style,
          });
          await syncQueue.enqueue({ type: 'INSERT', table: 'user_word_highlights', id: saved.id, data: {
            id: saved.id, book: saved.reference.book, chapter: saved.reference.chapter,
            verse: saved.reference.verse, translation: saved.translation,
            word_start: saved.wordStart, word_length: saved.wordLength,
            style: JSON.stringify(saved.style), created_at: saved.createdAt.toISOString(),
          }});
        }
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
          // Remove every record the selection covers, so a phrase that saved as
          // several per-verse rows comes off in one go rather than one row at a time.
          const targets = pendingWordSpans.length > 0
            ? chapterWordHighlights.filter(h =>
                h.translation === currentTranslation &&
                pendingWordSpans.some(p =>
                  p.verse === h.reference.verse &&
                  p.wordStart < h.wordStart + h.wordLength &&
                  h.wordStart < p.wordStart + p.wordLength
                )
              )
            : [highlightModalExisting as UserWordHighlight];
          for (const t of targets) {
            await userDataStore.deleteWordHighlight(t.id);
            await syncQueue.enqueue({ type: 'DELETE', table: 'user_word_highlights', id: t.id });
          }
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


<div
  class="bible-reader"
  class:drag-selecting={dragSelecting}
  class:edge-dragging={isDragging}
  bind:this={readerElement}
  bind:clientWidth={readerClientWidth}
>
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
        <div class="chapter-section" class:flat-titles={!themedTitles} data-chapter-section data-book={chapterData.book} data-chapter={chapterData.chapter}>
          <div class="chapter-header">
            <h1 style="--title-shadow:{getBookColor(chapterData.book)}">{chapterData.book} {chapterData.chapter}</h1>
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
            {#if FEATURES.ttsReadAloud && (!isOriginalLanguage(currentTranslation) || canSpeakOriginal(currentTranslation))}
              <TtsPlayer translation={currentTranslation} book={chapterData.book} chapter={chapterData.chapter} />
            {/if}
          </div>
          <div
            class="verses {translationFontClass}"
            class:paragraph-layout={verseLayout === "paragraph"}
            class:nonumber-layout={verseLayout === "paragraph-no-verse-numbers"}
            class:interlinear-active={isInterlinearActive}
            class:il-rtl={isInterlinearActive && isInterlinearRtl}
            class:il-show-gloss={isInterlinearActive && interlinearSettings.showGloss}
            class:il-show-translit={isInterlinearActive && interlinearSettings.showTranslit}
            class:il-show-lemma={isInterlinearActive && interlinearSettings.showLemma}
            class:il-show-strongs={isInterlinearActive && interlinearSettings.showStrongs}
            class:il-show-parse={isInterlinearActive && interlinearSettings.showParsing}
            style="--verse-num-color:{getBookColor(chapterData.book)}"
          >
            {#each chapterData.verses as { verse, text, html, interlinearHtml, heading, headingLevel, paraStart, poetryLevel, stanzaBreak }, verseIdx (`${currentTranslation}-${chapterData.book}-${chapterData.chapter}-${verse}`)}
              {@const hCtxsForVerse = chHarmCtxs.filter((c) => c.passage.endChapter === chapterData.chapter && (c.passage.endVerse !== null ? verse === c.passage.endVerse : verseIdx === chapterData.verses.length - 1))}
              {#if heading && showSectionHeadings}
                <div class="section-heading section-heading--s{headingLevel || 1}">{heading}</div>
              {/if}
              <div
                class="verse"
                class:para-start={paraStart}
                class:poetry-1={poetryLevel === 1}
                class:poetry-2={poetryLevel === 2}
                class:stanza-break={stanzaBreak}
                class:tts-speaking={ttsHighlightVerse &&
                  $ttsCurrentVerse?.book === chapterData.book &&
                  $ttsCurrentVerse?.chapter === chapterData.chapter &&
                  $ttsCurrentVerse?.verse === verse}
                data-verse={verse}
              >
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
                {#if showArt && artByVerse.has(annotationKey(chapterData.book, chapterData.chapter, verse))}
                  {@const artScene = artByVerse.get(annotationKey(chapterData.book, chapterData.chapter, verse))![0]}
                  <span
                    class="art-icon"
                    title={`Art: ${artScene.title}`}
                    role="button"
                    tabindex="0"
                    on:click|stopPropagation={() => openArtWindow(artScene)}
                    on:keypress|stopPropagation={(e) => e.key === 'Enter' && openArtWindow(artScene)}
                  >🖼️</span>
                {/if}
                <span class="verse-text"
                  class:interlinear={isInterlinearActive && !!interlinearHtml}
                  >{@html (isInterlinearActive && interlinearHtml) ? interlinearHtml : (html || renderVerseHtml(text))}</span
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

    <!--
      Invisible layer over the text while the toast is up.

      A tap here targets this div, not the word beneath it, so nothing in the
      reader can react to it — not the hover wrapper, and not elementFromPoint
      or caretRangeFromPoint, which both return this instead of a word. That is
      the whole reason it exists: the previous approach chased individual
      events, and a tap on a phone fires several (it emits compatibility mouse
      events on top of the pointer ones), so one always slipped through.

      Sits below the bumpers at z-index 100 so those stay grabbable, and inside
      .text-container so the nav bar beside it keeps working in a single tap.
      No preventDefault in the handler and no touch-action here: a finger drag
      must still scroll the reader by chaining to it.
    -->
    {#if showToast}
      <div
        class="toast-scrim"
        class:pass-through={extendArmed}
        on:pointerdown={handleScrimPress}
      ></div>
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

{#if speakFailedWord}
  <div class="speak-voice-notice">
    <span>Couldn’t pronounce “{speakFailedWord}” cleanly — nothing played.</span>
    <button on:click={() => (speakFailedWord = null)} aria-label="Dismiss">✕</button>
  </div>
{/if}

{#if showTtsVoiceNeeded}
  <div class="speak-voice-notice">
    <span>The Greek voice isn't downloaded yet — use the Read Aloud button above the chapter.</span>
    <button on:click={() => (showTtsVoiceNeeded = null)} aria-label="Dismiss">✕</button>
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
  .speak-voice-notice {
    position: fixed;
    left: 50%;
    bottom: 92px;
    transform: translateX(-50%);
    z-index: 1002;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(92vw, 460px);
    padding: 10px 12px;
    border-radius: 10px;
    background: #1c1c1c;
    border: 1px solid #3a3a3a;
    color: #e0e0e0;
    font-size: 13px;
    line-height: 1.35;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
  }

  .speak-voice-notice button {
    flex: none;
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 4px;
  }

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
    /* The Custom theme sets --reader-* on :root; every other theme leaves them
       unset and falls through to the original literals unchanged. */
    background: var(--reader-bg, #1a1a1a);
    color: var(--reader-text, #e0e0e0);
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

  /* Invisible shield over the text while the toast is up. Covers the full
     scroll height of .text-container, so it works wherever you are scrolled.
     Below .drag-handle-float (z-index 100) so the bumpers stay grabbable. */
  .toast-scrim {
    position: absolute;
    inset: 0;
    z-index: 50;
  }

  /* Extend arms the next tap to stretch the selection, so that one tap has to
     reach the word underneath. */
  .toast-scrim.pass-through {
    pointer-events: none;
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
    border-top: 2px solid var(--reader-rule, #444);
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
    color: var(--reader-text, #f0f0f0);
    text-shadow: -1.5px 1.5px 0 var(--title-shadow, transparent);
  }

  .chapter-section.flat-titles .chapter-header h1 {
    text-shadow: none;
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

  /* --reader-font-scale / --reader-lead-scale are the Custom theme's per-font
     normalisation (see lib/readerFonts.ts). They MULTIPLY the user's font-size
     and line-spacing sliders rather than replacing them, and default to 1, so
     every other theme is unaffected. */
  .verses {
    line-height: calc(var(--line-spacing, 1.8) * var(--reader-lead-scale, 1));
  }

  .verse {
    margin-bottom: 0;
    position: relative;
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1));
    line-height: calc(var(--line-spacing, 1.8) * var(--reader-lead-scale, 1));
    /* Vertical panning stays with the browser so the page still scrolls under
       a finger; sideways is ours, which is what lets a drag start selecting
       words without the first frames being eaten by a scroll. Once a drag
       commits, handleTouchMoveBlock preventDefaults and vertical stops too.
       This lives on .verse, not .verse-text: touch-action is ignored on
       non-replaced inline elements, and .verse-text is a <span>. */
    touch-action: pan-y;
  }

  /* Read Aloud: the verse currently being spoken. */
  .verse.tts-speaking {
    background: rgba(157, 122, 245, 0.12);
    box-shadow: inset 3px 0 0 rgba(157, 122, 245, 0.75);
    border-radius: 3px;
    transition: background 0.35s ease;
  }

  /* Read Aloud: soft cloud drifting along the words. Anchored to
     .text-container rather than the verse — in paragraph layout a verse is an
     inline box spanning several lines, which browsers do not position children
     against reliably. Prepended in the DOM so every verse paints over it, which
     keeps the text readable without needing z-index juggling. Positioned and
     sized each frame by lib/ttsGlow.ts. */
  .text-container :global(.tts-glow) {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    will-change: transform;
    border-radius: 50%;
    background: radial-gradient(
      ellipse at center,
      rgba(190, 165, 255, 0.5) 0%,
      rgba(170, 140, 250, 0.28) 45%,
      rgba(150, 120, 245, 0) 75%
    );
    filter: blur(7px);
  }

  .verse-number {
    display: inline-block;
    min-width: 0;
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) * 0.5);
    color: var(--verse-num-color, #888);
    vertical-align: super;
    margin-right: 0.1rem;
  }

  .verse-text {
    font-size: calc(var(--base-font-size, 1.125rem) * var(--reader-font-scale, 1));
    line-height: calc(var(--line-spacing, 1.8) * var(--reader-lead-scale, 1));
    cursor: text;
  }

  /* While a bumper is being dragged it sits directly under the finger, so
     hit-testing for the word beneath would return the bumper instead of text.
     The drag itself is driven by document-level listeners, so dropping pointer
     events here costs nothing. */
  .bible-reader.edge-dragging :global(.drag-handle-float) {
    pointer-events: none;
  }

  /* From pointer-down on a word until release: no OS magnifier, no callout
     menu, no blue letter handles competing with the word selection. */
  .bible-reader.drag-selecting,
  .bible-reader.drag-selecting .verse-text {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
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

  /* ── Custom theme typeface ───────────────────────────────────────────
     Gated on body.custom-font, which is only set when the user has actually
     picked a face. Without that gate this rule would still match on "match
     translation" and its higher specificity would flatten the per-translation
     fonts above back to inherit.

     Greek and Hebrew source texts are excluded: every picker font is a latin
     subset, so applying one to WLC or SBLGNT would render the chapter as
     tofu. translation-font-hebrew exists purely to carry that exclusion — it
     deliberately has no styling of its own, so tagging Hebrew texts with it
     changes nothing about how they render today. */
  :global(body.custom-font) .verses:not(.translation-font-greek):not(.translation-font-hebrew) .verse-text,
  :global(body.custom-font) .verses:not(.translation-font-greek):not(.translation-font-hebrew) .section-heading {
    font-family: var(--reader-font);
  }

  :global(body.custom-font) .chapter-header h1 {
    font-family: var(--reader-font);
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

  .art-icon {
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    margin: 0 2px;
    vertical-align: super;
    user-select: none;
    opacity: 0.9;
    transition: opacity 0.15s, transform 0.15s;
  }
  .art-icon:hover {
    opacity: 1;
    transform: scale(1.15);
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

  /* Place-name marker overlay (opt-in). A faint dotted underline that flags a
     multi-word place name as a single clickable unit. Inline decoration only —
     it reflows naturally and survives font-size / line-spacing changes. */
  :global(.verse-text .place-marker) {
    border-bottom: 1px dotted color-mix(in srgb, currentColor 45%, transparent);
  }

  /* ── Interlinear layered rendering ─────────────────────────────────
     Uses its OWN fixed line-height + em-relative sizes so the stacked
     columns never break when the user changes base font size or line
     spacing. flex-wrap means larger fonts wrap to more rows, never overlap. */
  :global(.verse-text.interlinear) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.2em 0.7em;
    line-height: 1.15;
  }
  :global(.verses.il-rtl .verse-text.interlinear) {
    direction: rtl;
  }
  :global(.verse-text.interlinear .il-word) {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    line-height: 1.15;
    cursor: pointer;
    padding: 0.05em 0.12em;
    border-radius: 5px;
    transition: background-color 0.12s ease;
  }
  :global(.verse-text.interlinear .il-word:hover) {
    background: rgba(125, 211, 252, 0.14);
  }
  :global(.verse-text.interlinear .il-orig) {
    font-size: 1em;
  }
  /* Defensive: interlinear only opens on Greek/Hebrew texts, which the Custom
     typeface rule already excludes — but a source-text pack whose id doesn't
     match getTranslationFontClass would slip through and render the original
     words as tofu. Scoped to body.custom-font so it cannot affect any other
     theme. */
  :global(body.custom-font .verse-text.interlinear .il-orig) {
    font-family: 'EB Garamond', Georgia, serif;
  }
  /* Non-original layers hidden by default; container classes opt them in. */
  :global(.verse-text.interlinear .il-gloss),
  :global(.verse-text.interlinear .il-translit),
  :global(.verse-text.interlinear .il-lemma),
  :global(.verse-text.interlinear .il-parse),
  :global(.verse-text.interlinear .il-strongs) {
    display: none;
    min-height: 1.05em;
    direction: ltr;
    unicode-bidi: isolate;
  }
  :global(.verses.il-show-gloss .verse-text.interlinear .il-gloss) {
    display: block;
    font-size: 0.6em;
    color: #9ec5ff;
  }
  :global(.verses.il-show-translit .verse-text.interlinear .il-translit) {
    display: block;
    font-size: 0.52em;
    font-style: italic;
    color: #bdbdbd;
  }
  :global(.verses.il-show-lemma .verse-text.interlinear .il-lemma) {
    display: block;
    font-size: 0.55em;
    color: #e3cd96;
  }
  :global(.verses.il-show-parse .verse-text.interlinear .il-parse) {
    display: block;
    font-size: 0.48em;
    color: #9aa0a6;
  }
  :global(.verses.il-show-strongs .verse-text.interlinear .il-strongs) {
    display: block;
    font-size: 0.48em;
    color: #93c69a;
  }
  /* Interlinear forces per-word block layout regardless of verse layout mode. */
  :global(.verses.interlinear-active .verse) {
    display: block !important;
    margin-bottom: 0.5em;
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
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) * 0.5);
    color: var(--verse-num-color, #888);
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

  /* ── Poetry ───────────────────────────────────────────────────────────────
     A verse that opens a poetic line is indented as a whole; breaks inside a
     verse come through as <br> from renderVerseHtml, with .poetry-indent
     carrying the second-level indent. The indent span holds no text, so verse
     character offsets — highlights, TTS glow — are unaffected. */
  .verse.poetry-1,
  .verse.poetry-2 {
    display: block;
    text-indent: -1.4em;
    padding-left: 1.4em;
  }

  .verse.poetry-2 {
    padding-left: 3em;
  }

  .verse.stanza-break {
    margin-top: 1em;
  }

  /* Poetry wins over paragraph flow: a poetic line is a line. */
  .verses.paragraph-layout .verse.poetry-1,
  .verses.paragraph-layout .verse.poetry-2,
  .verses.nonumber-layout .verse.poetry-1,
  .verses.nonumber-layout .verse.poetry-2 {
    display: block;
  }

  :global(.poetry-indent) {
    display: inline-block;
    width: 1.6em;
  }

  /* LXX marks a plural "you" with ⌃; shown as what it means, not a stray glyph */
  :global(.plural-marker) {
    color: var(--verse-num-color, #888);
    font-size: 0.65em;
    margin-left: 1px;
    cursor: help;
  }

  /* Increase font size for mobile devices */
  @media (max-width: 768px) {
    .verse-text {
      font-size: calc(var(--base-font-size, 1.4rem) * var(--reader-font-scale, 1));
      line-height: calc(var(--line-spacing, 2) * var(--reader-lead-scale, 1));
    }

    .chapter-header h1 {
      font-size: 2rem;
    }

    .verse-number {
      font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) * 0.5);
    }
  }

  /* Remove verse-level hover - we'll handle word-level in JS */
  .section-heading {
    font-weight: 600;
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 3px);
    color: var(--reader-text-dim, #d0d0d0);
    margin: 24px 0 12px 0;
    padding-top: 12px;
    border-top: 1px solid var(--reader-rule, #444);
    text-shadow: -1px 1px 0 var(--verse-num-color, transparent);
  }

  .chapter-section.flat-titles .section-heading {
    text-shadow: none;
  }

  .section-heading--s2 {
    font-weight: 500;
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 1px);
    color: var(--reader-text-dimmer, #a8a8a8);
    margin: 14px 0 6px 0;
    padding-top: 0;
    border-top: none;
  }

  /* Acrostic stanza labels (ALEPH, BETH… in Psalm 119) — a label, not a title */
  .section-heading--s3 {
    font-weight: 600;
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) - 3px);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--verse-num-color, #888);
    margin: 18px 0 4px 0;
    padding-top: 0;
    border-top: none;
    text-shadow: none;
  }

  /* KJV — larger headings to suit the blackletter aesthetic */
  .verses.translation-font-kjv .section-heading {
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 7px);
  }

  .verses.translation-font-kjv .section-heading--s2 {
    font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 5px);
  }

  @media (max-width: 768px) {
    .section-heading {
      font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 3px);
    }
    .section-heading--s2 {
      font-size: calc(var(--base-font-size, 18px) * var(--reader-font-scale, 1) + 1px);
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
    /* Keep the box tight to the glyphs: vertical padding on an inline element
       overflows the line box and bleeds into the lines above/below. */
    padding: 0 2px;
    margin: 0 -2px;
    /* The span sits under the cursor once created. Without this it becomes the
       mousemove target and the hover logic fights itself. */
    pointer-events: none;
    transition: background 0.15s ease;
    box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.4);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
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

  /* ── The "start here" mark ────────────────────────────────────────────────
     One recipe for the whole family. Reading plan passes its green (or brown,
     to close the day); every other link passes the target book's category
     colour. Shape, size, opacity and radius are identical in every case — hue
     is the only thing that varies, which is what makes them read as one
     feature rather than six.

     Position and band height are measured per verse in lib/verseHighlight.ts
     rather than declared here. The old rules pinned the gradient to `center`,
     which put it halfway down any verse that wrapped instead of on the first
     line where reading starts, and sized the band `1em + 7px`, which ignored
     the line-spacing setting entirely. Both are now taken from the real first
     line box, so every typeface, size and spacing lands right with no tuning. */
  :global(.vh-hl) {
    isolation: isolate;
    background-repeat: no-repeat;
    background-size: 30ch var(--vh-h, calc(1em + 7px));
    background-position: var(--vh-pos, 2em center);
    border-radius: 3px;
  }

  :global(.vh-hl.vh-ltr) {
    background-image: linear-gradient(to right, var(--vh-color, transparent), transparent);
  }

  /* A right-to-left verse begins at its right edge, so a left-to-right fade
     would put the strongest colour on the last word read and trail off over the
     first — backwards. The end-of-day bookmark is mirrored for the same reason:
     it marks where reading stops. */
  :global(.vh-hl.vh-rtl) {
    background-image: linear-gradient(to left, var(--vh-color, transparent), transparent);
  }

  /* Paragraph layouts make a verse `display: inline`, and a gradient background
     cannot be positioned on a multi-line inline box — the browser treats it as
     one unbroken run and slices it across lines, which is why the mark used to
     land somewhere arbitrary there. Those get this placed element instead, same
     gradient, sat behind the text. */
  :global(.vh-overlay) {
    position: absolute;
    width: 30ch;
    pointer-events: none;
    border-radius: 3px;
    z-index: -1;
  }

  :global(.vh-overlay.vh-ltr) {
    background-image: linear-gradient(to right, var(--vh-color, transparent), transparent);
  }

  :global(.vh-overlay.vh-rtl) {
    background-image: linear-gradient(to left, var(--vh-color, transparent), transparent);
  }

  /* Commentary anchor checkpoints — amber, half width, half opacity. Not a link
     navigation, so the category-colour rule does not reach it. */
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

  /* Painted whole-word selection. Replaces the browser's native selection so a
     selection can snap to word boundaries and span verses. No padding or
     margin: wrapping a word must never change layout, or the infinite-scroll
     height math drifts (same rule the repeats overlay follows). */
  :global(.sel-word-span) {
    background: rgba(102, 126, 234, 0.32);
    border-radius: 2px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
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
