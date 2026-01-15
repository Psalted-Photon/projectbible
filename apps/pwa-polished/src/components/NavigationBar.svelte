<script lang="ts">
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS } from "../lib/bibleData";
  import { onMount, onDestroy } from "svelte";

  export let windowId: string | undefined = undefined;
  export let visible: boolean = true;

  let translationDropdownOpen = false;
  let referenceDropdownOpen = false;
  let expandedBooks = new Set<string>();
  let isChronologicalMode = false;
  let pendingChronologicalMode = false;

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId ? $windowStore.find(w => w.id === windowId) : null;
  $: currentTranslation = windowState?.contentState?.translation ?? $navigationStore.translation;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter = windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentReference = `${currentBook} ${currentChapter}`;
  
  // Initialize from store but don't auto-sync
  $: if ($navigationStore.isChronologicalMode !== undefined && isChronologicalMode === false && pendingChronologicalMode === false) {
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
    }
  }

  function toggleReferenceDropdown(event: MouseEvent) {
    event.stopPropagation();
    referenceDropdownOpen = !referenceDropdownOpen;
    if (referenceDropdownOpen) {
      translationDropdownOpen = false;
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
        chapter 
      });
    } else {
      navigationStore.navigateTo(currentTranslation, bookName, chapter);
    }
    referenceDropdownOpen = false;
    expandedBooks = new Set();
  }

  function closeDropdowns(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".nav-dropdown")) {
      translationDropdownOpen = false;
      referenceDropdownOpen = false;
    }
  }

  onMount(() => {
    document.addEventListener("click", closeDropdowns);
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);
  });
</script>

<div class="navigation-bar" class:visible>
  <!-- Translation Dropdown -->
  <div class="nav-dropdown">
    <button
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
    <button class="update-btn" on:click={updateChronologicalMode}>Update</button>
  </div>

  <!-- Reference Dropdown (Tree Structure) -->
  <div class="nav-dropdown">
    <button
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
</div>

<style>
  .navigation-bar {
    display: flex;
    gap: 12px;
    padding: 12px 20px;
    background: #2a2a2a;
    border-bottom: 1px solid #3a3a3a;
    position: sticky;
    top: 0;
    z-index: 50;
    transform: translateY(-100%);
    transition: transform 0.3s ease-in-out;
    touch-action: manipulation; /* Allow fast taps */
  }

  .navigation-bar.visible {
    transform: translateY(0);
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
    z-index: 100;
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
</style>
