<script lang="ts">
  import {
    navigationStore,
    availableTranslations,
    canGoBack,
    historyDepth,
    navTrail,
    pendingRestore,
    type CrumbKind,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS, normalizeBookName, CATEGORY_COLORS, CATEGORY_LABELS, translationLabel, shortBookName, getBookColor } from "../lib/bibleData";
  import { onMount, onDestroy, tick } from "svelte";
  import {
    searchService,
    type SearchCategory,
    type SearchResult,
  } from "../lib/services/searchService";
  import { buildSearchTree } from "../lib/searchTree";
  import { scrollBookItemToTop } from "../lib/bookPickerScroll";
  import { fixedOrigin } from "../lib/fixedOrigin";
  import SearchResultsTree from "./SearchResultsTree.svelte";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { navesModalStore } from "../stores/navesModalStore";
  import { isbeReturnStore } from "../stores/isbeReturnStore";
  import { get } from "svelte/store";
  import {
    searchQuery as searchQueryStore,
    triggerSearch,
  } from "../stores/searchStore";
  import PowerSearchModal from "./PowerSearchModal.svelte";
  import { profileModalStore } from "../stores/profileModalStore";
  import { readingPlanModalStore } from "../stores/readingPlanModalStore";
  import { paneStore } from "../stores/paneStore";
  import { userProfileStore } from "../stores/userProfileStore";
  import { continuousPlay } from "../stores/audioStore";
  import {
    readingState,
    readingPosition,
    readingVerseList,
    isReadingActive,
    isPreparing,
    togglePlayPause,
    stopReading,
    jumpToVerse,
  } from "../lib/tts/readingEngine";
  import BrandSpinner from "./BrandSpinner.svelte";
  import {
    sleepRemaining,
    stopAtChapterEnd,
    startSleepTimer,
    setStopAtChapterEnd,
    cancelSleepTimer,
    remainingMinutes,
  } from "../lib/tts/sleepTimer";
  import { COMMENTARY_AUTHORS } from "../lib/annotationConfig";
  import {
    ArrowLeft,
    ArrowsOutSimple,
    Books,
    ClockCounterClockwise,
    NotePencil,
    CaretDown,
    CaretUp,
    CaretRight,
    Graph,
    ChatText,
    MagnifyingGlass,
    Microscope,
    BookOpenText,
    Gear,
    User,
    X,
    Sun,
  } from "phosphor-svelte";
  import { openDailyGreeting } from "../stores/dailyGreetingStore";
  import { repeatsStore } from "../stores/repeatsStore";
  import { repeatCountsStore } from "../stores/repeatCountsStore";
  import { repeatHighlightAllRequest } from "../stores/repeatBulkStore";
  import type { RepeatHighlightScope } from "../stores/repeatBulkStore";
  import { REPEAT_COLORS } from "../lib/repeatColors";
  import { getInterlinearSettings, updateInterlinearSettings, getNavBarPinned, setNavBarPinned } from "../adapters/settings";
  import type { InterlinearSettings } from "../adapters/settings";
  import InterlinearControls from "./InterlinearControls.svelte";

  export let windowId: string | undefined = undefined;
  export const visible: boolean = true;
  export let style: string = "";

  /* The reference dropdown is two side-by-side columns, OT then NT. Splitting the
     list here (rather than flowing one list into CSS columns) keeps each column
     reading straight top-to-bottom, so a book is where you expect it. */
  const REFERENCE_COLUMNS = [
    { testament: "ot", label: "Old Testament", books: BIBLE_BOOKS.filter((b) => b.testament === "OT") },
    { testament: "nt", label: "New Testament", books: BIBLE_BOOKS.filter((b) => b.testament === "NT") },
  ];

  let translationDropdownOpen = false;
  let referenceDropdownOpen = false;
  let commDropdownOpen = false;
  let expandedBooks = new Set<string>();
  /** Expand state for the whole results tree, keyed by node path. */
  let expandedSearchNodes = new Set<string>();
  let searchQuery = "";
  let searchFocused = false;
  let blurTimeout: number | undefined;
  let searchResults: SearchCategory[] = [];
  let showResults = false;
  let isSearching = false;
  let totalResultCount = 0;
  let displayedResultCount = 0;
  let showingAll = false;
  let showPowerSearchModal = false;
  let searchExpanded = false;
  let searchResultsEl: HTMLDivElement | null = null;

  // Refs for dropdown positioning
  let navElement: HTMLElement;
  let translationButtonRef: HTMLElement;
  let referenceButtonRef: HTMLElement;
  let commButtonRef: HTMLElement;
  let searchContainerRef: HTMLElement;

  // Whether the dropdown has been positioned Ã¢â‚¬â€ controls visibility (hidden until JS places it)
  let translationDropdownPositioned = false;
  let referenceDropdownPositioned = false;
  let commDropdownPositioned = false;

  // Repeat pills dropdown state
  let repeatDropdownWord: string | null = null; // which pill's dropdown is open
  let repeatDropdownView: 'main' | 'scope' = 'main';
  let repeatDropdownPositioned = false;
  let repeatPillButtonRef: HTMLElement | null = null;

  // ── Interlinear (Greek/Hebrew) ─────────────────────────────────────────────
  let interlinearSettings: InterlinearSettings = getInterlinearSettings();
  let interlinearMenuOpen = false;
  let interlinearGearRef: HTMLElement;
  let ilPopTop = 0;
  let ilPopLeft = 0;

  function isOriginalLanguage(translationId: string): boolean {
    const id = (translationId || "").toLowerCase();
    return id === "wlc" || id === "lxx" || id === "byz" || id === "tr" ||
           id === "sblgnt" || id === "hebrew-oshb";
  }

  function toggleInterlinear() {
    const enabled = !interlinearSettings.enabled;
    interlinearSettings = { ...interlinearSettings, enabled };
    updateInterlinearSettings({ enabled });
    window.dispatchEvent(new CustomEvent("settingsUpdated"));
  }

  async function toggleInterlinearMenu(event: MouseEvent) {
    event.stopPropagation();
    if (interlinearMenuOpen) {
      interlinearMenuOpen = false;
      return;
    }
    interlinearMenuOpen = true;
    await tick();
    const rect = interlinearGearRef?.getBoundingClientRect();
    if (rect) {
      const width = 300;
      // The popover is `position: fixed`, which here resolves against the
      // viewport in dark but against `.main-content` in light/sepia — so clamp
      // within that box and rebase onto it. See lib/fixedOrigin.ts.
      const origin = fixedOrigin(interlinearGearRef);
      const maxLeft = origin.left + origin.width - width - 8;
      const minLeft = origin.left + 8;
      ilPopLeft = Math.max(minLeft, Math.min(rect.left, maxLeft)) - origin.left;
      ilPopTop = rect.bottom + 6 - origin.top;
    }
  }

  // InterlinearControls persists + dispatches settingsUpdated itself; just keep
  // the local copy fresh so the toggle button reflects any layer changes.
  function handleInterlinearSettingsChange() {
    interlinearSettings = getInterlinearSettings();
  }

  function onSettingsUpdated() {
    interlinearSettings = getInterlinearSettings();
  }

  // Scroll nav-content instantly so the button is visible before we measure its position
  function scrollToShowButton(buttonRef: HTMLElement): void {
    const navContent = (navElement?.querySelector('.nav-content') ?? document.querySelector('.nav-content')) as HTMLElement;
    if (!navContent || !buttonRef) return;
    const navContentRect = navContent.getBoundingClientRect();
    const buttonRect = buttonRef.getBoundingClientRect();
    const buttonOffsetFromNavLeft = buttonRect.left - navContentRect.left;
    const targetScroll = navContent.scrollLeft + buttonOffsetFromNavLeft - 12;
    // Direct assignment = instant, no animation, no polling needed
    navContent.scrollLeft = Math.max(0, targetScroll);
  }

  /**
   * Same nudge, but centred rather than left-aligned.
   *
   * Both rects come from inside the same transformed ancestor (the bar slides
   * up and down), so their difference is unaffected by that transform — and
   * working in scrollLeft never disturbs the page scrolling behind.
   */
  function scrollToCenter(el: HTMLElement): void {
    const navContent = (navElement?.querySelector('.nav-content') ?? document.querySelector('.nav-content')) as HTMLElement;
    if (!navContent || !el) return;
    const navContentRect = navContent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offsetFromNavLeft = elRect.left - navContentRect.left;
    const centringGap = (navContent.clientWidth - elRect.width) / 2;
    const targetScroll = navContent.scrollLeft + offsetFromNavLeft - centringGap;
    navContent.scrollLeft = Math.max(0, targetScroll);
  }

  // Listen for external search triggers
  $: if ($triggerSearch > 0) {
    searchQuery = $searchQueryStore;
    searchExpanded = true;
    performSearch();
  }

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  // Minimal mode: window panes show only translation, ref, ref-toggle, and comm
  $: isMinimal = !!windowId;
  // When windowId is set: use per-window contentState; never fall back to global nav
  $: currentTranslation = windowId
    ? (windowState?.contentState?.translation ?? 'WEB')
    : $navigationStore.translation;
  $: currentBook = windowId
    ? (windowState?.contentState?.book ?? 'Genesis')
    : $navigationStore.book;
  $: currentChapter = windowId
    ? (windowState?.contentState?.chapter ?? 1)
    : $navigationStore.chapter;
  $: currentReference = `${currentBook} ${currentChapter}`;
  $: isSignedIn = $userProfileStore.isSignedIn;
  // Per-window commentary authors
  $: currentCommAuthors = windowId
    ? (windowState?.contentState?.selectedCommentaryAuthors ?? [])
    : ($navigationStore.selectedCommentaryAuthors ?? []);
  $: currentShowReferences = windowId
    ? (windowState?.contentState?.showReferences ?? false)
    : ($navigationStore.showReferences ?? false);
  $: currentBookCategory = BIBLE_BOOKS.find(b => b.name === currentBook)?.category || '';

  function toggleCommAuthor(author: string) {
    if (windowId) {
      const current = windowState?.contentState?.selectedCommentaryAuthors ?? [];
      const next = current.includes(author)
        ? current.filter((a: string) => a !== author)
        : [...current, author];
      windowStore.updateContentState(windowId, { selectedCommentaryAuthors: next });
    } else {
      const current = $navigationStore.selectedCommentaryAuthors ?? [];
      const next = current.includes(author)
        ? current.filter((a: string) => a !== author)
        : [...current, author];
      navigationStore.setSelectedCommentaryAuthors(next);
    }
  }

  async function toggleCommDropdown(event: MouseEvent) {
    event.stopPropagation();
    const opening = !commDropdownOpen;

    if (!opening) {
      commDropdownOpen = false;
      commDropdownPositioned = false;
      return;
    }

    referenceDropdownOpen = false;
    referenceDropdownPositioned = false;
    translationDropdownOpen = false;
    translationDropdownPositioned = false;

    commDropdownOpen = true;
    await tick();

    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.comm-dropdown') as HTMLElement;
      if (dropdown && commButtonRef) {
        const navRect = navElement?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth };
        const rect = commButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - navRect.left;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, (navElement?.offsetWidth ?? window.innerWidth) - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        commDropdownPositioned = true;
      }
    });
  }

  async function toggleTranslationDropdown(event: MouseEvent) {
    event.stopPropagation();
    const opening = !translationDropdownOpen;

    if (!opening) {
      translationDropdownOpen = false;
      translationDropdownPositioned = false;
      return;
    }

    referenceDropdownOpen = false;
    referenceDropdownPositioned = false;
    commDropdownOpen = false;
    commDropdownPositioned = false;

    // Scroll nav instantly so button position is correct before we measure
    scrollToShowButton(translationButtonRef);
    translationDropdownOpen = true;
    await tick(); // let Svelte render the dropdown element

    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.translation-dropdown') as HTMLElement;
      if (dropdown && translationButtonRef) {
        const navRect = navElement?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth };
        const rect = translationButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - navRect.left;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, (navElement?.offsetWidth ?? window.innerWidth) - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        dropdown.style.width = `${Math.max(rect.width, 200)}px`;
        translationDropdownPositioned = true; // reveal now that it's placed
      }
    });
  }

  async function toggleReferenceDropdown(event: MouseEvent) {
    event.stopPropagation();
    const opening = !referenceDropdownOpen;

    if (!opening) {
      referenceDropdownOpen = false;
      referenceDropdownPositioned = false;
      return;
    }

    translationDropdownOpen = false;
    translationDropdownPositioned = false;
    commDropdownOpen = false;
    commDropdownPositioned = false;

    if (currentBook && !expandedBooks.has(currentBook)) {
      expandedBooks = new Set([currentBook]);
    }

    // Scroll nav instantly so button position is correct before we measure
    scrollToShowButton(referenceButtonRef);
    referenceDropdownOpen = true;
    await tick(); // let Svelte render the dropdown element

    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.reference-dropdown') as HTMLElement;
      if (dropdown && referenceButtonRef) {
        // Clear any inline width that may have been stamped by updateDropdownPositions
        // firing during the async tick (e.g. triggered by the nav-scroll macrotask).
        // Without this, offsetWidth reads the stale 250px override instead of fit-content.
        dropdown.style.removeProperty('width');
        const navRect = navElement?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth };
        const rect = referenceButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - navRect.left;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, (navElement?.offsetWidth ?? window.innerWidth) - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        referenceDropdownPositioned = true; // reveal now that it's placed

        // Scroll the list to the current book
        if (currentBook) {
          requestAnimationFrame(() => {
            const currentBookItem = dropdown.querySelector('.book-item .book-button.current')?.closest('.book-item') as HTMLElement;
            if (currentBookItem) {
              scrollBookItemToTop(dropdown, currentBookItem);
            }
          });
        }
      }
    });
  }

  function selectTranslation(translation: string) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        translation,
        highlightedVerse: null,
      });
    } else {
      navigationStore.setTranslation(translation);
    }
    translationDropdownOpen = false;
  }

  function toggleBook(bookName: string, event?: MouseEvent) {
    const isExpanding = !expandedBooks.has(bookName);
    expandedBooks = isExpanding ? new Set([bookName]) : new Set();
    
    // Auto-scroll to show the expanded book at the top of visible area
    if (isExpanding && event) {
      requestAnimationFrame(() => {
        const dropdown = document.querySelector('.reference-dropdown') as HTMLElement;
        const bookButton = event.target as HTMLElement;
        const bookItem = bookButton?.closest('.book-item') as HTMLElement;
        
        if (dropdown && bookItem) {
          scrollBookItemToTop(dropdown, bookItem);
        }
      });
    }
  }

  function selectChapter(bookName: string, chapter: number) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        translation: currentTranslation,
        book: bookName,
        chapter,
        highlightedVerse: null,
      });
    } else {
      // No mark, and no trail: picking a chapter off the dropdown is not a step
      // away from anywhere, it is choosing a new home. Keeping the old crumbs
      // would leave the bar claiming you were still mid-journey somewhere else.
      navigationStore.clearHistory();
      navigationStore.navigateTo(currentTranslation, bookName, chapter);
    }
    referenceDropdownOpen = false;
    expandedBooks = new Set();
  }

  function closeDropdowns(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // Something inside a dropdown that re-renders on click destroys the element
    // you clicked before this runs, and a detached node reports no ancestors —
    // so every check below would pass and close the very panel the click landed
    // in. It can't be asked where it was, so leave the dropdowns alone.
    if (!target?.isConnected) return;
    if (
      !target.closest(".nav-pill") &&
      !target.closest(".dropdown-menu") &&
      !target.closest(".pill-search-area") &&
      !target.closest(".search-results-dropdown") &&
      !target.closest(".nav-repeat-pills") &&
      !target.closest(".repeat-dropdown")
    ) {
      translationDropdownOpen = false;
      referenceDropdownOpen = false;
      commDropdownOpen = false;
      translationDropdownPositioned = false;
      referenceDropdownPositioned = false;
      commDropdownPositioned = false;
      closeRepeatDropdown();
      showResults = false;
    }
  }

  // ── Repeat pills ───────────────────────────────────────────────────────────

  function closeRepeatDropdown() {
    repeatDropdownWord = null;
    repeatDropdownView = 'main';
    repeatDropdownPositioned = false;
    repeatPillButtonRef = null;
  }

  async function toggleRepeatPill(event: MouseEvent, word: string) {
    event.stopPropagation();
    if (repeatDropdownWord === word) {
      closeRepeatDropdown();
      return;
    }
    // Close other dropdowns
    translationDropdownOpen = false;
    referenceDropdownOpen = false;
    commDropdownOpen = false;

    repeatPillButtonRef = event.currentTarget as HTMLElement;
    repeatDropdownView = 'main';
    repeatDropdownWord = word;
    await tick();
    positionRepeatDropdown();
  }

  function positionRepeatDropdown() {
    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.repeat-dropdown') as HTMLElement;
      if (dropdown && repeatPillButtonRef) {
        const navRect = navElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
        const rect = repeatPillButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - navRect.left;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, (navElement?.offsetWidth ?? window.innerWidth) - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        repeatDropdownPositioned = true;
      }
    });
  }

  function deselectRepeat(word: string) {
    repeatsStore.remove(word);
    closeRepeatDropdown();
  }

  function selectRepeatScope(scope: RepeatHighlightScope) {
    const group = $repeatsStore.find((g) => g.word === repeatDropdownWord);
    if (group) {
      repeatHighlightAllRequest.set({
        word: group.word,
        label: group.label,
        scope,
        colorIndex: group.colorIndex,
      });
    }
    closeRepeatDropdown();
  }

  function handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;

    if (!searchQuery.trim()) {
      searchResults = [];
      showResults = false;
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && searchQuery.trim()) {
      performSearch();
    } else if (event.key === "Escape") {
      showResults = false;
      if (!searchQuery.trim()) {
        searchExpanded = false;
      }
    }
  }

  async function performSearch(loadAll: boolean = false) {
    if (!searchQuery.trim()) {
      searchResults = [];
      showResults = false;
      return;
    }

    isSearching = true;
    try {
      const limit = loadAll ? -1 : 250;
      // Explicit search, so the expensive categories (commentaries) run too.
      searchResults = await searchService.search(searchQuery, { limit, deep: true });

      // Get total count
      totalResultCount = await searchService.getTotalCount(searchQuery);

      // Calculate displayed count from all categories
      displayedResultCount = searchResults.reduce(
        (sum, category) => sum + category.count,
        0,
      );
      // "Load all" only applies to Bible results — that's the count that gets capped.
      const bibleCount = searchResults.find((c) => c.key === "bible")?.count ?? 0;
      showingAll = loadAll || bibleCount >= totalResultCount;

      // Open the Bible group by default so the common case is one click closer.
      expandedSearchNodes = new Set(bibleCount > 0 ? ["bible"] : []);

      showResults = true;

      // Auto-scroll to show the search container
      if (searchContainerRef) {
        scrollToShowButton(searchContainerRef);
      }

      // Position search results dropdown
      if (searchContainerRef) {
        requestAnimationFrame(() => {
          const dropdown = document.querySelector(
            ".search-results-dropdown",
          ) as HTMLElement;
          if (dropdown) {
            // This used to subtract `.main-content`'s left unconditionally, which
            // is only right when that element is the containing block — true in
            // light/sepia, false in dark, where it pushed the dropdown off by the
            // width of any left-docked window. Ask what the box really is, and
            // correct `top` by it as well. See lib/fixedOrigin.ts.
            const origin = fixedOrigin(dropdown);
            const rect = searchContainerRef.getBoundingClientRect();
            dropdown.style.left = `${rect.left - origin.left}px`;
            dropdown.style.top = `${rect.bottom + 4 - origin.top}px`;
            dropdown.style.width = `${Math.min(rect.width, origin.width - 20)}px`;
          }
        });
      }
    } catch (error) {
      console.error("Search error:", error);
      searchResults = [];
      totalResultCount = 0;
      displayedResultCount = 0;
    } finally {
      isSearching = false;
    }
  }

  async function loadAllResults() {
    const message =
      totalResultCount > 10000
        ? `Load all ${totalResultCount.toLocaleString()} results? This could take a while and create a very long list to scroll through.`
        : `Load all ${totalResultCount.toLocaleString()} results?`;

    if (confirm(message)) {
      await performSearch(true);
    }
  }

  /**
   * Back arrow. Restores the reading position, and if the user got here by
   * tapping a reference in the ISBE modal, brings that modal back too — same
   * tab, same sections open, same scroll spot — so they can work down the list.
   * The breadcrumb is only honored when this press is undoing the very step
   * that left it; if they've navigated on since, reopening would be a surprise.
   */
  /**
   * The icon on a crumb — how you left that spot, and so what comes back if you
   * tap it. Reuses icons already in this bar rather than introducing a new set.
   */
  const CRUMB_ICONS: Record<CrumbKind, typeof Graph> = {
    commentary: ChatText,
    crossref: Graph,
    search: MagnifyingGlass,
    library: Books,
    notes: NotePencil,
    history: ClockCounterClockwise,
    plan: BookOpenText,
    link: Graph,
  };

  /** "Ps 23:4" — abbreviated so a deep trail still fits on a phone. */
  function crumbLabel(c: { book: string; chapter: number; verse: number | null }): string {
    const ref = `${shortBookName(c.book)} ${c.chapter}`;
    return c.verse != null ? `${ref}:${c.verse}` : ref;
  }

  /**
   * Walk back to a step in the trail. Depth is 1-based, so crumb 1 is the first
   * hop away from home — tapping it puts you all the way back.
   */
  function goToCrumb(depth: number) {
    const ret = get(isbeReturnStore);
    // Checked before the pop, like goBack: a crumb at position N undoes the
    // step that was recorded at depth N. Reading the depth afterwards would
    // always be one short and never match.
    const undoingTheJump = !!ret && depth === ret.depth;
    navigationStore.goToDepth(depth);
    if (undoingTheJump) isbeModalStore.open(ret!.modal);
    else if (ret && get(historyDepth) < ret.depth) isbeReturnStore.set(null);
  }

  /** Mirror of the reader's old split-view button, now that the bar is gone. */
  function openSplitView() {
    const edge = window.innerWidth > window.innerHeight ? "right" : "bottom";
    const id = windowStore.createWindow(edge, 50);
    if (id) {
      windowStore.setWindowContent(id, "bible", {
        translation: currentTranslation,
        book: $navigationStore.book,
        chapter: $navigationStore.chapter,
      });
    }
  }

  function goBack() {
    const ret = get(isbeReturnStore);
    const undoingTheJump = !!ret && get(historyDepth) === ret.depth;

    navigationStore.goBack();

    if (undoingTheJump) {
      // Left set for the modal to consume — it restores the rest of the context.
      isbeModalStore.open(ret!.modal);
    } else if (ret && get(historyDepth) < ret.depth) {
      // Past it without ever landing on it — the context can't come back.
      // Deeper than it is fine: keep walking back and we'll reach it.
      isbeReturnStore.set(null);
    }
  }

  /** Jump the reader (or the owning window) to a book/chapter/verse. */
  function navigateToResult(book: string, chapter: number, verse: number | null, translation?: string) {
    const target = translation || currentTranslation;
    if (windowId) {
      windowStore.updateContentState(windowId, {
        translation: target,
        book,
        chapter,
        highlightedVerse: verse,
      });
    } else {
      // Leave a crumb before moving, carrying the search itself. Search used to
      // navigate without one, so following a result stranded you with no way
      // back — and the query, results and expansion were wiped on the way out,
      // so there was nothing left to come back to even if there had been.
      navigationStore.pushHistory(get(navigationStore), 'search', snapshotSearch());
      navigationStore.navigateTo(target, book, chapter, verse);
    }
  }

  /** Everything needed to put this search back the way it was. */
  interface SearchOrigin {
    surface: 'search';
    query: string;
    results: SearchCategory[];
    expanded: string[];
    total: number;
    displayed: number;
    showingAll: boolean;
    expandedUi: boolean;
    scrollTop: number;
  }

  function snapshotSearch(): SearchOrigin {
    return {
      surface: 'search',
      query: searchQuery,
      results: searchResults,
      expanded: [...expandedSearchNodes],
      total: totalResultCount,
      displayed: displayedResultCount,
      showingAll,
      expandedUi: searchExpanded,
      scrollTop: searchResultsEl?.scrollTop ?? 0,
    };
  }

  async function restoreSearch(origin: SearchOrigin) {
    searchQuery = origin.query;
    searchResults = origin.results;
    expandedSearchNodes = new Set(origin.expanded);
    totalResultCount = origin.total;
    displayedResultCount = origin.displayed;
    showingAll = origin.showingAll;
    searchExpanded = origin.expandedUi;
    showResults = true;
    // Two ticks: the first mounts the dropdown, the second lets the result rows
    // lay out. Setting scrollTop before the list has height would land at 0.
    await tick();
    await tick();
    if (searchResultsEl) searchResultsEl.scrollTop = origin.scrollTop;
  }

  $: {
    const pending = $pendingRestore as { surface?: string } | null;
    if (!windowId && pending?.surface === 'search') {
      pendingRestore.set(null);
      void restoreSearch(pending as SearchOrigin);
    }
  }

  async function handleResultClick(result: SearchResult) {
    if (!result.data) return;

    if (result.type === "character") {
      // Reuse the reader's character view rather than building a second one.
      const { lookupPerson } = await import("../adapters/lexicon-lookup.js");
      const characterData = await lookupPerson(result.data.name);
      if (characterData) {
        lexicalModalStore.open({
          characterData,
          selectedText: result.data.name,
          strongsId: undefined,
          morphologyData: null,
          lexicalEntries: null,
        });
      }
    } else if (result.type === "encyclopedia") {
      // Encyclopedia hits carry no reference, so they'd fall through the
      // book/chapter branch below and the tap would do nothing at all.
      isbeModalStore.open({
        kind: result.data.isPlace ? "place" : "entry",
        entryId: result.data.entryId,
        placeId: null,
        primaryName: result.data.primaryName,
      });
    } else if (result.type === "topical") {
      // Topics carry no reference either — same reason as the encyclopedia.
      navesModalStore.open({
        topicId: result.data.topicId,
        primaryName: result.data.primaryName,
      });
    } else if (result.type === "journal") {
      // Journal opens in a docked window, same as from the journal calendar.
      const edge = window.innerHeight > window.innerWidth ? "bottom" : "right";
      const journalWindowId = windowStore.createWindow(edge, 50);
      if (journalWindowId) {
        windowStore.setWindowContent(journalWindowId, "journal", {
          date: result.data.date,
        });
      }
    } else {
      // Verses, Strong's hits, notes and commentary all resolve to a reference.
      const { book, chapter } = result.data;
      if (!book) return;
      navigateToResult(
        book,
        chapter,
        result.data.verse ?? null,
        // Strong's hits carry their own original-language translation; the rest
        // should open in whatever the reader is already showing.
        result.type === "strongs" ? result.data.translation : undefined,
      );
    }

    // Close search results
    showResults = false;
    searchQuery = "";
    searchResults = [];
  }

  function highlightText(text: string, query: string): string {
    if (!query || !text) return text;

    const terms = query.toLowerCase().trim().split(/\s+/);
    let highlighted = text;

    terms.forEach((term) => {
      if (term.length < 2) return; // Skip very short terms

      // Create a case-insensitive regex to find the term
      const regex = new RegExp(`(${term})`, "gi");
      highlighted = highlighted.replace(regex, "<mark>$1</mark>");
    });

    return highlighted;
  }

  function toggleSearchNode(key: string) {
    const next = new Set(expandedSearchNodes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedSearchNodes = next;
  }

  $: searchTree = buildSearchTree(searchResults);

  function clearSearch() {
    searchQuery = "";
    searchResults = [];
    showResults = false;
    searchExpanded = false;
  }

  async function expandSearch() {
    searchExpanded = true;
    await tick();
    const input = searchContainerRef?.querySelector('.search-input') as HTMLInputElement;
    input?.focus();
  }

  function handleSearchFocus() {
    if (blurTimeout) {
      clearTimeout(blurTimeout);
    }
    searchFocused = true;
  }

  function handleSearchBlur() {
    blurTimeout = window.setTimeout(() => {
      searchFocused = false;
      if (!searchQuery.trim() && !showResults) {
        searchExpanded = false;
      }
    }, 150);
  }

  function openSettings() {
    paneStore.openPane("settings", "right");
  }

  function updateDropdownPositions() {
    const navRect = navElement?.getBoundingClientRect() ?? { left: 0, top: 0, right: window.innerWidth };
    const navWidth = navElement?.offsetWidth ?? window.innerWidth;

    if (translationDropdownOpen) {
      const dropdown = document.querySelector(
        ".translation-dropdown",
      ) as HTMLElement;
      if (dropdown && translationButtonRef) {
        const rect = translationButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - navRect.left}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        dropdown.style.width = `${Math.max(rect.width, 200)}px`;
      }
    }
    if (referenceDropdownOpen && referenceDropdownPositioned) {
      const dropdown = document.querySelector(
        ".reference-dropdown",
      ) as HTMLElement;
      if (dropdown && referenceButtonRef) {
        const rect = referenceButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - navRect.left}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
      }
    }
    if (commDropdownOpen && commDropdownPositioned) {
      const dropdown = document.querySelector('.comm-dropdown') as HTMLElement;
      if (dropdown && commButtonRef) {
        const rect = commButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - navRect.left;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, navWidth - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
      }
    }
    if (showResults) {
      const dropdown = document.querySelector(
        ".search-results-dropdown",
      ) as HTMLElement;
      if (dropdown && searchContainerRef) {
        const rect = searchContainerRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - navRect.left}px`;
        dropdown.style.top = `${rect.bottom - navRect.top + 4}px`;
        dropdown.style.width = `${Math.min(rect.width, window.innerWidth - 20)}px`;
      }
    }
  }

  // ── The bar's contoured underside ──────────────────────────────────────────
  // The bottom edge is not a straight line. It is a membrane: it drapes to full
  // depth over each pill group and relaxes up across the open space between
  // them, so the empty middle reads as a bite taken out of the plank rather
  // than as solid chrome. When something arrives in the middle — read-aloud,
  // repeats, an expanded search — it pushes the membrane back down.
  //
  // Two things here are deliberately different curves. DEPTH, how far a gap
  // relaxes, is linear in that gap's width; a smoothstep is far too flat at the
  // low end and leaves narrow gaps with an invisible sub-pixel dip. SHAPE, the
  // shoulder either side of a gap, is the smoothstep, and that is what keeps
  // the edge off a square wave.
  //
  // Numbers came out of nav-contour-lab.html. `height` is the SVG's own height
  // only — the bar's own box is deliberately left alone.
  const CONTOUR = {
    restPct: 0.17,
    padX: 1.5,
    padY: 4,
    shoulderMax: 54,
    dimpleStart: 14,
    fullRelax: 68,
    corner: 13,
    height: 51,
    shadowY: 8,
    shadowBlur: 4.5,
    shadowOpacity: 0.66,
    tween: 0.28,
    samples: 260,
  };

  // Every group is separated by a .nav-spacer (min-width 27px) plus the strip's
  // 8px gap either side, so the narrowest gap between two of these is 43px —
  // and because the pills never shrink, that floor holds however crowded the
  // bar gets. It scrolls sideways instead of compressing.
  const GROUP_SELECTOR =
    ".nav-pill, .nav-interlinear, .nav-tts, .nav-repeat-pills";

  let navContentEl: HTMLElement;
  let membraneFill = "";
  let membraneEdge = "";
  let membraneW = 0;

  let field: number[] | null = null; // the y values actually drawn
  let targetField: number[] = [];
  let sampleXs: number[] = [];
  let membraneRaf = 0;
  let membraneLastT = 0;
  let membranePending = 0;
  let membranePendingAnimate = false;
  // Long enough to outlast the pill and spacer width transitions.
  const MEMBRANE_SETTLE_MS = 400;
  let membraneSettleUntil = 0;
  let membraneResizeObs: ResizeObserver | undefined;
  let membraneMutationObs: MutationObserver | undefined;

  function smoothstep(t: number): number {
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
  }

  /** Live group rects in the bar's own space, merged only on real overlap. */
  function measureGroups(): { spans: number[][]; hFull: number } {
    if (!navContentEl || !navElement)
      return { spans: [], hFull: CONTOUR.height };

    const barRect = navElement.getBoundingClientRect();
    const spans: number[][] = [];
    let deepest = 0;

    for (const el of navContentEl.querySelectorAll<HTMLElement>(
      GROUP_SELECTOR,
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      spans.push([r.left - barRect.left, r.right - barRect.left]);
      deepest = Math.max(deepest, r.bottom - barRect.top);
    }
    if (!spans.length) return { spans: [], hFull: CONTOUR.height };

    // Padding is applied later, so a tight gap survives as a crevice here
    // rather than being swallowed by this merge.
    spans.sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [[spans[0][0], spans[0][1]]];
    for (let i = 1; i < spans.length; i++) {
      const last = merged[merged.length - 1];
      if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
      else merged.push([spans[i][0], spans[i][1]]);
    }

    return {
      spans: merged,
      hFull: Math.min(CONTOUR.height, deepest + CONTOUR.padY),
    };
  }

  /** Build y(x) for the bottom edge. */
  function makeSampler(
    spans: number[][],
    W: number,
    hFull: number,
  ): (x: number) => number {
    const hRest = hFull * CONTOUR.restPct;
    const padded = spans.map((s) => [s[0] - CONTOUR.padX, s[1] + CONTOUR.padX]);

    // The plank still has ends: wrap around the outermost sides rather than
    // relaxing into the screen edge.
    padded[0][0] = 0;
    padded[padded.length - 1][1] = W;

    const gaps: {
      crevice: boolean;
      a: number;
      b: number;
      m: number;
      s: number;
      yDip: number;
    }[] = [];

    for (let i = 0; i < spans.length - 1; i++) {
      const rawW = spans[i + 1][0] - spans[i][1];
      if (rawW <= 0) continue;

      const range = Math.max(1, CONTOUR.fullRelax - CONTOUR.dimpleStart);
      const relax = Math.max(
        0,
        Math.min(1, (rawW - CONTOUR.dimpleStart) / range),
      );
      const yDip = hFull - relax * (hFull - hRest);

      const a = padded[i][1];
      const b = padded[i + 1][0];

      if (b - a > 1) {
        gaps.push({
          crevice: false,
          a,
          b,
          m: 0,
          s: Math.min(CONTOUR.shoulderMax, (b - a) / 2),
          yDip,
        });
      } else {
        // No room between the padded pills, so this dip's shoulders run
        // underneath them. That is safe: the pills are opaque and paint above
        // the membrane, so only the stretch spanning the real gap is ever seen.
        gaps.push({
          crevice: true,
          a,
          b,
          m: (spans[i][1] + spans[i + 1][0]) / 2,
          s: Math.max(2, CONTOUR.shoulderMax),
          yDip,
        });
      }
    }

    // Overlapping influences combine by taking the deepest rise, never by
    // summing — two neighbouring dips must not dig a trench between them.
    return (x: number): number => {
      let y = hFull;
      for (const g of gaps) {
        let inf: number;
        if (g.crevice) {
          const d = Math.abs(x - g.m);
          if (d >= g.s) continue;
          inf = smoothstep(1 - d / g.s);
        } else {
          if (x <= g.a || x >= g.b) continue;
          if (g.s <= 0) inf = 1;
          else if (x < g.a + g.s) inf = smoothstep((x - g.a) / g.s);
          else if (x > g.b - g.s) inf = smoothstep((g.b - x) / g.s);
          else inf = 1;
        }
        const yg = hFull + (g.yDip - hFull) * inf;
        if (yg < y) y = yg;
      }
      return y;
    };
  }

  /** Catmull-Rom through the samples, emitted as cubic Béziers. */
  function bottomTail(xs: number[], ys: number[]): string {
    let d = "";
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i - 1] ?? xs[i];
      const y0 = ys[i - 1] ?? ys[i];
      const x1 = xs[i];
      const y1 = ys[i];
      const x2 = xs[i + 1];
      const y2 = ys[i + 1];
      const x3 = xs[i + 2] ?? xs[i + 1];
      const y3 = ys[i + 2] ?? ys[i + 1];
      const c1x = x1 + (x2 - x0) / 6;
      const c1y = y1 + (y2 - y0) / 6;
      const c2x = x2 - (x3 - x1) / 6;
      const c2y = y2 - (y3 - y1) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }
    return d;
  }

  function drawMembrane(): void {
    if (!field || !sampleXs.length) return;

    const W = membraneW;
    const r = Math.min(CONTOUR.corner, W / 2);
    const yL = field[0];
    const yR = field[field.length - 1];

    const edge =
      `M 0 ${(yL - r).toFixed(2)}` +
      ` Q 0 ${yL.toFixed(2)} ${r.toFixed(2)} ${yL.toFixed(2)}` +
      bottomTail(sampleXs, field) +
      ` Q ${W} ${yR.toFixed(2)} ${W} ${(yR - r).toFixed(2)}`;

    membraneEdge = edge;
    membraneFill = `${edge} L ${W} 0 L 0 0 Z`;
  }

  /** Read the live geometry and turn it into a fresh set of sample heights. */
  function computeTarget(): number[] | null {
    if (!navElement) return null;
    const W = navElement.clientWidth;
    if (!W) return null;

    const { spans, hFull } = measureGroups();
    if (!spans.length) return null;

    const n = CONTOUR.samples;
    const r = Math.min(CONTOUR.corner, W / 2);
    const sample = makeSampler(spans, W, hFull);

    membraneW = W;
    sampleXs = new Array(n);
    for (let i = 0; i < n; i++) sampleXs[i] = r + ((W - 2 * r) * i) / (n - 1);

    return sampleXs.map(sample);
  }

  function retargetMembrane(animate: boolean): void {
    const next = computeTarget();
    if (!next) return;

    // Tween the samples, never the path string: two paths with different
    // segment counts cannot be interpolated.
    if (!field || field.length !== next.length || !animate) {
      field = next;
      targetField = next;
      drawMembrane();
      return;
    }
    targetField = next;
    if (!membraneRaf) {
      membraneLastT = performance.now();
      membraneRaf = requestAnimationFrame(stepMembrane);
    }
  }

  function stepMembrane(now: number): void {
    if (!field) {
      membraneRaf = 0;
      return;
    }
    const dt = Math.min(64, now - membraneLastT);
    membraneLastT = now;

    // Pills can change width on a CSS transition — the search box expanding,
    // the spacers easing their min-width — and a transition fires no further
    // mutations, so a target captured when the class flipped would be the
    // width from *before* it moved. While settling, re-read the live geometry
    // every frame instead and let the membrane chase it.
    if (now < membraneSettleUntil) {
      const next = computeTarget();
      if (next && next.length === field.length) targetField = next;
    }

    // Frame-rate independent approach to the target.
    const k = 1 - Math.pow(1 - CONTOUR.tween, dt / 16.67);
    let maxDelta = 0;
    for (let i = 0; i < field.length; i++) {
      const d = targetField[i] - field[i];
      field[i] += d * k;
      const ad = d < 0 ? -d : d;
      if (ad > maxDelta) maxDelta = ad;
    }

    drawMembrane();
    membraneRaf =
      maxDelta > 0.05 || now < membraneSettleUntil
        ? requestAnimationFrame(stepMembrane)
        : 0;
  }

  // Measuring forces layout, so coalesce a burst of mutations into one pass.
  function scheduleMembrane(animate: boolean): void {
    membranePendingAnimate = membranePendingAnimate || animate;
    if (animate) membraneSettleUntil = performance.now() + MEMBRANE_SETTLE_MS;
    if (membranePending) return;
    membranePending = requestAnimationFrame(() => {
      membranePending = 0;
      const a = membranePendingAnimate;
      membranePendingAnimate = false;
      retargetMembrane(a);
    });
  }

  function onMembraneScroll(): void {
    // The strip scrolls sideways under a fixed-width membrane, so the contour
    // has to be re-derived or it drifts off its pills.
    scheduleMembrane(false);
  }

  function observeMembrane(): void {
    if (!navElement || !navContentEl) return;

    membraneResizeObs = new ResizeObserver(() => scheduleMembrane(false));
    membraneResizeObs.observe(navElement);

    // Groups coming and going is the push into the membrane, so it animates.
    // Attributes matter too: the search box expands by toggling a class, not by
    // adding nodes, so childList alone would never see it.
    membraneMutationObs = new MutationObserver(() => scheduleMembrane(true));
    membraneMutationObs.observe(navContentEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    navContentEl.addEventListener("scroll", onMembraneScroll, {
      passive: true,
    });
    retargetMembrane(false);
  }

  // ── Long-press to pin the bar ──────────────────────────────────────────────
  // The press surface is the bar's own background — the padding and, mostly,
  // the open middle of the contour. Anything interactive is excluded, and any
  // real drag cancels, so this never fights the sideways scroll.
  const PIN_PRESS_MS = 500;
  const PIN_PRESS_SLOP = 10;

  let pinTimer: ReturnType<typeof setTimeout> | undefined;
  let pinStartX = 0;
  let pinStartY = 0;
  let pinNoticeText = "";
  let pinNoticeTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelPinPress(): void {
    if (pinTimer) clearTimeout(pinTimer);
    pinTimer = undefined;
  }

  function onBarPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, input, select, textarea, a, [role='button'], .dropdown-menu, .search-results-dropdown",
      )
    ) {
      return;
    }

    pinStartX = event.clientX;
    pinStartY = event.clientY;
    cancelPinPress();
    pinTimer = setTimeout(togglePinned, PIN_PRESS_MS);
  }

  function onBarPointerMove(event: PointerEvent): void {
    if (!pinTimer) return;
    const dx = event.clientX - pinStartX;
    const dy = event.clientY - pinStartY;
    if (dx * dx + dy * dy > PIN_PRESS_SLOP * PIN_PRESS_SLOP) cancelPinPress();
  }

  function togglePinned(): void {
    cancelPinPress();
    const pinned = !getNavBarPinned();
    setNavBarPinned(pinned);

    // The reader owns the bar's offset, and it already listens for this.
    window.dispatchEvent(new CustomEvent("settingsUpdated"));

    navigator.vibrate?.(15);
    pinNoticeText = pinned ? "Nav bar pinned" : "Nav bar unpinned";
    if (pinNoticeTimer) clearTimeout(pinNoticeTimer);
    pinNoticeTimer = setTimeout(() => (pinNoticeText = ""), 1400);
  }

  function teardownMembrane(): void {
    membraneResizeObs?.disconnect();
    membraneMutationObs?.disconnect();
    navContentEl?.removeEventListener("scroll", onMembraneScroll);
    if (membraneRaf) cancelAnimationFrame(membraneRaf);
    if (membranePending) cancelAnimationFrame(membranePending);
    membraneRaf = 0;
    membranePending = 0;
    cancelPinPress();
    if (pinNoticeTimer) clearTimeout(pinNoticeTimer);
  }

  onMount(() => {
    document.addEventListener("click", closeDropdowns);
    window.addEventListener("resize", updateDropdownPositions);
    window.addEventListener("settingsUpdated", onSettingsUpdated);
    observeMembrane();
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);
    window.removeEventListener("resize", updateDropdownPositions);
    window.removeEventListener("settingsUpdated", onSettingsUpdated);
    teardownMembrane();
  });

  // ── Read Aloud controls ────────────────────────────────────────────────────
  // These operate the reading, not a chapter, which is why they belong up here
  // rather than buried in whichever chapter heading happens to be on screen.

  $: ttsReference = $readingPosition
    ? `${$readingPosition.book} ${$readingPosition.chapter}`
    : "";

  // Bring the controls into the middle the moment they appear, so they never
  // have to be hunted for after pressing play. Only on the transition into
  // reading — pausing, changing verse or advancing a chapter must not yank the
  // bar back from wherever the user has since scrolled it.
  let ttsControlsEl: HTMLElement | undefined;
  let wasReadingActive = false;

  $: if ($isReadingActive !== wasReadingActive) {
    wasReadingActive = $isReadingActive;
    if ($isReadingActive) void centerTtsControls();
  }

  async function centerTtsControls(): Promise<void> {
    await tick(); // the controls only exist once reading is active
    // One more frame so the bar has been laid out before anything is measured.
    requestAnimationFrame(() => {
      if (ttsControlsEl) scrollToCenter(ttsControlsEl);
    });
  }

  $: sleepArmed = $sleepRemaining !== null || $stopAtChapterEnd;
  $: sleepLabel = $stopAtChapterEnd
    ? "⏱ chapter"
    : $sleepRemaining !== null
      ? `⏱ ${remainingMinutes($sleepRemaining)}m`
      : "⏱";
  $: sleepChoice = sleepArmed ? "keep" : "0";

  function applySleepChoice(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === "keep") return;
    if (value === "0") cancelSleepTimer();
    else if (value === "chapter") setStopAtChapterEnd();
    else startSleepTimer(parseInt(value, 10));
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="navigation-bar"
  {style}
  bind:this={navElement}
  on:pointerdown={onBarPointerDown}
  on:pointermove={onBarPointerMove}
  on:pointerup={cancelPinPress}
  on:pointercancel={cancelPinPress}
  on:pointerleave={cancelPinPress}
>
  <!-- The bar's underside, drawn as one path so the shadow traces the real
       contour rather than a rectangle. The filter belongs here and never on
       .navigation-bar: filter makes an element a containing block, which would
       strand the dropdowns that are rendered below to escape overflow. -->
  <svg
    class="nav-membrane"
    width={membraneW}
    height={CONTOUR.height}
    viewBox="0 0 {membraneW} {CONTOUR.height}"
    style="height: {CONTOUR.height}px; filter: drop-shadow(0 {CONTOUR.shadowY}px {CONTOUR.shadowBlur}px rgba(0, 0, 0, {CONTOUR.shadowOpacity}));"
    aria-hidden="true"
  >
    <path d={membraneFill} fill="#252525" />
    <path d={membraneEdge} fill="none" stroke="#323232" stroke-width="1" />
  </svg>

  <!-- Hangs off the bar rather than the viewport on purpose: the bar carries a
       transform, so a fixed chip would resolve against it anyway, and the
       feedback belongs next to the thing that was just pressed. -->
  {#if pinNoticeText}
    <div class="pin-notice" role="status">{pinNoticeText}</div>
  {/if}

  <div class="nav-content" bind:this={navContentEl}>

    <!-- Ã¢â€â‚¬Ã¢â€â‚¬ Pill 1: Navigation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ -->
    <div class="nav-pill nav-pill-nav">
      <!-- ── The trail out from home ──────────────────────────────────────
           Empty means you are home, and the bar is deliberately sparse. Every
           hop adds a crumb, so it fills up the further out you go — that
           crowding is the signal. Each crumb carries the mark of how you left
           that spot, and tapping one walks back to it; the first crumb is home.
           This replaces the floating bar that used to do the job, which was a
           single slot and so could only ever remember the most recent hop. -->
      {#if $canGoBack}
        {#each $navTrail as crumb, i}
          {@const Icon = CRUMB_ICONS[crumb.kind]}
          <button
            class="pill-btn pill-btn-text crumb-btn"
            style="color: {getBookColor(crumb.book)};"
            on:click={() => goToCrumb(i + 1)}
            title={i === 0 ? `Back to ${crumbLabel(crumb)} (home)` : `Back to ${crumbLabel(crumb)}`}
          >
            <span class="pill-label">{crumbLabel(crumb)}</span>
            <Icon size={11} weight="fill" />
          </button>
          <span class="crumb-sep"><CaretRight size={9} weight="bold" /></span>
        {/each}
      {/if}

      <!-- ── Where you are, and what you're reading it in ─────────────────
           Reversed while away, so the trail runs straight from the first crumb
           into the location pill instead of having the translation wedged in
           front of it. The location pill is the last crumb; nothing belongs
           between it and the ones before it. -->
      <div class="nav-locus" class:away={$canGoBack}>
      <!-- Translation -->
      <div class="nav-dropdown translation-dropdown-trigger">
        <button
          bind:this={translationButtonRef}
          class="pill-btn pill-btn-text"
          on:click={toggleTranslationDropdown}
          class:active={translationDropdownOpen}
          title="Translations"
        >
          <span class="pill-label">{translationLabel(currentTranslation)}</span>
          {#if translationDropdownOpen}
            <CaretUp size={10} weight="bold" />
          {:else}
            <CaretDown size={10} weight="bold" />
          {/if}
        </button>
      </div>

      <div class="pill-divider"></div>

      <!-- Reference (book + chapter) — the last crumb in the trail.
           Filled in the book's category colour when you are home, hollow when
           there is a trail behind it. Solid reads as settled; an outline reads
           as provisional, which is what being off home is. -->
      <div class="nav-dropdown reference-dropdown-trigger category-{currentBookCategory}">
        <button
          bind:this={referenceButtonRef}
          class="pill-btn pill-btn-text pill-btn-reference"
          class:at-home={!$canGoBack}
          style="--home-color: {getBookColor($navigationStore.book)};"
          on:click={toggleReferenceDropdown}
          title="Bible Navigation"
        >
          <span class="pill-label">{currentReference}</span>
          {#if referenceDropdownOpen}
            <CaretUp size={10} weight="bold" />
          {:else}
            <CaretDown size={10} weight="bold" />
          {/if}
        </button>
      </div>

      </div>

      <!-- Only offered while away: it opens where you came from beside where
           you landed, which is meaningless when those are the same place. -->
      {#if $canGoBack}
        <div class="pill-divider"></div>
        <button
          class="pill-btn"
          on:click={openSplitView}
          title="Open in split view"
          aria-label="Open in split view"
        >
          <ArrowsOutSimple size={16} weight="duotone" />
        </button>
      {/if}

      <div class="pill-divider"></div>

      <label
        class="pill-btn pill-toggle pill-refs"
        title="Show TSK cross-reference markers on verse keywords"
      >
        <input
          type="checkbox"
          checked={currentShowReferences}
          on:change={(e) => {
            if (windowId) {
              windowStore.updateContentState(windowId, { showReferences: e.currentTarget.checked });
            } else {
              navigationStore.setShowReferences(e.currentTarget.checked);
            }
          }}
        />
        <span class="icon-badge icon-badge-refs"><Graph size={18} weight="bold" /><span class="icon-overlay"><Graph size={18} weight="thin" /></span></span>
      </label>

      <div class="pill-divider"></div>

      <button
        bind:this={commButtonRef}
        class="pill-btn pill-btn-text pill-comm"
        class:active={commDropdownOpen}
        class:has-selection={currentCommAuthors.length > 0}
        on:click={toggleCommDropdown}
        title="Filter commentary authors"
      >
        <span class="icon-badge icon-badge-comm"><ChatText size={18} weight="bold" /><span class="icon-overlay"><ChatText size={18} weight="thin" /></span></span>
        {#if commDropdownOpen}
          <CaretUp size={10} weight="bold" />
        {:else}
          <CaretDown size={10} weight="bold" />
        {/if}
      </button>

    </div>

    {#if !isMinimal}
    <div class="nav-spacer" style="min-width: 27px"></div>
    {#if isOriginalLanguage(currentTranslation)}
      <div class="nav-interlinear">
        <button
          class="nav-il-toggle"
          class:active={interlinearSettings.enabled}
          on:click={toggleInterlinear}
          title="Show the English equivalent under each Greek/Hebrew word"
        >⇵ Interlinear</button>
        <div class="il-mini-divider"></div>
        <button
          bind:this={interlinearGearRef}
          class="nav-il-gear"
          class:active={interlinearMenuOpen}
          on:click|stopPropagation={toggleInterlinearMenu}
          aria-label="Customize interlinear layers"
          title="Customize which layers show"
        >
          {#if interlinearMenuOpen}<CaretUp size={10} weight="bold" />{:else}<CaretDown size={10} weight="bold" />{/if}
        </button>
      </div>
      <div class="nav-spacer" style="min-width: 27px"></div>
    {/if}
    <!-- ── Read Aloud controls (only while reading) ───────────────────────── -->
    {#if $isReadingActive}
      <div class="nav-tts" bind:this={ttsControlsEl}>
        {#if $isPreparing}
          <!-- Generating audio, not playing. Without this the button would show
               pause while the app was busy, which reads as broken. -->
          <span class="tts-nav-btn tts-nav-busy"><BrandSpinner size={17} /></span>
        {:else}
          <button
            class="tts-nav-btn"
            on:click={togglePlayPause}
            title={$readingState === 'playing' ? 'Pause reading' : 'Resume reading'}
            aria-label={$readingState === 'playing' ? 'Pause reading' : 'Resume reading'}
          >{$readingState === 'playing' ? '⏸' : '▶'}</button>
        {/if}

        <span class="tts-nav-ref">{ttsReference}</span>

        {#if $readingVerseList.length > 0}
          <select
            class="tts-nav-picker"
            value={$readingPosition?.verse ?? $readingVerseList[0]}
            on:change={(e) => jumpToVerse(parseInt(e.currentTarget.value, 10))}
            title="Jump to a verse"
            aria-label="Jump to a verse"
          >
            {#each $readingVerseList as verse}
              <option value={verse}>v. {verse}</option>
            {/each}
          </select>
        {/if}

        <button
          class="tts-nav-btn"
          on:click={stopReading}
          title="Stop reading"
          aria-label="Stop reading"
        >■</button>

        <button
          class="tts-nav-btn"
          class:tts-nav-on={$continuousPlay}
          on:click={() => continuousPlay.update((v) => !v)}
          title={$continuousPlay ? 'Auto-advance: on (click to turn off)' : 'Auto-advance to next chapter'}
          aria-label="Toggle auto-advance"
        >↠</button>

        <select
          class="tts-nav-picker tts-nav-sleep"
          class:tts-nav-on={sleepArmed}
          bind:value={sleepChoice}
          on:change={applySleepChoice}
          title={sleepArmed ? 'Sleep timer running — fades out and stops' : 'Sleep timer'}
          aria-label="Sleep timer"
        >
          {#if sleepArmed}
            <option value="keep">{sleepLabel}</option>
          {/if}
          <option value="0">{sleepArmed ? 'Off' : '⏱'}</option>
          <option value="10">10 min</option>
          <option value="20">20 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
          <option value="chapter">End of chapter</option>
        </select>
      </div>
      <div class="nav-spacer" style="min-width: 27px"></div>
    {/if}
    {#if $repeatsStore.length > 0}
      <div class="nav-repeat-pills">
        {#each $repeatsStore as group (group.word)}
          <button
            class="repeat-pill"
            style="--rp-bg: {REPEAT_COLORS[group.colorIndex].pill}; --rp-fg: {REPEAT_COLORS[group.colorIndex].pillText};"
            class:open={repeatDropdownWord === group.word}
            on:click={(e) => toggleRepeatPill(e, group.word)}
            title="Repeat: {group.label}"
          >
            <span class="repeat-pill-label">{group.label}</span>
            {#if $repeatCountsStore.get(group.word) !== undefined}
              <span class="repeat-pill-count">({$repeatCountsStore.get(group.word)})</span>
            {/if}
            {#if repeatDropdownWord === group.word}
              <CaretUp size={9} weight="bold" />
            {:else}
              <CaretDown size={9} weight="bold" />
            {/if}
          </button>
        {/each}
      </div>
      <div class="nav-spacer" style="min-width: 27px"></div>
    {/if}
    <!-- Ã¢â€â‚¬Ã¢â€â‚¬ Pill 2: Tools Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ -->
    <div class="nav-pill nav-pill-tools">
      <!-- Search (icon at rest Ã¢â€ â€™ expands on click) -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={searchContainerRef}
        class="pill-search-area"
        on:click|stopPropagation
        on:keydown|stopPropagation
        role="search"
      >
        <button
          class="pill-btn pill-search-icon-btn"
          on:click={expandSearch}
          title="Search"
          aria-label="Search"
        >
          <span class="icon-badge icon-badge-search"><MagnifyingGlass size={18} weight="bold" /><span class="icon-overlay"><MagnifyingGlass size={18} weight="thin" /></span></span>
        </button>
        <div class="pill-search-expander" class:expanded={searchExpanded}>
          <div class="search-input-inner" class:focused={searchFocused}>
            <input
              type="text"
              class="search-input"
              placeholder="Search verses, places, Strong's..."
              bind:value={searchQuery}
              on:input={handleSearchInput}
              on:keydown={handleSearchKeydown}
              on:focus={handleSearchFocus}
              on:blur={handleSearchBlur}
            />
            {#if isSearching}
              <div class="search-spinner-wrap">
                <BrandSpinner size={14} title="Searching…" />
              </div>
            {:else if searchQuery}
              <button
                class="clear-search"
                on:mousedown|preventDefault={clearSearch}
                title="Clear search"
              >
                <X size={12} weight="duotone" />
              </button>
            {/if}
          </div>
        </div>
      </div>

      <div class="pill-divider"></div>

      <!-- Advanced Search -->
      <button
        class="pill-btn pill-powersearch"
        on:click={() => (showPowerSearchModal = true)}
        title="Advanced search Ã¢â‚¬â€ regex, proximity, biblical filters"
        aria-label="Advanced search"
      >
        <span class="icon-badge icon-badge-powersearch"><Microscope size={18} weight="bold" /><span class="icon-overlay"><Microscope size={18} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Reading Plan -->
      <button
        class="pill-btn pill-readingplan"
        on:click={() => readingPlanModalStore.open()}
        title="Reading plan"
        aria-label="Reading plan"
      >
        <span class="icon-badge icon-badge-readingplan"><BookOpenText size={18} weight="bold" /><span class="icon-overlay"><BookOpenText size={18} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Daily Greeting / Verse of the Day -->
      <button
        class="pill-btn pill-votd"
        on:click={openDailyGreeting}
        title="Verse of the day"
        aria-label="Verse of the day"
      >
        <span class="icon-badge icon-badge-votd"><Sun size={18} weight="bold" /><span class="icon-overlay"><Sun size={18} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Settings -->
      <button
        class="pill-btn pill-settings"
        on:click={openSettings}
        title="Settings"
        aria-label="Open settings"
      >
        <span class="icon-badge icon-badge-settings"><Gear size={18} weight="bold" /><span class="icon-overlay"><Gear size={18} weight="thin" /></span></span>
      </button>

      <!-- Profile -->
      <button
        class="pill-btn pill-profile"
        class:signed-in={isSignedIn}
        on:click={() => profileModalStore.open()}
        title="Profile"
        aria-label="Open profile"
      >
        <span class="icon-badge icon-badge-profile"><User size={18} weight="bold" /><span class="icon-overlay"><User size={18} weight="thin" /></span></span>
      </button>
    </div>
    {/if}

  </div>

  {#if showResults}
    <div class="search-results-dropdown" bind:this={searchResultsEl}>
      {#if displayedResultCount > 0}
        <div class="search-stats">
          Showing {displayedResultCount}
          {#if !showingAll && totalResultCount > displayedResultCount}
            of <button class="load-all-link" on:click={loadAllResults}
              >{totalResultCount} results</button
            >
          {:else}
            {totalResultCount > 1 ? "results" : "result"}
          {/if}
        </div>
      {/if}

      {#if searchTree.length > 0}
        <SearchResultsTree
          nodes={searchTree}
          expanded={expandedSearchNodes}
          query={searchQuery}
          onToggle={toggleSearchNode}
          onSelect={handleResultClick}
        />
      {:else}
        <div class="no-search-results">
          No results found for "{searchQuery}"
        </div>
      {/if}
    </div>
  {/if}

  <!-- Dropdowns rendered outside nav-content to avoid overflow clipping -->
  {#if translationDropdownOpen}
    <div class="dropdown-menu translation-dropdown" class:positioned={translationDropdownPositioned}>
      {#each $availableTranslations as translation}
        <button
          class="dropdown-item"
          class:selected={translation === currentTranslation}
          on:click={() => selectTranslation(translation)}
        >
          {translationLabel(translation)}
        </button>
      {/each}
    </div>
  {/if}

  {#if referenceDropdownOpen}
    <div class="dropdown-menu tree-menu reference-dropdown" class:positioned={referenceDropdownPositioned}>
      {#each REFERENCE_COLUMNS as column}
        <div class="book-column book-column-{column.testament}">
          <div class="book-column-title">{column.label}</div>
          <!-- The books sit in their own box so the NT column can spread its
               spare height between them without pushing the title away. -->
          <div class="book-column-body">
          {#each column.books as book, i}
            {#if i === 0 || column.books[i - 1].category !== book.category}
              <div
                class="category-header"
                style="color:{CATEGORY_COLORS[book.category]}"
              >{CATEGORY_LABELS[book.category]}</div>
            {/if}
            <div
              class="book-item category-{book.category} testament-{book.testament}"
            >
              <button
                class="book-button"
                class:expanded={expandedBooks.has(book.name)}
                class:current={book.name === currentBook}
                on:click={(e) => toggleBook(book.name, e)}
              >
                <span class="expand-icon">
                  {#if expandedBooks.has(book.name)}<CaretDown size={10} weight="bold" />{:else}<CaretRight size={10} weight="bold" />{/if}
                </span>
                <span class="book-name">{book.name}</span>
              </button>

              {#if expandedBooks.has(book.name)}
                <div
                  class="chapters-container"
                  style="--chapter-columns: {Math.min(book.chapters, 7)}"
                >
                  {#each Array.from({ length: book.chapters }, (_, i) => i + 1) as chapter}
                    <button
                      class="chapter-button"
                      class:selected={book.name === currentBook &&
                        chapter === currentChapter}
                      on:click={() => selectChapter(book.name, chapter)}
                    >
                      {chapter}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if commDropdownOpen}
    <div class="dropdown-menu comm-dropdown" class:positioned={commDropdownPositioned}>
      {#each Object.entries(COMMENTARY_AUTHORS) as [key, cfg]}
        <label class="comm-author-row">
          <input
            type="checkbox"
            checked={currentCommAuthors.includes(key)}
            on:change={() => toggleCommAuthor(key)}
          />
          <span class="comm-author-swatch" style="background:radial-gradient(circle, {cfg.color} 0%, {cfg.color} 20%, #000000 100%)">{cfg.initials}</span>
          <span class="comm-author-name">{cfg.fullName}</span>
        </label>
      {/each}
    </div>
  {/if}

  {#if repeatDropdownWord}
    {@const grp = $repeatsStore.find((g) => g.word === repeatDropdownWord)}
    {#if grp}
      <div
        class="dropdown-menu repeat-dropdown"
        class:positioned={repeatDropdownPositioned}
        style="--rp-bg: {REPEAT_COLORS[grp.colorIndex].pill}; --rp-fg: {REPEAT_COLORS[grp.colorIndex].pillText};"
      >
        {#if repeatDropdownView === 'main'}
          <button class="repeat-menu-item" on:click|stopPropagation={() => { repeatDropdownView = 'scope'; positionRepeatDropdown(); }}>
            <span>Highlight All</span>
            <CaretRight size={11} weight="bold" />
          </button>
          <button class="repeat-menu-item" on:click|stopPropagation={() => deselectRepeat(grp.word)}>
            Deselect All
          </button>
        {:else}
          <button class="repeat-menu-item repeat-menu-back" on:click|stopPropagation={() => { repeatDropdownView = 'main'; positionRepeatDropdown(); }}>
            <CaretRight size={11} weight="bold" style="transform: rotate(180deg);" />
            <span>Highlight all in…</span>
          </button>
          <button class="repeat-menu-item" on:click|stopPropagation={() => selectRepeatScope('chapter')}>Current Chapter</button>
          <button class="repeat-menu-item" on:click|stopPropagation={() => selectRepeatScope('book')}>Current Book</button>
        {/if}
      </div>
    {/if}
  {/if}

  {#if interlinearMenuOpen && isOriginalLanguage(currentTranslation)}
    <button
      class="il-popover-backdrop"
      on:click={() => (interlinearMenuOpen = false)}
      aria-label="Close customizer"
      tabindex="-1"
    ></button>
    <div
      class="interlinear-popover"
      style="top:{ilPopTop}px; left:{ilPopLeft}px;"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="menu"
      tabindex="-1"
    >
      <div class="interlinear-popover-title">Interlinear layers</div>
      <InterlinearControls
        showEnableToggle={false}
        showPreview={false}
        on:change={handleInterlinearSettingsChange}
      />
    </div>
  {/if}
</div>

<!-- Power Search Modal -->
<PowerSearchModal bind:show={showPowerSearchModal} />


<style>
  /* No background and no bottom border: the membrane below is the whole bar,
     and the open middle is meant to let the text through. */
  .navigation-bar {
    position: sticky;
    top: 0;
    z-index: 1000;
    box-sizing: border-box;
    overflow: visible;
  }

  /* Same recipe as the reader's floating notices. It cannot literally share
     that class — Svelte scopes CSS per component — so the values are matched. */
  .pin-notice {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 10003;
    padding: 8px 12px;
    border-radius: 10px;
    background: #1c1c1c;
    border: 1px solid #3a3a3a;
    color: #e0e0e0;
    font-size: 13px;
    line-height: 1.35;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
  }

  /* Sits behind the pills, which are opaque and paint on top — that is what
     lets a tight gap's shoulders run underneath them. */
  .nav-membrane {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    overflow: visible;
    z-index: 0;
  }

  .nav-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    /* Top gap is 4.5px; the bottom pad is whatever keeps the content box exactly
       one pill tall, so the 58px box (and the text below it) never moves. */
    padding: 4.5px 16px 15.5px;
    overflow-x: auto;
    scrollbar-width: none;
    min-height: 58px;
    flex-wrap: nowrap;
  }

  .nav-content::-webkit-scrollbar {
    display: none;
  }

  .nav-spacer {
    flex: 1;
    min-width: 27px;
    transition: min-width 0.15s ease;
  }

  /* ── Read Aloud controls ────────────────────────────────────────────────── */
  /* Its own group between the two pills, same shape as the repeat pills. The
     nav strip scrolls sideways, so this never crushes the pills either side. */
  .nav-tts {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: nowrap;
    background: #1c1c1c;
    border: 1px solid rgba(157, 122, 245, 0.45);
    border-radius: 8px;
    padding: 3px 6px;
    height: 38px;
  }

  .tts-nav-btn {
    background: none;
    border: none;
    color: #999;
    font-size: 1rem;
    line-height: 1;
    padding: 3px 6px;
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .tts-nav-btn:hover {
    color: #b79df7;
    background: rgba(157, 122, 245, 0.12);
  }
  .tts-nav-on {
    color: #9d7af5;
  }

  /* Same footprint as the play/pause button, so nothing shifts when it swaps in. */
  .tts-nav-busy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: default;
  }

  .tts-nav-ref {
    font-size: 0.72rem;
    color: #b79df7;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    padding: 0 2px;
  }

  .tts-nav-picker {
    background: transparent;
    border: 1px solid rgba(157, 122, 245, 0.3);
    border-radius: 4px;
    color: #b79df7;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    padding: 2px 4px;
    cursor: pointer;
    max-width: 9ch;
  }
  .tts-nav-picker:hover {
    border-color: rgba(157, 122, 245, 0.7);
  }
  .tts-nav-sleep {
    color: #8a8a9a;
    border-color: rgba(157, 122, 245, 0.18);
  }
  .tts-nav-sleep.tts-nav-on {
    color: #b79df7;
    border-color: rgba(157, 122, 245, 0.55);
  }

  /* ── Repeat pills ───────────────────────────────────────────────────────── */
  .nav-repeat-pills {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: nowrap;
    flex-shrink: 0;
  }

  .repeat-pill-count {
    opacity: 0.8;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .repeat-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 9px;
    border: none;
    border-radius: 7px;
    background: var(--rp-bg);
    color: var(--rp-fg);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.92;
    transition: opacity 0.15s, filter 0.15s;
  }

  .repeat-pill:hover {
    opacity: 1;
    filter: brightness(1.1);
  }

  .repeat-pill.open {
    opacity: 1;
    filter: brightness(1.15);
  }

  .repeat-pill-label {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .repeat-dropdown {
    min-width: 170px;
    padding: 4px;
    overflow: hidden;
  }

  .repeat-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 9px 12px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #e0e0e0;
    text-align: left;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .repeat-menu-item:hover {
    background: #3a3a3a;
  }

  .repeat-menu-back {
    color: #999;
    font-weight: 600;
    justify-content: flex-start;
  }

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Pill containers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  .nav-pill {
    display: flex;
    align-items: center;
    gap: 2px;
    background: #1c1c1c;
    border: 1px solid #353535;
    border-radius: 8px;
    padding: 3px;
    height: 38px;
    flex-shrink: 0;
  }

  .nav-pill-tools {
  }

  /* ── Interlinear control (between the two pills) ───────────────────── */
  .nav-interlinear {
    display: flex;
    align-items: center;
    gap: 2px;
    background: #1c1c1c;
    border: 1px solid #353535;
    border-radius: 8px;
    height: 38px;
    padding: 3px;
    flex-shrink: 0;
  }
  .nav-il-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #888;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
  }
  .nav-il-toggle:hover {
    background: #252525;
    color: #ccc;
  }
  .nav-il-toggle.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    font-weight: 600;
  }
  .il-mini-divider {
    width: 1px;
    height: 16px;
    background: #353535;
    flex-shrink: 0;
  }
  .nav-il-gear {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    min-width: 28px;
    padding: 0 6px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #888;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .nav-il-gear:hover,
  .nav-il-gear.active {
    background: #252525;
    color: #fff;
  }

  .il-popover-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    z-index: 10050;
    cursor: default;
  }
  .interlinear-popover {
    position: fixed;
    z-index: 10051;
    width: 300px;
    max-width: 92vw;
    max-height: 70vh;
    overflow-y: auto;
    background: #232323;
    border: 1px solid #3a3a3a;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    padding: 14px;
    text-align: left;
  }
  .interlinear-popover-title {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #9fb0d0;
    margin-bottom: 10px;
  }
  @media (max-width: 480px) {
    .interlinear-popover {
      left: 0 !important;
      right: 0;
      top: auto !important;
      bottom: 0;
      width: 100vw;
      max-width: 100vw;
      max-height: 75vh;
      border-radius: 16px 16px 0 0;
    }
  }

  .pill-divider {
    width: 1px;
    height: 16px;
    background: #353535;
    margin: 0 1px;
    flex-shrink: 0;
  }

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Pill buttons Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  .pill-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 32px;
    padding: 0 9px;
    min-width: 32px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #888;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
    touch-action: manipulation;
    flex-shrink: 0;
  }

  .pill-btn:hover {
    background: #252525;
    color: #ccc;
  }

  .pill-btn.active {
    background: #252525;
    color: #fff;
  }

  .pill-btn-text {
    padding: 0 10px;
  }

  .pill-label {
    font-size: 13px;
    font-weight: 500;
    color: inherit;
    white-space: nowrap;
  }

  /* References toggle */
  .pill-toggle {
    cursor: pointer;
    user-select: none;
  }

  .pill-toggle input[type="checkbox"] {
    display: none;
  }

  .pill-toggle:has(input:checked) {
    color: #667eea;
  }

  /* Reference button category colors (text tint only) */
  /* ── Home vs away ──────────────────────────────────────────────────────
     Home is a filled pill: you chose this chapter, you are settled. Away is
     the same pill hollow, with the trail of crumbs to its left. The colour
     comes from the book's category either way, so only the treatment changes.
     Declared before the per-category colour rules so those still set the text
     colour when away. */
  /* ── Home ─────────────────────────────────────────────────────────────────
     The chip is the dark plate: 6px corners, matching the icon badges. The
     colour inside is a separate shape, not a background — a stadium, flat top
     and bottom with true semicircular ends.

     A gradient cannot draw that. A radial gradient is an ellipse: it curves the
     whole way round and pinches toward the ends, and sized to the corners (the
     default) its black endpoint lands outside the box, so the colour was being
     clipped at roughly 70% of the way to black rather than fading out — a hard
     cut at the sides and no dark band at all along the top and bottom.

     Drawn as a shape instead, the softness belongs to the edge rather than to
     the form: `border-radius: 999px` clamps to half the height, which is what
     makes the ends exact semicircles, and the blur takes the hard line off
     without disturbing the geometry.

     It goes on the label rather than the button because the button is 32px tall
     by definition, so a fill there has nowhere to breathe above and below. The
     caret is the label's sibling and stays outside the chip, uncoloured, like
     every other dropdown. */
  /* Holds the translation and the location pill. Its own flex context is what
     lets the two swap without duplicating either block of markup — the divider
     stays between them either way. Note this reorders visually only; keyboard
     tab order still follows the DOM. */
  .nav-locus {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nav-locus.away {
    flex-direction: row-reverse;
  }

  /* Away: the same 6px rectangle as the home chip, but a hollow ring rather
     than a filled stadium. Solid reads as settled, an outline as provisional,
     which is what being off home is.

     The ring is currentColor so it always matches the label it surrounds. The
     bar keeps its own per-category colours further down this file, and four of
     them have drifted from CATEGORY_COLORS — historical, wisdom, acts and
     general — so drawing the border from the shared palette would have shown a
     mismatched ring on exactly those books.

     A pixel comes off the padding to pay for the border, so the pill is the
     same size filled or ringed and does not jump when you leave home. */
  .pill-btn-reference:not(.at-home) .pill-label {
    display: inline-flex;
    align-items: center;
    padding: 5px 8px;
    border: 1px solid currentColor;
    border-radius: 6px;
  }

  .at-home .pill-label {
    position: relative;
    /* Load-bearing. `position: relative` alone does not open a stacking
       context, so the colour's negative z-index would drop it behind this
       element's own black background and it would vanish. With one, negative-z
       children paint above the background and below the text — exactly where
       the colour belongs, and the text then needs no z-index of its own. */
    isolation: isolate;
    /* Clips the blur to the rounded corners, so the chip's outer edge stays
       crisp while the colour inside stays soft. */
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    /* 13px of text plus 12px of padding lands at 25px — the same height as an
       icon badge (an 18px glyph in 4px of padding), so the two sit level
       rather than one looking undersized beside the other. */
    padding: 6px 9px;
    border-radius: 6px;
    background: #000000;
    /* White over a dark halo, the way the icon badges keep their glyph legible,
       so no hue needs a different answer. */
    color: #ffffff;
    text-shadow: 0 0 2px #000000, 0 0 2px #000000;
    font-weight: 600;
  }

  .at-home .pill-label::before {
    content: "";
    position: absolute;
    /* Vertical then horizontal. The ends sit 2.5px further out than the top
       and bottom, which lengthens the stadium by 5px overall and keeps the
       dark band tighter above and below than it is at the ends — the colour
       reads as a pill lying in the chip rather than a blob centred in it.
       Blur grows with the shape; overflow on the chip clips whatever spills. */
    inset: 2.5px 1.5px;
    border-radius: 999px;
    background: var(--home-color, #8a8f98);
    filter: blur(3.5px);
    z-index: -1;
  }

  .nav-dropdown.reference-dropdown-trigger.category-pentateuch .pill-btn-reference { color: #a67c52; }
  .nav-dropdown.reference-dropdown-trigger.category-historical .pill-btn-reference { color: #6496c8; }
  .nav-dropdown.reference-dropdown-trigger.category-wisdom .pill-btn-reference { color: #daa520; }
  .nav-dropdown.reference-dropdown-trigger.category-major-prophets .pill-btn-reference { color: #5c1e99; }
  .nav-dropdown.reference-dropdown-trigger.category-minor-prophets .pill-btn-reference { color: #a45be9; }
  .nav-dropdown.reference-dropdown-trigger.category-gospels .pill-btn-reference { color: #fc345c; }
  .nav-dropdown.reference-dropdown-trigger.category-acts .pill-btn-reference { color: #ff6030; }
  .nav-dropdown.reference-dropdown-trigger.category-pauline .pill-btn-reference { color: #6048cc; }
  .nav-dropdown.reference-dropdown-trigger.category-general .pill-btn-reference { color: #d2691e; }
  .nav-dropdown.reference-dropdown-trigger.category-revelation .pill-btn-reference { color: #61f1ff; }

  /* Ã¢â€â‚¬Ã¢â€â‚¬ Icon badges (brown bold icon on radial gradient splash) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
  .icon-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    padding: 4px;
    line-height: 0;
    color: #000000;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.icon-badge > svg) {
    filter: drop-shadow(0 0 2px #000000) drop-shadow(0 0 2px #000000);
  }
  .icon-badge-refs        { background: radial-gradient(circle, #9ca3af 0%, #9ca3af 20%, #000000 100%); }
  .icon-badge-comm        { background: radial-gradient(circle, #a3e635 0%, #a3e635 20%, #000000 100%); }
  .icon-badge-search      { background: radial-gradient(circle, #fb7185 0%, #fb7185 20%, #000000 100%); }
  .icon-badge-powersearch { background: radial-gradient(circle, #f97316 0%, #f97316 20%, #000000 100%); }
  .icon-badge-readingplan { background: radial-gradient(circle, #60a5fa 0%, #60a5fa 20%, #000000 100%); }
  .icon-badge-votd        { background: radial-gradient(circle, #fde047 0%, #fde047 20%, #000000 100%); }
  .icon-badge-settings    { background: radial-gradient(circle, #7dd3fc 0%, #7dd3fc 20%, #000000 100%); }
  .icon-badge-profile     { background: radial-gradient(circle, #d1d5db 0%, #d1d5db 20%, #000000 100%); }
  .pill-refs:has(input:checked) .icon-badge-refs { background: radial-gradient(circle, #a78bfa 0%, #a78bfa 20%, #000000 100%); }
  .pill-profile.signed-in .icon-badge-profile    { background: radial-gradient(circle, #86efac 0%, #86efac 20%, #000000 100%); }

  /* Search expand */
  .pill-search-area {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .pill-search-icon-btn {
    min-width: 32px;
    padding: 0 8px;
  }

  .pill-search-expander {
    width: 0;
    overflow: hidden;
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .pill-search-expander.expanded {
    width: 230px;
  }

  .search-input-inner {
    display: flex;
    align-items: center;
    height: 26px;
    background: #141414;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    margin-left: 4px;
    width: 222px;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .search-input-inner.focused {
    border-color: #fb7185;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e0e0e0;
    font-size: 13px;
    padding: 0 8px;
    min-width: 0;
    font-family: inherit;
  }

  .search-input::placeholder {
    color: #555;
  }

  .clear-search {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 0 6px;
    flex-shrink: 0;
    height: 100%;
    transition: color 0.15s;
  }

  .clear-search:hover {
    color: #ccc;
  }

  /* BrandSpinner turns itself, so this only positions it — a rotation here
     would spin the gem twice over. */
  .search-spinner-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    flex-shrink: 0;
  }

  .nav-dropdown {
    position: relative;
  }

  /* Comm dropdown */

  .comm-dropdown {
    min-width: 240px;
    width: fit-content;
    padding: 8px 0;
  }

  .comm-author-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
    color: #e0e0e0;
    transition: background 0.15s;
  }

  .comm-author-row:hover {
    background: #2a2a2a;
  }

  .comm-author-row input[type="checkbox"] {
    cursor: pointer;
    flex-shrink: 0;
  }

  .comm-author-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
    letter-spacing: 0.5px;
  }

  .comm-author-name {
    flex: 1;
    white-space: nowrap;
  }



  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 400px;
    overflow-y: auto;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    z-index: 10001; /* Higher than nav bar */
  }

  /* Dropdowns outside nav-content use fixed positioning.
     Start invisible so there's no flash at left:0/top:0 before JS places them.
     The .positioned class is added after JS sets left/top.
     right:auto cancels the right:0 inherited from .dropdown-menu Ã¢â‚¬â€ without it, fit-content
     is constrained to (viewport_width - left), which is too narrow on small screens. */
  .translation-dropdown,
  .reference-dropdown,
  .comm-dropdown,
  .repeat-dropdown {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    visibility: hidden;
  }

  .translation-dropdown.positioned,
  .reference-dropdown.positioned,
  .comm-dropdown.positioned,
  .repeat-dropdown.positioned {
    visibility: visible;
  }

  /* Old Testament left, New Testament right. Two equal fr tracks inside a
     fit-content box make both columns as wide as the widest book name - the
     expanded chapter overlay leans on that, since it spans 200% of one column.
     max-height also tracks the viewport so landscape phones (~390px tall) don't
     get a dropdown that runs off the bottom of the screen. */
  .tree-menu {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    align-items: stretch;
    max-height: min(500px, 85vh);
    width: fit-content;
    max-width: 90vw;
  }

  .book-column {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .book-column-nt {
    border-left: 1px solid #3a3a3a;
    background: #000;
  }

  /* Fixed height so the category headers below can stick just under it. */
  .book-column-title {
    position: sticky;
    top: 0;
    z-index: 3;
    flex: 0 0 auto;
    height: 26px;
    line-height: 26px;
    padding: 0 10px;
    background: #1a1a1a;
    border-bottom: 1px solid #3a3a3a;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #cfcfcf;
    white-space: nowrap;
  }

  .book-column-body {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  /* NT has 27 books to OT's 39. Spreading the leftover height between its rows
     keeps both columns starting and ending level instead of leaving a long gap
     hanging off the bottom of one side. The black shows through those gaps.
     space-between puts no gap before the first row or after the last, so the
     column stays flush top and bottom. */
  .book-column-nt .book-column-body {
    justify-content: space-between;
  }

  .dropdown-item {
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: none;
    color: #e0e0e0;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 14px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .dropdown-item:hover {
    background: #3a3a3a;
  }

  .dropdown-item.selected {
    background: #667eea;
    color: white;
    font-weight: 500;
  }

  /* Book and Chapter Tree Styles */
  .book-item {
    position: relative; /* anchors the expanded chapter overlay */
    border-bottom: 1px solid #3a3a3a;
  }

  .book-item:last-child {
    border-bottom: none;
  }

  /* Category group label in the book dropdown */
  .category-header {
    position: sticky;
    top: 26px; /* clears the sticky column title */
    z-index: 1;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 6px 8px 4px;
    margin-top: 4px;
    background: #2a2a2a;
    border-bottom: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  }

  /* Its top margin would otherwise show as a sliver of the column background
     right under the title - black in the NT column, which reads as a gap. */
  .book-column-body > .category-header:first-child {
    margin-top: 0;
  }

  /* The OT/NT break is the column split itself now; the thick black divider only
     comes back when the columns stack on a narrow portrait screen (see below). */

  /* Category Colors Ã¢â‚¬â€ Radial Gradient Theme */
  /* Pentateuch Ã¢â‚¬â€ amber */
  .category-pentateuch .book-button { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-pentateuch .book-button:hover { background: radial-gradient(circle, #a67c52 0%, #a67c52 35%, #222222 100%); }
  .category-pentateuch .book-button.current { background: radial-gradient(circle, #a67c52 0%, #a67c52 50%, #222222 100%); font-weight: 500; }

  /* Historical Ã¢â‚¬â€ blue */
  .category-historical .book-button { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-historical .book-button:hover { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 35%, #222222 100%); }
  .category-historical .book-button.current { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 50%, #222222 100%); font-weight: 500; }

  /* Wisdom Ã¢â‚¬â€ gold */
  .category-wisdom .book-button { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-wisdom .book-button:hover { background: radial-gradient(circle, #f0c040 0%, #f0c040 35%, #222222 100%); }
  .category-wisdom .book-button.current { background: radial-gradient(circle, #f0c040 0%, #f0c040 50%, #222222 100%); font-weight: 500; }

  /* Major Prophets Ã¢â‚¬â€ purple */
  .category-major-prophets .book-button { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-major-prophets .book-button:hover { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 35%, #222222 100%); }
  .category-major-prophets .book-button.current { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 50%, #222222 100%); font-weight: 500; }

  /* Minor Prophets Ã¢â‚¬â€ orange */
  .category-minor-prophets .book-button { background: radial-gradient(circle, #a45be9 0%, #a45be9 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-minor-prophets .book-button:hover { background: radial-gradient(circle, #a45be9 0%, #a45be9 35%, #222222 100%); }
  .category-minor-prophets .book-button.current { background: radial-gradient(circle, #a45be9 0%, #a45be9 50%, #222222 100%); font-weight: 500; }

  /* Gospels Ã¢â‚¬â€ green */
  .category-gospels .book-button { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-gospels .book-button:hover { background: radial-gradient(circle, #fc345c 0%, #fc345c 35%, #222222 100%); }
  .category-gospels .book-button.current { background: radial-gradient(circle, #fc345c 0%, #fc345c 50%, #222222 100%); font-weight: 500; }

  /* Acts Ã¢â‚¬â€ red-orange */
  .category-acts .book-button { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-acts .book-button:hover { background: radial-gradient(circle, #ff6520 0%, #ff6520 35%, #222222 100%); }
  .category-acts .book-button.current { background: radial-gradient(circle, #ff6520 0%, #ff6520 50%, #222222 100%); font-weight: 500; }

  /* Pauline Ã¢â‚¬â€ crimson */
  .category-pauline .book-button { background: radial-gradient(circle, #6048cc 0%, #6048cc 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-pauline .book-button:hover { background: radial-gradient(circle, #6048cc 0%, #6048cc 35%, #222222 100%); }
  .category-pauline .book-button.current { background: radial-gradient(circle, #6048cc 0%, #6048cc 50%, #222222 100%); font-weight: 500; }

  /* General Ã¢â‚¬â€ warm orange */
  .category-general .book-button { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-general .book-button:hover { background: radial-gradient(circle, #f2893e 0%, #f2893e 35%, #222222 100%); }
  .category-general .book-button.current { background: radial-gradient(circle, #f2893e 0%, #f2893e 50%, #222222 100%); font-weight: 500; }

  /* Revelation Ã¢â‚¬â€ royal blue */
  .category-revelation .book-button { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-revelation .book-button:hover { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 35%, #222222 100%); }
  .category-revelation .book-button.current { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 50%, #222222 100%); font-weight: 500; }

  .book-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: transparent;
    border: none;
    color: #e2e2e2;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s, box-shadow 0.15s;
    font-size: 18px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
    box-shadow: inset 0 0 0 1000px rgba(0,0,0,0.4);
  }

  .book-button:hover {
    background: #3a3a3a;
  }

  .book-button.current {
    background: rgba(102, 126, 234, 0.2);
    font-weight: 500;
    box-shadow: none;
  }

  .expand-icon {
    color: #e2e2e2;
    font-size: 10px;
    width: 12px;
    display: inline-block;
    pointer-events: none;
  }

  .book-name {
    flex: 1;
    font-weight: 700;
  }

  /* Opens as an overlay across both columns instead of pushing the list down, so
     the OT and NT columns stay level while a book is open. Double the width fits
     roughly 14 chapters per row, which halves the height of long books. */
  .chapters-container {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 5;
    width: calc(200% + 1px); /* +1px covers the NT column's left border */
    display: grid;
    grid-template-columns: repeat(auto-fill, 40px);
    justify-content: center;
    gap: 4px;
    padding: 6px;
    background: #1c1c1c;
    border: 1px solid #3a3a3a;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.6);
  }

  /* A book in the right-hand column opens leftward to cover both columns. */
  .book-column-nt .chapters-container {
    left: calc(-100% - 1px);
  }

  .chapter-button {
    padding: 8px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #e2e2e2;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 15px;
    text-align: center;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
    box-shadow: inset 0 0 0 1000px rgba(0,0,0,0.5);
  }

  .chapter-button:hover {
    background: #3a3a3a;
    border-color: #667eea;
    box-shadow: inset 0 0 0 1000px rgba(0,0,0,0.3);
  }

  .chapter-button.selected {
    background: #667eea;
    border-color: #667eea;
    color: #e2e2e2;
    font-weight: 600;
    box-shadow: none;
  }

  /* Category-specific chapter buttons */
  .category-pentateuch .chapter-button { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-pentateuch .chapter-button:hover { background: radial-gradient(circle, #a67c52 0%, #a67c52 35%, #222222 100%); border-color: #222222; }
  .category-pentateuch .chapter-button.selected { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-historical .chapter-button { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-historical .chapter-button:hover { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 35%, #222222 100%); border-color: #222222; }
  .category-historical .chapter-button.selected { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-wisdom .chapter-button { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-wisdom .chapter-button:hover { background: radial-gradient(circle, #f0c040 0%, #f0c040 35%, #222222 100%); border-color: #222222; }
  .category-wisdom .chapter-button.selected { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-major-prophets .chapter-button { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-major-prophets .chapter-button:hover { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 35%, #222222 100%); border-color: #222222; }
  .category-major-prophets .chapter-button.selected { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-minor-prophets .chapter-button { background: radial-gradient(circle, #a45be9 0%, #a45be9 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-minor-prophets .chapter-button:hover { background: radial-gradient(circle, #a45be9 0%, #a45be9 35%, #222222 100%); border-color: #222222; }
  .category-minor-prophets .chapter-button.selected { background: radial-gradient(circle, #a45be9 0%, #a45be9 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-gospels .chapter-button { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-gospels .chapter-button:hover { background: radial-gradient(circle, #fc345c 0%, #fc345c 35%, #222222 100%); border-color: #222222; }
  .category-gospels .chapter-button.selected { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-acts .chapter-button { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-acts .chapter-button:hover { background: radial-gradient(circle, #ff6520 0%, #ff6520 35%, #222222 100%); border-color: #222222; }
  .category-acts .chapter-button.selected { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-pauline .chapter-button { background: radial-gradient(circle, #6048cc 0%, #6048cc 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-pauline .chapter-button:hover { background: radial-gradient(circle, #6048cc 0%, #6048cc 35%, #222222 100%); border-color: #222222; }
  .category-pauline .chapter-button.selected { background: radial-gradient(circle, #6048cc 0%, #6048cc 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-general .chapter-button { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-general .chapter-button:hover { background: radial-gradient(circle, #f2893e 0%, #f2893e 35%, #222222 100%); border-color: #222222; }
  .category-general .chapter-button.selected { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  .category-revelation .chapter-button { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 20%, #222222 100%); border-color: #222222; color: #e2e2e2; }
  .category-revelation .chapter-button:hover { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 35%, #222222 100%); border-color: #222222; }
  .category-revelation .chapter-button.selected { background: radial-gradient(circle, #61f1ff 0%, #61f1ff 20%, #222222 100%); border-color: #222222; color: #e2e2e2; font-weight: 600; }

  /* Scrollbar styling */
  .dropdown-menu::-webkit-scrollbar {
    width: 8px;
  }

  .dropdown-menu::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .dropdown-menu::-webkit-scrollbar-thumb {
    background: #4a4a4a;
    border-radius: 4px;
  }

  .dropdown-menu::-webkit-scrollbar-thumb:hover {
    background: #5a5a5a;
  }



  .search-results-dropdown {
    position: fixed;
    top: calc(100% + 4px);
    left: 0;
    max-height: 400px;
    overflow-y: auto;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    z-index: 10002; /* Higher than dropdowns */
  }

  .no-search-results {
    padding: 24px;
    text-align: center;
    color: #888;
    font-size: 14px;
  }

  .search-stats {
    padding: 10px 14px;
    background: #1a1a1a;
    border-bottom: 1px solid #3a3a3a;
    color: #aaa;
    font-size: 13px;
    font-weight: 500;
  }

  .load-all-link {
    background: none;
    border: none;
    color: #667eea;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    font-weight: inherit;
    padding: 0;
    margin: 0;
  }

  .load-all-link:hover {
    color: #7e8ff0;
  }

  .search-results-dropdown::-webkit-scrollbar {
    width: 8px;
  }

  .search-results-dropdown::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .search-results-dropdown::-webkit-scrollbar-thumb {
    background: #4a4a4a;
    border-radius: 4px;
  }

  .search-results-dropdown::-webkit-scrollbar-thumb:hover {
    background: #5a5a5a;
  }



  /* Mobile Ã¢â‚¬â€ pills stack or shrink on small screens */
  @media (max-width: 600px) {
    .nav-content {
      padding: 4.5px 10px 15.5px;
      gap: 6px;
    }

    .pill-search-expander.expanded {
      width: 150px;
    }

    .search-input-inner {
      width: 142px;
    }

    .dropdown-menu {
      max-width: 92vw;
    }

    .search-results-dropdown {
      max-width: 92vw;
    }
  }

  /* Two columns need ~420px and a portrait phone only offers ~350px, so upright
     phones fall back to the single top-to-bottom list. The same phone turned
     sideways is 670px+ wide, so landscape keeps the columns. */
  @media (max-width: 600px) and (orientation: portrait) {
    .tree-menu {
      display: block;
    }

    .book-column-nt {
      background: none;
      border-left: none;
      border-top: 8px solid #000; /* the OT/NT break, back where the split was */
    }

    .book-column-nt .book-column-body {
      justify-content: normal;
    }

    .chapters-container,
    .book-column-nt .chapters-container {
      position: static;
      width: fit-content;
      grid-template-columns: repeat(var(--chapter-columns, 7), 40px);
      justify-content: start;
      border: none;
      box-shadow: none;
    }
  }
</style>
