<script lang="ts">
  import {
    navigationStore,
    availableTranslations,
    canGoBack,
    historyDepth,
    navTrail,
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
    Anchor,
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
  import { getInterlinearSettings, updateInterlinearSettings } from "../adapters/settings";
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
      ilPopLeft = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      ilPopTop = rect.bottom + 6;
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

  // Anchor sync: true when anchor is ON but a commentary window has drifted from global nav
  $: commentaryDrifted = ($navigationStore.commentaryAnchored === true) &&
    $windowStore.some(w =>
      w.contentType === 'commentaries' &&
      w.contentState?.book !== undefined &&
      (w.contentState.book !== $navigationStore.book || w.contentState.chapter !== $navigationStore.chapter)
    );

  function handleAnchorClick(event: MouseEvent) {
    event.stopPropagation();
    const anchored = $navigationStore.commentaryAnchored ?? false;
    if (!anchored) {
      // OFF Ã¢â€ â€™ ON/Synced: enable anchor, clear per-window pins so windows fall back to global nav
      navigationStore.setCommentaryAnchored(true);
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: undefined, chapter: undefined, highlightedVerse: undefined });
        }
      }
    } else if (commentaryDrifted) {
      // ON/Drifted Ã¢â€ â€™ ON/Synced: re-sync, anchor stays ON
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: undefined, chapter: undefined, highlightedVerse: undefined });
        }
      }
    } else {
      // ON/Synced Ã¢â€ â€™ OFF: freeze commentary windows at current position
      navigationStore.setCommentaryAnchored(false);
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: $navigationStore.book, chapter: $navigationStore.chapter });
        }
      }
    }
  }

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
              const dropdownRect = dropdown.getBoundingClientRect();
              const bookRect = currentBookItem.getBoundingClientRect();
              dropdown.scrollTop = bookRect.top - dropdownRect.top + dropdown.scrollTop;
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
          const dropdownRect = dropdown.getBoundingClientRect();
          const bookRect = bookItem.getBoundingClientRect();
          
          // Calculate how much to scroll to put the book at the top of the dropdown
          const scrollOffset = bookRect.top - dropdownRect.top + dropdown.scrollTop;
          dropdown.scrollTop = scrollOffset;
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
            const mainContent = document.querySelector('.main-content') as HTMLElement;
            const leftOffset = mainContent?.getBoundingClientRect().left || 0;
            const rect = searchContainerRef.getBoundingClientRect();
            dropdown.style.left = `${rect.left - leftOffset}px`;
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.width = `${Math.min(rect.width, window.innerWidth - 20)}px`;
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

  /**
   * Black or white label for a filled pill, whichever the category colour can
   * carry. Major Prophets is a deep purple and Eschaton a pale cyan, so a
   * single hardcoded ink would be unreadable on one or the other.
   */
  function inkOn(hex: string): string {
    const m = (hex || "").replace("#", "");
    if (m.length < 6) return "#fff";
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    // Rec. 601 luma — close enough for a two-way choice.
    return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#111" : "#fff";
  }

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
    navigationStore.goToDepth(depth);
    if (ret && get(historyDepth) < ret.depth) isbeReturnStore.set(null);
    else if (ret && get(historyDepth) === ret.depth) isbeModalStore.open(ret.modal);
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
      // Leave a crumb before moving. Search used to navigate without one, so
      // following a result stranded you with no way back and the query gone.
      navigationStore.pushHistory(get(navigationStore), 'search');
      navigationStore.navigateTo(target, book, chapter, verse);
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

  onMount(() => {
    document.addEventListener("click", closeDropdowns);
    window.addEventListener("resize", updateDropdownPositions);
    window.addEventListener("settingsUpdated", onSettingsUpdated);
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);
    window.removeEventListener("resize", updateDropdownPositions);
    window.removeEventListener("settingsUpdated", onSettingsUpdated);
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

<div class="navigation-bar" {style} bind:this={navElement}>
  <div class="nav-content">

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
          style="--home-color: {getBookColor($navigationStore.book)}; --home-ink: {inkOn(getBookColor($navigationStore.book))};"
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
        {#if currentCommAuthors.length > 0}
          <span class="comm-count">{currentCommAuthors.length}</span>
        {/if}
        {#if commDropdownOpen}
          <CaretUp size={10} weight="bold" />
        {:else}
          <CaretDown size={10} weight="bold" />
        {/if}
      </button>

      {#if !isMinimal}
      <div class="pill-divider"></div>

      <button
        class="pill-btn pill-anchor"
        class:anchored={($navigationStore.commentaryAnchored ?? false) && !commentaryDrifted}
        class:drifted={commentaryDrifted}
        on:click={handleAnchorClick}
        title={commentaryDrifted
          ? 'Commentary drifted Ã¢â‚¬â€ click to re-sync'
          : ($navigationStore.commentaryAnchored ?? false)
            ? 'Commentary synced Ã¢â‚¬â€ click to unlock'
            : 'Sync commentary to Bible position'}
        aria-label="Commentary anchor sync"
      >
        <span class="icon-badge icon-badge-anchor"><Anchor size={18} weight="bold" /><span class="icon-overlay"><Anchor size={18} weight="thin" /></span></span>
      </button>
      {/if}
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
    <div class="search-results-dropdown">
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
  .navigation-bar {
    background: #252525;
    border-bottom: 1px solid #323232;
    position: sticky;
    top: 0;
    z-index: 1000;
    box-sizing: border-box;
    overflow: visible;
  }

  .nav-content {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
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

  /* Anchor states */
  .icon-badge-anchor { background: radial-gradient(circle, #9ca3af 0%, #9ca3af 20%, #000000 100%); }
  .pill-anchor.anchored .icon-badge-anchor { background: radial-gradient(circle, #2dd4bf 0%, #2dd4bf 20%, #000000 100%); }
  .pill-anchor.drifted .icon-badge-anchor {
    background: radial-gradient(circle, #fde047 0%, #fde047 20%, #000000 100%);
    animation: anchor-drift 2s ease-in-out infinite;
  }

  @keyframes anchor-drift {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* Reference button category colors (text tint only) */
  /* ── Home vs away ──────────────────────────────────────────────────────
     Home is a filled pill: you chose this chapter, you are settled. Away is
     the same pill hollow, with the trail of crumbs to its left. The colour
     comes from the book's category either way, so only the treatment changes.
     Declared before the per-category colour rules so those still set the text
     colour when away. */
  .pill-btn-reference.at-home {
    background: var(--home-color, #8a8f98);
    border-radius: 999px;
    padding: 0 10px;
    /* The category colour is the fill now, so the label has to stop using it. */
    color: var(--home-ink, #111) !important;
    font-weight: 700;
  }

  .crumb-btn {
    flex: 0 0 auto;
    gap: 3px;
    opacity: 0.85;
  }

  .crumb-btn:hover {
    opacity: 1;
  }

  /* Chevrons between crumbs — quiet enough to read as punctuation. */
  .crumb-sep {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    opacity: 0.35;
    margin: 0 -1px;
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

  .comm-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    background: radial-gradient(circle, #667eea 0%, #667eea 20%, #000000 100%);
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
  }

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
      padding: 8px 10px;
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
