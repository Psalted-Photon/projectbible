<script lang="ts">
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS } from "../lib/bibleData";
  import { onMount, onDestroy } from "svelte";
  import { IndexedDBCommentaryStore } from "../adapters/CommentaryStore";

  export let windowId: string | undefined = undefined;
  export let visible: boolean = true;
  export let style: string = "";

  let commentaryStore: IndexedDBCommentaryStore;
  let authors: string[] = [];
  let authorDropdownOpen = false;
  let referenceDropdownOpen = false;
  let expandedBooks = new Set<string>();

  // Refs for dropdown positioning
  let authorButtonRef: HTMLElement;
  let referenceButtonRef: HTMLElement;

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentAuthor =
    windowState?.contentState?.author ?? "All Authors";
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentReference = `${currentBook} ${currentChapter}`;

  onMount(async () => {
    commentaryStore = new IndexedDBCommentaryStore();
    authors = await commentaryStore.getAuthors();
  });

  function toggleAuthorDropdown(event: MouseEvent) {
    event.stopPropagation();
    authorDropdownOpen = !authorDropdownOpen;
    if (authorDropdownOpen) {
      referenceDropdownOpen = false;
      // Position dropdown
      requestAnimationFrame(() => {
        const dropdown = document.querySelector(
          ".author-dropdown",
        ) as HTMLElement;
        if (dropdown && authorButtonRef) {
          const rect = authorButtonRef.getBoundingClientRect();
          dropdown.style.left = `${rect.left}px`;
          dropdown.style.top = `${rect.bottom + 4}px`;
          dropdown.style.width = `${Math.max(rect.width, 200)}px`;
        }
      });
    }
  }

  function toggleReferenceDropdown(event: MouseEvent) {
    event.stopPropagation();
    referenceDropdownOpen = !referenceDropdownOpen;
    if (referenceDropdownOpen) {
      authorDropdownOpen = false;
      // Position dropdown
      requestAnimationFrame(() => {
        const dropdown = document.querySelector(
          ".commentary-reference-dropdown",
        ) as HTMLElement;
        if (dropdown && referenceButtonRef) {
          const rect = referenceButtonRef.getBoundingClientRect();
          dropdown.style.left = `${rect.left}px`;
          dropdown.style.top = `${rect.bottom + 4}px`;
          dropdown.style.width = `${Math.max(rect.width, 250)}px`;
        }
      });
    }
  }

  function selectAuthor(author: string | undefined) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        author,
        highlightedVerse: null,
      });
    }
    // For global panes without windowId, we don't persist author selection
    // Users should use windows for independent commentary instances
    authorDropdownOpen = false;
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
        author: currentAuthor === "All Authors" ? undefined : currentAuthor,
        book: bookName,
        chapter,
        highlightedVerse: null,
      });
    } else {
      navigationStore.navigateTo($navigationStore.translation, bookName, chapter);
    }
    referenceDropdownOpen = false;
    expandedBooks = new Set();
  }

  function closeDropdowns(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".nav-dropdown")) {
      authorDropdownOpen = false;
      referenceDropdownOpen = false;
    }
  }

  function updateDropdownPositions() {
    if (authorDropdownOpen) {
      const dropdown = document.querySelector(
        ".author-dropdown",
      ) as HTMLElement;
      if (dropdown && authorButtonRef) {
        const rect = authorButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.width = `${Math.max(rect.width, 200)}px`;
      }
    }
    if (referenceDropdownOpen) {
      const dropdown = document.querySelector(
        ".commentary-reference-dropdown",
      ) as HTMLElement;
      if (dropdown && referenceButtonRef) {
        const rect = referenceButtonRef.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.width = `${Math.max(rect.width, 250)}px`;
      }
    }
  }

  onMount(() => {
    document.addEventListener("click", closeDropdowns);

    // Update dropdown positions on scroll
    const navContent = document.querySelector(".commentary-nav-content");
    if (navContent) {
      navContent.addEventListener("scroll", updateDropdownPositions);
    }
  });

  onDestroy(() => {
    document.removeEventListener("click", closeDropdowns);

    const navContent = document.querySelector(".commentary-nav-content");
    if (navContent) {
      navContent.removeEventListener("scroll", updateDropdownPositions);
    }
  });
</script>

