<script lang="ts">
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS } from "../lib/bibleData";
  import { onMount, onDestroy } from "svelte";
  import {
    searchService,
    type SearchCategory,
  } from "../lib/services/searchService";
  import {
    searchQuery as searchQueryStore,
    triggerSearch,
  } from "../stores/searchStore";
  import PowerSearchModal from "./PowerSearchModal.svelte";
  import ReadingPlanModal from "./ReadingPlanModal.svelte";
  import { paneStore } from "../stores/paneStore";

  export let windowId: string | undefined = undefined;
  export let visible: boolean = true;
  export let style: string = "";

  let translationDropdownOpen = false;
  let referenceDropdownOpen = false;
  let expandedBooks = new Set<string>();
  let isChronologicalMode = false;
  let pendingChronologicalMode = false;
  let searchQuery = "";
  let searchFocused = false;
  let blurTimeout: number | undefined;
  let searchResults: SearchCategory[] = [];
  let showResults = false;
  let isSearching = false;
  let searchTimeout: ReturnType<typeof setTimeout>;
  let expandedTranslations = new Set<string>();
  let totalResultCount = 0;
  let displayedResultCount = 0;
  let showingAll = false;
  let showPowerSearchModal = false;
  let showReadingPlanModal = false;

  // Refs for positioning dropdowns on mobile
  let translationButtonRef: HTMLElement;
  let referenceButtonRef: HTMLElement;
  let searchContainerRef: HTMLElement;

  // Listen for external search triggers
  $: if ($triggerSearch > 0) {
    searchQuery = $searchQueryStore;
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

  // Initialize from store but don't auto-sync
  $: if (
    $navigationStore.isChronologicalMode !== undefined &&
    isChronologicalMode === false &&
    pendingChronologicalMode === false
  ) {
    isChronologicalMode = $navigationStore.isChronologicalMode;
    pendingChronologicalMode = $navigationStore.isChronologicalMode;
  }

  function updateChronologicalMode() {
    isChronologicalMode = pendingChronologicalMode;
    navigationStore.setChronologicalMode(pendingChronologicalMode);
  }

  function toggleTranslationDropdown(event: MouseEvent) {
    event.stopPropagation();
    translationDropdownOpen = !translationDropdownOpen;
    if (translationDropdownOpen) {
      referenceDropdownOpen = false;
      // Position dropdown on mobile
      if (window.innerWidth <= 768 && translationButtonRef) {
        requestAnimationFrame(() => {
          const rect = translationButtonRef.getBoundingClientRect();
          const dropdown =
            translationButtonRef.nextElementSibling as HTMLElement;
          if (dropdown) {
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.width = `${Math.max(rect.width, 200)}px`;
          }
        });
      }
    }
  }

  function toggleReferenceDropdown(event: MouseEvent) {
    event.stopPropagation();
    referenceDropdownOpen = !referenceDropdownOpen;
    if (referenceDropdownOpen) {
      translationDropdownOpen = false;
      // Position dropdown on mobile
      if (window.innerWidth <= 768 && referenceButtonRef) {
        requestAnimationFrame(() => {
          const rect = referenceButtonRef.getBoundingClientRect();
          const dropdown = referenceButtonRef.nextElementSibling as HTMLElement;
          if (dropdown) {
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.top = `${rect.bottom + 4}px`;
            dropdown.style.width = `${Math.max(rect.width, 250)}px`;
          }
        });
      }
    }
  }

  function selectTranslation(translation: string) {
    if (windowId) {
      windowStore.updateContentState(windowId, { translation });
    } else {
      navigationStore.setTranslation(translation);
    }
    translationDropdownOpen = false;
  }

  function toggleBook(bookName: string) {
    const newExpanded = new Set(expandedBooks);
    if (newExpanded.has(bookName)) {
      newExpanded.delete(bookName);
    } else {
      newExpanded.add(bookName);
    }
    expandedBooks = newExpanded;
  }

  function selectChapter(bookName: string, chapter: number) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        translation: currentTranslation,
        book: bookName,
        chapter,
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
      !target.closest(".nav-dropdown") &&
      !target.closest(".search-container")
    ) {
      translationDropdownOpen = false;
      referenceDropdownOpen = false;
      showResults = false;
    }
  }

  function handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;

    // Debounce search
    clearTimeout(searchTimeout);
    if (searchQuery.trim()) {
      searchTimeout = setTimeout(async () => {
        await performSearch();
      }, 300);
    } else {
      searchResults = [];
      showResults = false;
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && searchQuery.trim()) {
      performSearch();
    } else if (event.key === "Escape") {
      showResults = false;
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

      // Position search results dropdown on mobile
      if (window.innerWidth <= 768 && searchContainerRef) {
        requestAnimationFrame(() => {
          const rect = searchContainerRef.getBoundingClientRect();
          const dropdown = searchContainerRef.querySelector(
            ".search-results-dropdown",
          ) as HTMLElement;
          if (dropdown) {
            dropdown.style.left = `${rect.left}px`;
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
      if (windowId) {
        windowStore.updateContentState(windowId, {
          translation: currentTranslation,
          book,
          chapter,
        });
      } else {
        navigationStore.navigateTo(currentTranslation, book, chapter);
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

  function clearSearch() {
    searchQuery = "";
    searchResults = [];
    showResults = false;
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
    }, 100);
  }

  function openSettings() {
    paneStore.openPane("settings", "right");
  }

  onMount(() => {
    document.addEventListener("click", closeDropdowns);
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);
  });
</script>

<div class="navigation-bar" {style}>
  <div class="nav-content">
  <!-- Translation Dropdown -->
  <div class="nav-dropdown">
    <button
      bind:this={translationButtonRef}
      class="nav-button"
      on:click={toggleTranslationDropdown}
      class:active={translationDropdownOpen}
    >
      <span class="nav-label">Translation:</span>
      <span class="nav-value">{currentTranslation}</span>
      <span class="nav-arrow">{translationDropdownOpen ? "▲" : "▼"}</span>
    </button>

    {#if translationDropdownOpen}
      <div class="dropdown-menu">
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
  </div>

  <!-- Chronological Mode Checkbox -->
  <div class="nav-checkbox">
    <label>
      <input type="checkbox" bind:checked={pendingChronologicalMode} />
      Chronological?
    </label>
    <button class="update-btn" on:click={updateChronologicalMode}>Update</button
    >
  </div>

  <!-- Reading Plan Button -->
  <button
    class="reading-plan-button"
    on:click={() => (showReadingPlanModal = true)}
    title="Open reading plan"
  >
    📖 Reading Plan
  </button>

  <!-- Reference Dropdown (Tree Structure) -->
  <div class="nav-dropdown">
    <button
      bind:this={referenceButtonRef}
      class="nav-button"
      on:click={toggleReferenceDropdown}
      class:active={referenceDropdownOpen}
    >
      <span class="nav-label">Reference:</span>
      <span class="nav-value">{currentReference}</span>
      <span class="nav-arrow">{referenceDropdownOpen ? "▲" : "▼"}</span>
    </button>

    {#if referenceDropdownOpen}
      <div class="dropdown-menu tree-menu">
        {#each BIBLE_BOOKS as book}
          <div class="book-item">
            <button
              class="book-button"
              class:expanded={expandedBooks.has(book.name)}
              class:current={book.name === currentBook}
              on:click={() => toggleBook(book.name)}
            >
              <span class="expand-icon">
                {expandedBooks.has(book.name) ? "▼" : "▶"}
              </span>
              <span class="book-name">{book.name}</span>
            </button>

            {#if expandedBooks.has(book.name)}
              <div class="chapters-container">
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
  </div>

  <!-- Search Bar -->
  <div
    bind:this={searchContainerRef}
    class="search-container"
    on:click|stopPropagation
    role="search"
  >
    <div class="search-input-wrapper" class:focused={searchFocused}>
      <span class="search-icon">🔍</span>
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
        <span class="search-spinner">⏳</span>
      {:else if searchQuery}
        <button
          class="clear-search"
          on:mousedown|preventDefault={clearSearch}
          title="Clear search"
        >
          ✕
        </button>
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

        {#if searchResults.length > 0 && Object.keys(resultsByTranslation).length > 0}
          {#each Object.entries(resultsByTranslation) as [translationId, results]}
            <div class="translation-group">
              <button
                class="translation-header"
                class:expanded={expandedTranslations.has(translationId)}
                on:click={() => toggleTranslation(translationId)}
              >
                <span class="expand-icon">
                  {expandedTranslations.has(translationId) ? "▼" : "▶"}
                </span>
                <span class="translation-name">{translationId}</span>
                <span class="result-count">({results.length})</span>
              </button>

              {#if expandedTranslations.has(translationId)}
                <div class="translation-results">
                  {#each results as result}
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
        {:else}
          <div class="no-search-results">
            No results found for "{searchQuery}"
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Search Buttons -->
  <button
    class="search-button"
    on:click={() => performSearch()}
    disabled={!searchQuery.trim()}
  >
    Search
  </button>
  <button
    class="power-search-button"
    on:click={() => (showPowerSearchModal = true)}
    title="Advanced search with regex, proximity, and biblical filters"
  >
    ⚡ Power
  </button>

  <!-- Settings Button -->
  <button
    class="settings-button"
    on:click={openSettings}
    title="Settings"
    aria-label="Open settings"
  >
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
  </div>
</div>

<!-- Power Search Modal -->
<PowerSearchModal bind:show={showPowerSearchModal} />

<!-- Reading Plan Modal -->
<ReadingPlanModal bind:isOpen={showReadingPlanModal} />

<style>
  .navigation-bar {
    background: #2a2a2a;
    border-bottom: 1px solid #3a3a3a;
    position: sticky;
    top: 0;
    z-index: 1000;
    min-height: 68px;
    box-sizing: border-box;
    overflow: visible; /* Allow dropdowns to escape */
  }

  .nav-content {
    display: flex;
    gap: 12px;
    padding: 12px 20px;
    touch-action: manipulation; /* Allow fast taps */
    flex-wrap: nowrap; /* Prevent wrapping on all screen sizes */
    overflow-x: auto; /* Enable horizontal scrolling */
    overflow-y: visible;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }

  .nav-content::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

  .nav-dropdown {
    position: relative;
    flex: 1;
    max-width: 280px;
  }

  .nav-checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 14px;
    white-space: nowrap;
  }

  .nav-checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    margin: 0;
  }

  .nav-checkbox input[type="checkbox"] {
    cursor: pointer;
  }

  .update-btn {
    padding: 4px 12px;
    background: #667eea;
    border: 1px solid #667eea;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.4);
  }

  .update-btn:hover {
    background: #5568d3;
    border-color: #5568d3;
  }

  .nav-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 14px;
    touch-action: manipulation; /* Allow fast taps */
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .nav-button:hover {
    background: #252525;
    border-color: #4a4a4a;
  }

  .nav-button.active {
    background: #252525;
    border-color: #667eea;
  }

  .nav-label {
    color: #888;
    font-size: 12px;
  }

  .nav-value {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }

  .nav-arrow {
    color: #667eea;
    font-size: 10px;
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

  .tree-menu {
    max-height: 500px;
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

  .book-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
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

  .book-button:hover {
    background: #3a3a3a;
  }

  .book-button.current {
    background: rgba(102, 126, 234, 0.2);
    font-weight: 500;
  }

  .expand-icon {
    color: #667eea;
    font-size: 10px;
    width: 12px;
    display: inline-block;
  }

  .book-name {
    flex: 1;
  }

  .chapters-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 6px;
    padding: 12px 14px 12px 34px;
    background: #1a1a1a;
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

  /* Search Bar Styles */
  .search-container {
    flex-shrink: 0;
    max-width: 400px;
    min-width: 200px;
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .search-input-wrapper.focused {
    border-color: #667eea;
    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
  }

  .search-icon {
    padding: 0 12px;
    color: #888;
    font-size: 14px;
    pointer-events: none;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    padding: 10px 12px 10px 0;
    background: transparent;
    border: none;
    color: #e0e0e0;
    font-size: 14px;
    outline: none;
  }

  .search-input::placeholder {
    color: #666;
  }

  .clear-search {
    padding: 0 12px;
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    font-size: 16px;
    transition: color 0.2s;
    touch-action: manipulation;
  }

  .clear-search:hover {
    color: #e0e0e0;
  }

  .search-button {
    flex-shrink: 0;
    padding: 10px 20px;
    background: #667eea;
    border: 1px solid #667eea;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    transition: background 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.4);
  }

  .search-button:hover:not(:disabled) {
    background: #7e8ff0;
  }

  .search-button:disabled {
    background: #4a4a4a;
    border-color: #4a4a4a;
    color: #888;
    cursor: not-allowed;
  }

  .power-search-button {
    flex-shrink: 0;
    padding: 10px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: 1px solid #667eea;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    transition: all 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.4);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  .power-search-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .reading-plan-button {
    flex-shrink: 0;
    padding: 10px 16px;
    background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
    border: 1px solid #4caf50;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    transition: all 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(76, 175, 80, 0.4);
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
  }

  .reading-plan-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
  }

  .search-spinner {
    padding: 0 12px;
    color: #667eea;
    font-size: 16px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .search-results-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
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

  .settings-button {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 10px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .settings-button:hover {
    background: #252525;
    border-color: #667eea;
    color: #667eea;
  }

  .settings-button svg {
    width: 20px;
    height: 20px;
  }

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .navigation-bar {
      min-height: 60px; /* Increased from 56px */
    }

    .nav-content {
      gap: 10px; /* Increased from 6px */
      padding: 10px 12px; /* Increased from 8px 10px */
      -webkit-overflow-scrolling: touch;
      align-items: center;
    }

    .nav-dropdown {
      flex-shrink: 0;
      min-width: 130px; /* Increased from 120px */
      max-width: 150px; /* Increased from 140px */
      position: static; /* Allow dropdowns to escape container */
    }

    .dropdown-menu {
      position: fixed; /* Fixed positioning to escape scrolling container */
      left: auto;
      right: auto;
      min-width: 200px;
      max-width: 90vw;
      z-index: 10001; /* Ensure dropdowns appear above all content on mobile */
    }

    .search-results-dropdown {
      position: fixed; /* Fixed positioning to escape scrolling container */
      left: auto;
      right: auto;
      min-width: 250px;
      max-width: 90vw;
      z-index: 10002; /* Ensure search results appear above dropdowns on mobile */
    }

    .nav-checkbox {
      flex-shrink: 0;
      font-size: 13px; /* Increased from 12px */
      padding: 8px 10px; /* Increased from 6px 8px */
      white-space: nowrap;
      min-width: fit-content;
    }

    .nav-checkbox label {
      font-size: 12px; /* Increased from 11px */
      white-space: nowrap;
    }

    .update-btn {
      padding: 4px 10px; /* Increased from 3px 8px */
      font-size: 11px; /* Increased from 10px */
      white-space: nowrap;
    }

    .nav-button {
      font-size: 13px; /* Increased from 12px */
      padding: 8px 10px; /* Increased from 6px 8px */
    }

    .nav-label {
      font-size: 11px; /* Increased from 10px */
    }

    .nav-value {
      font-size: 13px; /* Increased from 12px */
    }

    .search-container {
      flex-shrink: 0;
      min-width: 200px; /* Increased from 180px */
      max-width: 280px; /* Increased from 250px */
    }

    .search-input {
      font-size: 13px; /* Increased from 12px */
      padding: 8px 10px 8px 0;
    }

    .search-icon {
      padding: 0 10px; /* Increased from 8px */
      font-size: 13px; /* Increased from 12px */
    }

    .search-button {
      padding: 8px 14px; /* Increased from 8px 12px */
      font-size: 13px; /* Increased from 12px */
    }

    .power-search-button {
      padding: 8px 12px; /* Increased from 8px 10px */
      font-size: 13px; /* Increased from 12px */
      white-space: nowrap;
    }

    .reading-plan-button {
      padding: 8px 12px;
      font-size: 13px;
      white-space: nowrap;
    }

    .settings-button {
      width: 44px; /* Increased from 40px - same as desktop */
      height: 44px; /* Increased from 40px */
      flex-shrink: 0;
    }

    .settings-button svg {
      width: 22px; /* Make icon more visible */
      height: 22px;
    }
  }

  @media (max-width: 480px) {
    .navigation-bar {
      min-height: 56px; /* Increased from 52px */
    }

    .nav-content {
      gap: 8px; /* Increased from 4px */
      padding: 8px 10px; /* Increased from 6px 8px */
    }

    .nav-dropdown {
      min-width: 110px; /* Increased from 100px */
      max-width: 120px; /* Increased from 110px */
      font-size: 12px; /* Increased from 11px */
    }

    .nav-button {
      font-size: 12px; /* Increased from 11px */
      padding: 7px 8px; /* Increased from 6px */
    }

    .nav-checkbox {
      padding: 6px 8px; /* Increased from 5px 6px */
      font-size: 12px; /* Increased from 11px */
    }

    .nav-checkbox label {
      font-size: 11px; /* Increased from 10px */
    }

    .update-btn {
      padding: 3px 8px; /* Increased from 2px 6px */
      font-size: 11px; /* Increased from 10px */
    }

    .search-container {
      min-width: 160px; /* Increased from 140px */
      max-width: 200px; /* Increased from 180px */
    }

    .search-input {
      font-size: 12px; /* Increased from 11px */
      padding: 7px 8px 7px 0; /* Increased from 6px 8px 6px 0 */
    }

    .search-icon {
      padding: 0 8px; /* Increased from 6px */
      font-size: 12px; /* Increased from 11px */
    }

    .search-button {
      padding: 7px 12px; /* Increased from 6px 10px */
      font-size: 12px; /* Increased from 11px */
    }

    .power-search-button {
      padding: 7px 10px; /* Increased from 6px 8px */
      font-size: 12px; /* Increased from 11px */
    }

    .reading-plan-button {
      padding: 7px 10px;
      font-size: 12px;
    }

    .settings-button {
      width: 44px; /* Increased from 36px - make it prominent! */
      height: 44px; /* Increased from 36px */
    }

    .settings-button svg {
      width: 20px; /* Increased from 16px */
      height: 20px; /* Increased from 16px */
    }
  }
</style>
