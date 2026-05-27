<script lang="ts">
  import {
    navigationStore,
    availableTranslations,
    canGoBack,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS, normalizeBookName } from "../lib/bibleData";
  import { onMount, onDestroy, tick } from "svelte";
  import {
    searchService,
    type SearchCategory,
  } from "../lib/services/searchService";
  import {
    searchQuery as searchQueryStore,
    triggerSearch,
  } from "../stores/searchStore";
  import PowerSearchModal from "./PowerSearchModal.svelte";
  import { profileModalStore } from "../stores/profileModalStore";
  import { readingPlanModalStore } from "../stores/readingPlanModalStore";
  import { paneStore } from "../stores/paneStore";
  import { userProfileStore } from "../stores/userProfileStore";
  import { COMMENTARY_AUTHORS } from "../lib/annotationConfig";
  import {
    ArrowLeft,
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
    SpinnerGap,
    Sun,
  } from "phosphor-svelte";
  import { openDailyGreeting } from "../stores/dailyGreetingStore";

  export let windowId: string | undefined = undefined;
  export const visible: boolean = true;
  export let style: string = "";

  let translationDropdownOpen = false;
  let referenceDropdownOpen = false;
  let commDropdownOpen = false;
  let expandedBooks = new Set<string>();
  let expandedSearchBooks = new Set<string>();
  let searchQuery = "";
  let searchFocused = false;
  let blurTimeout: number | undefined;
  let searchResults: SearchCategory[] = [];
  let showResults = false;
  let isSearching = false;
  let expandedTranslations = new Set<string>();
  let totalResultCount = 0;
  let displayedResultCount = 0;
  let showingAll = false;
  let showPowerSearchModal = false;
  let searchExpanded = false;

  // Refs for dropdown positioning
  let translationButtonRef: HTMLElement;
  let referenceButtonRef: HTMLElement;
  let commButtonRef: HTMLElement;
  let searchContainerRef: HTMLElement;

  // Whether the dropdown has been positioned — controls visibility (hidden until JS places it)
  let translationDropdownPositioned = false;
  let referenceDropdownPositioned = false;
  let commDropdownPositioned = false;

  // Scroll nav-content instantly so the button is visible before we measure its position
  function scrollToShowButton(buttonRef: HTMLElement): void {
    const navContent = document.querySelector('.nav-content') as HTMLElement;
    if (!navContent || !buttonRef) return;
    const navContentRect = navContent.getBoundingClientRect();
    const buttonRect = buttonRef.getBoundingClientRect();
    const buttonOffsetFromNavLeft = buttonRect.left - navContentRect.left;
    const targetScroll = navContent.scrollLeft + buttonOffsetFromNavLeft - 12;
    // Direct assignment = instant, no animation, no polling needed
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
  $: currentTranslation =
    windowState?.contentState?.translation ?? $navigationStore.translation;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentReference = `${currentBook} ${currentChapter}`;
  $: isSignedIn = $userProfileStore.isSignedIn;
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
      // OFF → ON/Synced: enable anchor, clear per-window pins so windows fall back to global nav
      navigationStore.setCommentaryAnchored(true);
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: undefined, chapter: undefined, highlightedVerse: undefined });
        }
      }
    } else if (commentaryDrifted) {
      // ON/Drifted → ON/Synced: re-sync, anchor stays ON
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: undefined, chapter: undefined, highlightedVerse: undefined });
        }
      }
    } else {
      // ON/Synced → OFF: freeze commentary windows at current position
      navigationStore.setCommentaryAnchored(false);
      for (const w of $windowStore) {
        if (w.contentType === 'commentaries') {
          windowStore.updateContentState(w.id, { book: $navigationStore.book, chapter: $navigationStore.chapter });
        }
      }
    }
  }

  function toggleCommAuthor(author: string) {
    const current = $navigationStore.selectedCommentaryAuthors ?? [];
    const next = current.includes(author)
      ? current.filter(a => a !== author)
      : [...current, author];
    navigationStore.setSelectedCommentaryAuthors(next);
  }

  async function toggleCommDropdown(event: MouseEvent) {
    event.stopPropagation();
    const opening = !commDropdownOpen;

    if (!opening) {
      commDropdownOpen = false;
      commDropdownPositioned = false;
      return;
    }

    commDropdownOpen = true;
    await tick();

    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.comm-dropdown') as HTMLElement;
      if (dropdown && commButtonRef) {
        const mainContent = document.querySelector('.main-content') as HTMLElement;
        const leftOffset = mainContent?.getBoundingClientRect().left || 0;
        const rect = commButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - leftOffset;
        const clampedLeft = Math.max(4, Math.min(naturalLeft, window.innerWidth - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
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

    // Scroll nav instantly so button position is correct before we measure
    scrollToShowButton(translationButtonRef);
    translationDropdownOpen = true;
    await tick(); // let Svelte render the dropdown element

    requestAnimationFrame(() => {
      const dropdown = document.querySelector('.translation-dropdown') as HTMLElement;
      if (dropdown && translationButtonRef) {
        const mainContent = document.querySelector('.main-content') as HTMLElement;
        const leftOffset = mainContent?.getBoundingClientRect().left || 0;
        const rect = translationButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - leftOffset;
        // Clamp so the dropdown doesn't overflow the right edge of the viewport
        const clampedLeft = Math.max(4, Math.min(naturalLeft, window.innerWidth - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
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
        const mainContent = document.querySelector('.main-content') as HTMLElement;
        const leftOffset = mainContent?.getBoundingClientRect().left || 0;
        const rect = referenceButtonRef.getBoundingClientRect();
        const naturalLeft = rect.left - leftOffset;
        // Clamp so the dropdown doesn't overflow the right edge of the viewport
        const clampedLeft = Math.max(4, Math.min(naturalLeft, window.innerWidth - dropdown.offsetWidth - 4));
        dropdown.style.left = `${clampedLeft}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
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
    const newExpanded = new Set(expandedBooks);
    const isExpanding = !newExpanded.has(bookName);
    
    if (newExpanded.has(bookName)) {
      newExpanded.delete(bookName);
    } else {
      newExpanded.add(bookName);
    }
    expandedBooks = newExpanded;
    
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
      navigationStore.navigateTo(currentTranslation, bookName, chapter);
    }
    referenceDropdownOpen = false;
    expandedBooks = new Set();
  }

  function closeDropdowns(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      !target.closest(".nav-pill") &&
      !target.closest(".dropdown-menu") &&
      !target.closest(".pill-search-area") &&
      !target.closest(".search-results-dropdown")
    ) {
      translationDropdownOpen = false;
      referenceDropdownOpen = false;
      commDropdownOpen = false;
      translationDropdownPositioned = false;
      referenceDropdownPositioned = false;
      commDropdownPositioned = false;
      showResults = false;
    }
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
      searchResults = await searchService.search(searchQuery, limit);

      // Get total count
      totalResultCount = await searchService.getTotalCount(searchQuery);

      // Calculate displayed count from all categories
      displayedResultCount = searchResults.reduce(
        (sum, category) => sum + category.count,
        0,
      );
      showingAll = loadAll || displayedResultCount >= totalResultCount;

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

  function handleResultClick(result: any) {
    // Navigate to the result
    if (result.type === "verse" && result.data) {
      const { book, chapter } = result.data;
      const highlightVerse = result.data.verse ?? null;
      if (windowId) {
        windowStore.updateContentState(windowId, {
          translation: currentTranslation,
          book,
          chapter,
          highlightedVerse: highlightVerse,
        });
      } else {
        navigationStore.navigateTo(
          currentTranslation,
          book,
          chapter,
          highlightVerse,
        );
      }
      // Close search results
      showResults = false;
      searchQuery = "";
      searchResults = [];
    }
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

  function toggleTranslation(translationId: string) {
    const newExpanded = new Set(expandedTranslations);
    if (newExpanded.has(translationId)) {
      newExpanded.delete(translationId);
    } else {
      newExpanded.add(translationId);
    }
    expandedTranslations = newExpanded;
  }

  function toggleSearchBook(translationId: string, bookName: string) {
    const key = `${translationId}::${bookName}`;
    const newExpanded = new Set(expandedSearchBooks);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    expandedSearchBooks = newExpanded;
  }

  // Group results by translation
  $: resultsByTranslation = searchResults.reduce(
    (acc, category) => {
      if (category.name === "Verses") {
        category.results.forEach((result) => {
          const translationId = result.data.translation || "Unknown";
          if (!acc[translationId]) {
            acc[translationId] = [];
          }
          acc[translationId].push(result);
        });
      }
      return acc;
    },
    {} as Record<string, any[]>,
  );

  // Group results by translation then by book (canonical order)
  const bookOrderMap = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
  $: resultsByTranslationAndBook = Object.fromEntries(
    Object.entries(resultsByTranslation).map(([translationId, results]) => {
      const byBook: Record<string, any[]> = {};
      results.forEach((result) => {
        const book = normalizeBookName(result.data.book || "Unknown");
        if (!byBook[book]) byBook[book] = [];
        byBook[book].push(result);
      });
      const sortedEntries = Object.entries(byBook).sort(([a], [b]) => {
        return (bookOrderMap.get(a) ?? 999) - (bookOrderMap.get(b) ?? 999);
      });
      return [translationId, sortedEntries];
    })
  );

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
    const mainContent = document.querySelector('.main-content') as HTMLElement;
    const leftOffset = mainContent?.getBoundingClientRect().left || 0;
    
    if (translationDropdownOpen) {
      const dropdown = document.querySelector(
        ".translation-dropdown",
      ) as HTMLElement;
      if (dropdown && translationButtonRef) {
        const rect = translationButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - leftOffset}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.width = `${Math.max(rect.width, 200)}px`;
      }
    }
    if (referenceDropdownOpen && referenceDropdownPositioned) {
      const dropdown = document.querySelector(
        ".reference-dropdown",
      ) as HTMLElement;
      if (dropdown && referenceButtonRef) {
        const rect = referenceButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - leftOffset}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
        // No width override — reference dropdown uses CSS fit-content based on chapter grid
      }
    }
    if (commDropdownOpen && commDropdownPositioned) {
      const dropdown = document.querySelector('.comm-dropdown') as HTMLElement;
      if (dropdown && commButtonRef) {
        const rect = commButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - leftOffset}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
      }
    }
    if (showResults) {
      const dropdown = document.querySelector(
        ".search-results-dropdown",
      ) as HTMLElement;
      if (dropdown && searchContainerRef) {
        const rect = searchContainerRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left - leftOffset}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.width = `${Math.min(rect.width, window.innerWidth - 20)}px`;
      }
    }
  }

  onMount(() => {
    document.addEventListener("click", closeDropdowns);
    window.addEventListener("resize", updateDropdownPositions);
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);
    window.removeEventListener("resize", updateDropdownPositions);
  });
</script>

<div class="navigation-bar" {style}>
  <div class="nav-content">

    <!-- ── Pill 1: Navigation ─────────────────────────────── -->
    <div class="nav-pill nav-pill-nav">
      {#if $canGoBack}
        <button
          class="pill-btn"
          on:click={() => navigationStore.goBack()}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={16} weight="duotone" />
        </button>
        <div class="pill-divider"></div>
      {/if}

      <!-- Translation -->
      <div class="nav-dropdown translation-dropdown-trigger">
        <button
          bind:this={translationButtonRef}
          class="pill-btn pill-btn-text"
          on:click={toggleTranslationDropdown}
          class:active={translationDropdownOpen}
        >
          <span class="pill-label">{currentTranslation}</span>
          {#if translationDropdownOpen}
            <CaretUp size={10} weight="bold" />
          {:else}
            <CaretDown size={10} weight="bold" />
          {/if}
        </button>
      </div>

      <div class="pill-divider"></div>

      <!-- Reference (book + chapter) -->
      <div class="nav-dropdown reference-dropdown-trigger category-{currentBookCategory}">
        <button
          bind:this={referenceButtonRef}
          class="pill-btn pill-btn-text pill-btn-reference"
          on:click={toggleReferenceDropdown}
          class:active={referenceDropdownOpen}
        >
          <span class="pill-label">{currentReference}</span>
          {#if referenceDropdownOpen}
            <CaretUp size={10} weight="bold" />
          {:else}
            <CaretDown size={10} weight="bold" />
          {/if}
        </button>
      </div>

      <div class="pill-divider"></div>

      <label
        class="pill-btn pill-toggle pill-refs"
        title="Show TSK cross-reference markers on verse keywords"
      >
        <input
          type="checkbox"
          checked={$navigationStore.showReferences ?? false}
          on:change={(e) => navigationStore.setShowReferences(e.currentTarget.checked)}
        />
        <span class="icon-badge icon-badge-refs"><Graph size={15} weight="bold" /><span class="icon-overlay"><Graph size={15} weight="thin" /></span></span>
      </label>

      <div class="pill-divider"></div>

      <button
        bind:this={commButtonRef}
        class="pill-btn pill-btn-text pill-comm"
        class:active={commDropdownOpen}
        class:has-selection={($navigationStore.selectedCommentaryAuthors?.length ?? 0) > 0}
        on:click={toggleCommDropdown}
        title="Filter commentary authors"
      >
        <span class="icon-badge icon-badge-comm"><ChatText size={15} weight="bold" /><span class="icon-overlay"><ChatText size={15} weight="thin" /></span></span>
        {#if ($navigationStore.selectedCommentaryAuthors?.length ?? 0) > 0}
          <span class="comm-count">{$navigationStore.selectedCommentaryAuthors?.length}</span>
        {/if}
        {#if commDropdownOpen}
          <CaretUp size={10} weight="bold" />
        {:else}
          <CaretDown size={10} weight="bold" />
        {/if}
      </button>

      <div class="pill-divider"></div>

      <button
        class="pill-btn pill-anchor"
        class:anchored={($navigationStore.commentaryAnchored ?? false) && !commentaryDrifted}
        class:drifted={commentaryDrifted}
        on:click={handleAnchorClick}
        title={commentaryDrifted
          ? 'Commentary drifted — click to re-sync'
          : ($navigationStore.commentaryAnchored ?? false)
            ? 'Commentary synced — click to unlock'
            : 'Sync commentary to Bible position'}
        aria-label="Commentary anchor sync"
      >
        <span class="icon-badge icon-badge-anchor"><Anchor size={15} weight="bold" /><span class="icon-overlay"><Anchor size={15} weight="thin" /></span></span>
      </button>
    </div>

    <!-- ── Pill 2: Tools ──────────────────────────────────── -->
    <div class="nav-pill nav-pill-tools">
      <!-- Search (icon at rest → expands on click) -->
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
          <span class="icon-badge icon-badge-search"><MagnifyingGlass size={16} weight="bold" /><span class="icon-overlay"><MagnifyingGlass size={16} weight="thin" /></span></span>
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
                <SpinnerGap size={14} weight="duotone" />
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
        title="Advanced search — regex, proximity, biblical filters"
        aria-label="Advanced search"
      >
        <span class="icon-badge icon-badge-powersearch"><Microscope size={16} weight="bold" /><span class="icon-overlay"><Microscope size={16} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Reading Plan -->
      <button
        class="pill-btn pill-readingplan"
        on:click={() => readingPlanModalStore.open()}
        title="Reading plan"
        aria-label="Reading plan"
      >
        <span class="icon-badge icon-badge-readingplan"><BookOpenText size={16} weight="bold" /><span class="icon-overlay"><BookOpenText size={16} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Daily Greeting / Verse of the Day -->
      <button
        class="pill-btn pill-votd"
        on:click={openDailyGreeting}
        title="Verse of the day"
        aria-label="Verse of the day"
      >
        <span class="icon-badge icon-badge-votd"><Sun size={16} weight="bold" /><span class="icon-overlay"><Sun size={16} weight="thin" /></span></span>
      </button>

      <div class="pill-divider"></div>

      <!-- Settings -->
      <button
        class="pill-btn pill-settings"
        on:click={openSettings}
        title="Settings"
        aria-label="Open settings"
      >
        <span class="icon-badge icon-badge-settings"><Gear size={16} weight="bold" /><span class="icon-overlay"><Gear size={16} weight="thin" /></span></span>
      </button>

      <!-- Profile -->
      <button
        class="pill-btn pill-profile"
        class:signed-in={isSignedIn}
        on:click={() => profileModalStore.open()}
        title="Profile"
        aria-label="Open profile"
      >
        <span class="icon-badge icon-badge-profile"><User size={16} weight="bold" /><span class="icon-overlay"><User size={16} weight="thin" /></span></span>
      </button>
    </div>

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

      {#if searchResults.length > 0 && Object.keys(resultsByTranslation).length > 0}
        {#each Object.entries(resultsByTranslation) as [translationId, results]}
          <div class="translation-group">
            <button
              class="translation-header"
              class:expanded={expandedTranslations.has(translationId)}
              on:click={() => toggleTranslation(translationId)}
            >
              <span class="expand-icon">
                {#if expandedTranslations.has(translationId)}<CaretDown size={10} weight="bold" />{:else}<CaretRight size={10} weight="bold" />{/if}
              </span>
              <span class="translation-name">{translationId}</span>
              <span class="result-count">({results.length})</span>
            </button>

            {#if expandedTranslations.has(translationId)}
              <div class="translation-results">
                {#each resultsByTranslationAndBook[translationId] as [bookName, bookResults]}
                  <div class="book-group">
                    <button
                      class="book-header"
                      class:expanded={expandedSearchBooks.has(`${translationId}::${bookName}`)}
                      on:click={() => toggleSearchBook(translationId, bookName)}
                    >
                      <span class="expand-icon">
                        {#if expandedSearchBooks.has(`${translationId}::${bookName}`)}<CaretDown size={9} weight="bold" />{:else}<CaretRight size={9} weight="bold" />{/if}
                      </span>
                      <span class="book-name">{bookName}</span>
                      <span class="result-count">({bookResults.length})</span>
                    </button>
                    {#if expandedSearchBooks.has(`${translationId}::${bookName}`)}
                      <div class="book-results">
                        {#each bookResults as result}
                          <button
                            class="search-result-item"
                            on:click={() => handleResultClick(result)}
                          >
                            <div class="result-title">{result.title}</div>
                            {#if result.subtitle}
                              <div class="result-subtitle">
                                {@html highlightText(result.subtitle, searchQuery)}
                              </div>
                            {/if}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
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
          {translation}
        </button>
      {/each}
    </div>
  {/if}

  {#if referenceDropdownOpen}
    <div class="dropdown-menu tree-menu reference-dropdown" class:positioned={referenceDropdownPositioned}>
      {#each BIBLE_BOOKS as book}
        <div 
          class="book-item category-{book.category} testament-{book.testament}"
          class:first-nt={book.name === 'Matthew'}
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
  {/if}

  {#if commDropdownOpen}
    <div class="dropdown-menu comm-dropdown" class:positioned={commDropdownPositioned}>
      {#each Object.entries(COMMENTARY_AUTHORS) as [key, cfg]}
        <label class="comm-author-row">
          <input
            type="checkbox"
            checked={($navigationStore.selectedCommentaryAuthors ?? []).includes(key)}
            on:change={() => toggleCommAuthor(key)}
          />
          <span class="comm-author-swatch" style="background:radial-gradient(circle, {cfg.color} 0%, {cfg.color} 20%, #431407 100%)">{cfg.initials}</span>
          <span class="comm-author-name">{cfg.fullName}</span>
        </label>
      {/each}
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
    overflow: visible;
    min-height: 58px;
    flex-wrap: nowrap;
  }

  /* ── Pill containers ───────────────────────────────────── */
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
    margin-left: auto;
  }

  .pill-divider {
    width: 1px;
    height: 16px;
    background: #353535;
    margin: 0 1px;
    flex-shrink: 0;
  }

  /* ── Pill buttons ──────────────────────────────────────── */
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
    background: rgba(102, 126, 234, 0.1);
    border-radius: 5px;
  }

  /* Anchor states */
  .icon-badge-anchor { background: radial-gradient(circle, #9ca3af 0%, #9ca3af 20%, #431407 100%); }
  .pill-anchor.anchored .icon-badge-anchor { background: radial-gradient(circle, #2dd4bf 0%, #2dd4bf 20%, #431407 100%); }
  .pill-anchor.drifted .icon-badge-anchor {
    background: radial-gradient(circle, #fde047 0%, #fde047 20%, #431407 100%);
    animation: anchor-drift 2s ease-in-out infinite;
  }

  @keyframes anchor-drift {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* Reference button category colors (text tint only) */
  .nav-dropdown.reference-dropdown-trigger.category-pentateuch .pill-btn-reference { color: #a67c52; }
  .nav-dropdown.reference-dropdown-trigger.category-historical .pill-btn-reference { color: #6496c8; }
  .nav-dropdown.reference-dropdown-trigger.category-wisdom .pill-btn-reference { color: #daa520; }
  .nav-dropdown.reference-dropdown-trigger.category-major-prophets .pill-btn-reference { color: #b44fe0; }
  .nav-dropdown.reference-dropdown-trigger.category-minor-prophets .pill-btn-reference { color: #ff8c00; }
  .nav-dropdown.reference-dropdown-trigger.category-gospels .pill-btn-reference { color: #4eab77; }
  .nav-dropdown.reference-dropdown-trigger.category-acts .pill-btn-reference { color: #ff6030; }
  .nav-dropdown.reference-dropdown-trigger.category-pauline .pill-btn-reference { color: #dc5070; }
  .nav-dropdown.reference-dropdown-trigger.category-general .pill-btn-reference { color: #d2691e; }
  .nav-dropdown.reference-dropdown-trigger.category-revelation .pill-btn-reference { color: #6080e0; }

  /* ── Icon badges (brown bold icon on radial gradient splash) ───────── */
  .icon-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    padding: 4px;
    line-height: 0;
    color: #431407;
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
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
  }
  .icon-badge-refs        { background: radial-gradient(circle, #9ca3af 0%, #9ca3af 20%, #431407 100%); }
  .icon-badge-comm        { background: radial-gradient(circle, #a3e635 0%, #a3e635 20%, #431407 100%); }
  .icon-badge-search      { background: radial-gradient(circle, #fb7185 0%, #fb7185 20%, #431407 100%); }
  .icon-badge-powersearch { background: radial-gradient(circle, #f97316 0%, #f97316 20%, #431407 100%); }
  .icon-badge-readingplan { background: radial-gradient(circle, #60a5fa 0%, #60a5fa 20%, #431407 100%); }
  .icon-badge-votd        { background: radial-gradient(circle, #fde047 0%, #fde047 20%, #431407 100%); }
  .icon-badge-settings    { background: radial-gradient(circle, #7dd3fc 0%, #7dd3fc 20%, #431407 100%); }
  .icon-badge-profile     { background: radial-gradient(circle, #d1d5db 0%, #d1d5db 20%, #431407 100%); }
  .pill-refs:has(input:checked) .icon-badge-refs { background: radial-gradient(circle, #a78bfa 0%, #a78bfa 20%, #431407 100%); }
  .pill-profile.signed-in .icon-badge-profile    { background: radial-gradient(circle, #86efac 0%, #86efac 20%, #431407 100%); }

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
    border-color: #667eea;
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

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .search-spinner-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    color: #4caf50;
    flex-shrink: 0;
    animation: spin 1s linear infinite;
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
    background: radial-gradient(circle, #667eea 0%, #667eea 20%, #431407 100%);
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
  }

  .comm-dropdown {
    min-width: 240px;
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
    overflow: hidden;
    text-overflow: ellipsis;
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
     right:auto cancels the right:0 inherited from .dropdown-menu — without it, fit-content
     is constrained to (viewport_width - left), which is too narrow on small screens. */
  .translation-dropdown,
  .reference-dropdown {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    visibility: hidden;
  }

  .translation-dropdown.positioned,
  .reference-dropdown.positioned {
    visibility: visible;
  }

  .tree-menu {
    max-height: 500px;
    width: fit-content;
    max-width: 90vw;
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
    border-bottom: 1px solid #3a3a3a;
  }

  .book-item:last-child {
    border-bottom: none;
  }

  /* Thick border between OT and NT */
  .book-item.first-nt {
    border-top: 12px solid #000;
    margin-top: 2px;
  }

  /* Category Colors — Radial Gradient Theme */
  /* Pentateuch — amber */
  .category-pentateuch .book-button { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-pentateuch .book-button:hover { background: radial-gradient(circle, #a67c52 0%, #a67c52 35%, #431407 100%); }
  .category-pentateuch .book-button.current { background: radial-gradient(circle, #a67c52 0%, #a67c52 50%, #431407 100%); font-weight: 500; }
  .category-pentateuch .chapters-container { background: radial-gradient(circle at top left, #a67c52 0%, #431407 60%); border: 1px solid #431407; }

  /* Historical — blue */
  .category-historical .book-button { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-historical .book-button:hover { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 35%, #431407 100%); }
  .category-historical .book-button.current { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 50%, #431407 100%); font-weight: 500; }
  .category-historical .chapters-container { background: radial-gradient(circle at top left, #6ca0dc 0%, #431407 60%); border: 1px solid #431407; }

  /* Wisdom — gold */
  .category-wisdom .book-button { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-wisdom .book-button:hover { background: radial-gradient(circle, #f0c040 0%, #f0c040 35%, #431407 100%); }
  .category-wisdom .book-button.current { background: radial-gradient(circle, #f0c040 0%, #f0c040 50%, #431407 100%); font-weight: 500; }
  .category-wisdom .chapters-container { background: radial-gradient(circle at top left, #f0c040 0%, #431407 60%); border: 1px solid #431407; }

  /* Major Prophets — purple */
  .category-major-prophets .book-button { background: radial-gradient(circle, #b420f3 0%, #b420f3 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-major-prophets .book-button:hover { background: radial-gradient(circle, #b420f3 0%, #b420f3 35%, #431407 100%); }
  .category-major-prophets .book-button.current { background: radial-gradient(circle, #b420f3 0%, #b420f3 50%, #431407 100%); font-weight: 500; }
  .category-major-prophets .chapters-container { background: radial-gradient(circle at top left, #b420f3 0%, #431407 60%); border: 1px solid #431407; }

  /* Minor Prophets — orange */
  .category-minor-prophets .book-button { background: radial-gradient(circle, #ffa520 0%, #ffa520 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-minor-prophets .book-button:hover { background: radial-gradient(circle, #ffa520 0%, #ffa520 35%, #431407 100%); }
  .category-minor-prophets .book-button.current { background: radial-gradient(circle, #ffa520 0%, #ffa520 50%, #431407 100%); font-weight: 500; }
  .category-minor-prophets .chapters-container { background: radial-gradient(circle at top left, #ffa520 0%, #431407 60%); border: 1px solid #431407; }

  /* Gospels — green */
  .category-gospels .book-button { background: radial-gradient(circle, #4eab77 0%, #4eab77 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-gospels .book-button:hover { background: radial-gradient(circle, #4eab77 0%, #4eab77 35%, #431407 100%); }
  .category-gospels .book-button.current { background: radial-gradient(circle, #4eab77 0%, #4eab77 50%, #431407 100%); font-weight: 500; }
  .category-gospels .chapters-container { background: radial-gradient(circle at top left, #4eab77 0%, #431407 60%); border: 1px solid #431407; }

  /* Acts — red-orange */
  .category-acts .book-button { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-acts .book-button:hover { background: radial-gradient(circle, #ff6520 0%, #ff6520 35%, #431407 100%); }
  .category-acts .book-button.current { background: radial-gradient(circle, #ff6520 0%, #ff6520 50%, #431407 100%); font-weight: 500; }
  .category-acts .chapters-container { background: radial-gradient(circle at top left, #ff6520 0%, #431407 60%); border: 1px solid #431407; }

  /* Pauline — crimson */
  .category-pauline .book-button { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-pauline .book-button:hover { background: radial-gradient(circle, #fc345c 0%, #fc345c 35%, #431407 100%); }
  .category-pauline .book-button.current { background: radial-gradient(circle, #fc345c 0%, #fc345c 50%, #431407 100%); font-weight: 500; }
  .category-pauline .chapters-container { background: radial-gradient(circle at top left, #fc345c 0%, #431407 60%); border: 1px solid #431407; }

  /* General — warm orange */
  .category-general .book-button { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-general .book-button:hover { background: radial-gradient(circle, #f2893e 0%, #f2893e 35%, #431407 100%); }
  .category-general .book-button.current { background: radial-gradient(circle, #f2893e 0%, #f2893e 50%, #431407 100%); font-weight: 500; }
  .category-general .chapters-container { background: radial-gradient(circle at top left, #f2893e 0%, #431407 60%); border: 1px solid #431407; }

  /* Revelation — royal blue */
  .category-revelation .book-button { background: radial-gradient(circle, #6189f1 0%, #6189f1 20%, #431407 100%); border: 1px solid #431407; color: white; }
  .category-revelation .book-button:hover { background: radial-gradient(circle, #6189f1 0%, #6189f1 35%, #431407 100%); }
  .category-revelation .book-button.current { background: radial-gradient(circle, #6189f1 0%, #6189f1 50%, #431407 100%); font-weight: 500; }
  .category-revelation .chapters-container { background: radial-gradient(circle at top left, #6189f1 0%, #431407 60%); border: 1px solid #431407; }

  .book-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: transparent;
    border: none;
    color: white;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 14px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .book-button:hover {
    background: #3a3a3a;
  }

  .book-button.current {
    background: rgba(102, 126, 234, 0.2);
    font-weight: 500;
  }

  .expand-icon {
    color: white;
    font-size: 10px;
    width: 12px;
    display: inline-block;
  }

  .book-name {
    flex: 1;
  }

  .chapters-container {
    display: grid;
    grid-template-columns: repeat(var(--chapter-columns, 7), 40px);
    gap: 6px;
    padding: 12px 14px 12px 34px;
    background: #1a1a1a;
    width: fit-content;
  }

  .chapter-button {
    padding: 8px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.15s;
    font-size: 13px;
    text-align: center;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .chapter-button:hover {
    background: #3a3a3a;
    border-color: #667eea;
  }

  .chapter-button.selected {
    background: #667eea;
    border-color: #667eea;
    color: white;
    font-weight: 600;
  }

  /* Category-specific chapter buttons */
  .category-pentateuch .chapter-button { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #431407 100%); border-color: #431407; color: white; }
  .category-pentateuch .chapter-button:hover { background: radial-gradient(circle, #a67c52 0%, #a67c52 35%, #431407 100%); border-color: #431407; }
  .category-pentateuch .chapter-button.selected { background: radial-gradient(circle, #a67c52 0%, #a67c52 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-historical .chapter-button { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #431407 100%); border-color: #431407; color: white; }
  .category-historical .chapter-button:hover { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 35%, #431407 100%); border-color: #431407; }
  .category-historical .chapter-button.selected { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-wisdom .chapter-button { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #431407 100%); border-color: #431407; color: white; }
  .category-wisdom .chapter-button:hover { background: radial-gradient(circle, #f0c040 0%, #f0c040 35%, #431407 100%); border-color: #431407; }
  .category-wisdom .chapter-button.selected { background: radial-gradient(circle, #f0c040 0%, #f0c040 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-major-prophets .chapter-button { background: radial-gradient(circle, #b420f3 0%, #b420f3 20%, #431407 100%); border-color: #431407; color: white; }
  .category-major-prophets .chapter-button:hover { background: radial-gradient(circle, #b420f3 0%, #b420f3 35%, #431407 100%); border-color: #431407; }
  .category-major-prophets .chapter-button.selected { background: radial-gradient(circle, #b420f3 0%, #b420f3 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-minor-prophets .chapter-button { background: radial-gradient(circle, #ffa520 0%, #ffa520 20%, #431407 100%); border-color: #431407; color: white; }
  .category-minor-prophets .chapter-button:hover { background: radial-gradient(circle, #ffa520 0%, #ffa520 35%, #431407 100%); border-color: #431407; }
  .category-minor-prophets .chapter-button.selected { background: radial-gradient(circle, #ffa520 0%, #ffa520 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-gospels .chapter-button { background: radial-gradient(circle, #4eab77 0%, #4eab77 20%, #431407 100%); border-color: #431407; color: white; }
  .category-gospels .chapter-button:hover { background: radial-gradient(circle, #4eab77 0%, #4eab77 35%, #431407 100%); border-color: #431407; }
  .category-gospels .chapter-button.selected { background: radial-gradient(circle, #4eab77 0%, #4eab77 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-acts .chapter-button { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #431407 100%); border-color: #431407; color: white; }
  .category-acts .chapter-button:hover { background: radial-gradient(circle, #ff6520 0%, #ff6520 35%, #431407 100%); border-color: #431407; }
  .category-acts .chapter-button.selected { background: radial-gradient(circle, #ff6520 0%, #ff6520 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-pauline .chapter-button { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #431407 100%); border-color: #431407; color: white; }
  .category-pauline .chapter-button:hover { background: radial-gradient(circle, #fc345c 0%, #fc345c 35%, #431407 100%); border-color: #431407; }
  .category-pauline .chapter-button.selected { background: radial-gradient(circle, #fc345c 0%, #fc345c 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-general .chapter-button { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #431407 100%); border-color: #431407; color: white; }
  .category-general .chapter-button:hover { background: radial-gradient(circle, #f2893e 0%, #f2893e 35%, #431407 100%); border-color: #431407; }
  .category-general .chapter-button.selected { background: radial-gradient(circle, #f2893e 0%, #f2893e 55%, #431407 100%); border-color: #431407; font-weight: 600; }

  .category-revelation .chapter-button { background: radial-gradient(circle, #6189f1 0%, #6189f1 20%, #431407 100%); border-color: #431407; color: white; }
  .category-revelation .chapter-button:hover { background: radial-gradient(circle, #6189f1 0%, #6189f1 35%, #431407 100%); border-color: #431407; }
  .category-revelation .chapter-button.selected { background: radial-gradient(circle, #6189f1 0%, #6189f1 55%, #431407 100%); border-color: #431407; font-weight: 600; }

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

  .translation-group {
    border-bottom: 1px solid #3a3a3a;
  }

  .translation-group:last-child {
    border-bottom: none;
  }

  .translation-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: #1a1a1a;
    border: none;
    color: #e0e0e0;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 14px;
    font-weight: 600;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .translation-header:hover {
    background: #252525;
  }

  .translation-name {
    flex: 1;
    color: #667eea;
  }

  .result-count {
    color: #888;
    font-size: 12px;
    font-weight: 500;
  }

  .translation-results {
    background: #222;
  }

  .book-group {
    border-bottom: 1px solid #2a2a2a;
  }

  .book-group:last-child {
    border-bottom: none;
  }

  .book-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px 9px 28px;
    background: #1e1e1e;
    border: none;
    color: #c8c8c8;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 13px;
    font-weight: 500;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.15);
  }

  .book-header:hover {
    background: #272727;
  }

  .book-name {
    flex: 1;
    color: #a0b4f0;
  }

  .book-results {
    background: #222;
  }

  .search-result-item {
    width: 100%;
    padding: 12px 14px;
    background: transparent;
    border: none;
    color: #e0e0e0;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid #2a2a2a;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .search-result-item:last-child {
    border-bottom: none;
  }

  .search-result-item:hover {
    background: #3a3a3a;
  }

  .result-title {
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 14px;
  }

  .result-subtitle {
    font-size: 13px;
    color: #aaa;
    line-height: 1.4;
  }

  .result-subtitle :global(mark) {
    background: #667eea;
    color: #fff;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 600;
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



  /* Mobile — pills stack or shrink on small screens */
  @media (max-width: 600px) {
    .nav-content {
      padding: 8px 10px;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .nav-content::-webkit-scrollbar {
      display: none;
    }

    .nav-pill-tools {
      margin-left: 0;
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
</style>