<div class="commentary-navigation-bar" {style}>
  <div class="commentary-nav-content">
    <!-- Author Dropdown -->
    <div class="nav-dropdown author-dropdown-trigger">
      <button
        bind:this={authorButtonRef}
        class="nav-button"
        on:click={toggleAuthorDropdown}
        class:active={authorDropdownOpen}
      >
        <span class="nav-label">Commentary:</span>
        <span class="nav-value">{currentAuthor}</span>
        <span class="nav-arrow">{authorDropdownOpen ? "▲" : "▼"}</span>
      </button>
    </div>

    <!-- Reference Dropdown (Tree Structure) -->
    <div class="nav-dropdown reference-dropdown-trigger">
      <button
        bind:this={referenceButtonRef}
        class="nav-button"
        on:click={toggleReferenceDropdown}
        class:active={referenceDropdownOpen}
      >
        <span class="nav-value">{currentReference}</span>
        <span class="nav-arrow">{referenceDropdownOpen ? "▲" : "▼"}</span>
      </button>
    </div>
  </div>

  <!-- Dropdowns rendered outside nav-content to avoid overflow clipping -->
  {#if authorDropdownOpen}
    <div class="dropdown-menu author-dropdown">
      <button
        class="dropdown-item"
        class:selected={currentAuthor === "All Authors"}
        on:click={() => selectAuthor(undefined)}
      >
        All Authors
      </button>
      {#each authors as author}
        <button
          class="dropdown-item"
          class:selected={author === currentAuthor}
          on:click={() => selectAuthor(author)}
        >
          {author}
        </button>
      {/each}
    </div>
  {/if}

  {#if referenceDropdownOpen}
    <div class="dropdown-menu tree-menu commentary-reference-dropdown">
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

<style>
  .commentary-navigation-bar {
    background: #2a2a2a;
    border-bottom: 1px solid #3a3a3a;
    position: sticky;
    top: 0;
    z-index: 1000;
    min-height: 68px;
    --nav-item-height: 33px;
    --nav-item-inline-pad: calc((var(--nav-item-height) - 14px) / 2);
    box-sizing: border-box;
    overflow: visible;
  }

  .commentary-nav-content {
    display: flex;
    gap: 12px;
    padding: 12px 20px;
    touch-action: manipulation;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: visible;
    align-items: flex-start;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .commentary-nav-content::-webkit-scrollbar {
    display: none;
  }

  .nav-dropdown {
    position: relative;
    flex: 1;
    max-width: 280px;
    align-self: flex-start;
  }

  .nav-dropdown.reference-dropdown-trigger {
    flex: 0 0 auto;
    width: auto;
    max-width: none;
  }

  .nav-dropdown.author-dropdown-trigger {
    flex: 0 0 auto;
    width: auto;
    max-width: none;
  }

  .nav-button {
    width: 100%;
    height: var(--nav-item-height);
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
    white-space: nowrap;
    box-sizing: border-box;
  }

  .nav-button:hover {
    background: #2a2a2a;
    border-color: #4a4a4a;
  }

  .nav-button.active {
    background: #3a3a3a;
    border-color: #5a5a5a;
  }

  .nav-label {
    color: #888;
    font-size: 13px;
  }

  .nav-value {
    font-weight: 500;
  }

  .nav-arrow {
    margin-left: auto;
    color: #888;
  }

  /* Dropdown Menu */
  .dropdown-menu {
    position: fixed;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    max-height: 400px;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 2000;
  }

  .dropdown-item {
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    background: transparent;
    border: none;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
    border-bottom: 1px solid #2a2a2a;
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: #2a2a2a;
  }

  .dropdown-item.selected {
    background: #3a3a3a;
    color: #667eea;
    font-weight: 500;
  }

  /* Tree Menu */
  .tree-menu {
    padding: 8px 0;
  }

  .book-item {
    margin-bottom: 4px;
  }

  .book-button {
    width: 100%;
    padding: 8px 14px;
    text-align: left;
    background: transparent;
    border: none;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .book-button:hover {
    background: #2a2a2a;
  }

  .book-button.expanded {
    background: #2a2a2a;
  }

  .book-button.current {
    color: #667eea;
    font-weight: 500;
  }

  .expand-icon {
    width: 16px;
    color: #888;
    font-size: 12px;
  }

  .book-name {
    flex: 1;
  }

  .chapters-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 4px;
    padding: 8px 14px 8px 38px;
    background: #0a0a0a;
  }

  .chapter-button {
    padding: 6px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
    text-align: center;
  }

  .chapter-button:hover {
    background: #2a2a2a;
    border-color: #3a3a3a;
  }

  .chapter-button.selected {
    background: #667eea;
    border-color: #667eea;
    color: white;
    font-weight: 500;
  }
</style>
