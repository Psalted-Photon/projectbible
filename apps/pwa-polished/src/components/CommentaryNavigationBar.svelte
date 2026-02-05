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
  $: currentBookCategory = BIBLE_BOOKS.find(b => b.name === currentBook)?.category || '';

  onMount(async () => {
    commentaryStore = new IndexedDBCommentaryStore();
    authors = await commentaryStore.getAuthors();
  });

  async function toggleAuthorDropdown(event: MouseEvent) {
    event.stopPropagation();
    authorDropdownOpen = !authorDropdownOpen;
    if (authorDropdownOpen) {
      referenceDropdownOpen = false;
      
      // Refresh authors in case database was just populated
      if (commentaryStore) {
        authors = await commentaryStore.getAuthors();
      }
      
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
      
      // Auto-expand current book
      if (currentBook && !expandedBooks.has(currentBook)) {
        expandedBooks = new Set([currentBook]);
      }
      
      // Position dropdown and scroll to current book
      requestAnimationFrame(() => {
        const dropdown = document.querySelector(
          ".commentary-reference-dropdown",
        ) as HTMLElement;
        if (dropdown && referenceButtonRef) {
          const rect = referenceButtonRef.getBoundingClientRect();
          dropdown.style.left = `${rect.left}px`;
          dropdown.style.top = `${rect.bottom + 4}px`;
          dropdown.style.width = `${Math.max(rect.width, 250)}px`;
          
          // Scroll to current book
          if (currentBook) {
            requestAnimationFrame(() => {
              const currentBookItem = dropdown.querySelector(`.book-item .book-button.current`)?.closest('.book-item') as HTMLElement;
              if (currentBookItem) {
                const dropdownRect = dropdown.getBoundingClientRect();
                const bookRect = currentBookItem.getBoundingClientRect();
                const scrollOffset = bookRect.top - dropdownRect.top + dropdown.scrollTop;
                dropdown.scrollTop = scrollOffset;
              }
            });
          }
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

  function toggleBook(bookName: string, event: MouseEvent) {
    const newExpanded = new Set(expandedBooks);
    if (newExpanded.has(bookName)) {
      newExpanded.delete(bookName);
    } else {
      newExpanded.add(bookName);
      
      // Scroll to position this book at top when expanding
      requestAnimationFrame(() => {
        const dropdown = document.querySelector('.commentary-reference-dropdown') as HTMLElement;
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
    if (
      !target.closest(".nav-dropdown") &&
      !target.closest(".dropdown-menu")
    ) {
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
    <div class="nav-dropdown reference-dropdown-trigger category-{currentBookCategory}">
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
              {expandedBooks.has(book.name) ? "▼" : "▶"}
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
    padding: 0 var(--nav-item-inline-pad);
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
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .nav-button:hover {
    background: #2a2a2a;
    border-color: #667eea;
  }

  .nav-button.active {
    background: #3a3a3a;
    border-color: #667eea;
  }

  /* Category colors for reference button */
  .nav-dropdown.reference-dropdown-trigger.category-pentateuch .nav-button {
    background: linear-gradient(135deg, #3d2a1a 0%, #2d1f12 100%);
    border-color: #8b5c2e;
  }
  .nav-dropdown.reference-dropdown-trigger.category-historical .nav-button {
    background: linear-gradient(135deg, #2d4a5e 0%, #1d3a4e 100%);
    border-color: #4682b4;
  }
  .nav-dropdown.reference-dropdown-trigger.category-wisdom .nav-button {
    background: linear-gradient(135deg, #5d4a1a 0%, #4d3a0a 100%);
    border-color: #daa520;
  }
  .nav-dropdown.reference-dropdown-trigger.category-major-prophets .nav-button {
    background: linear-gradient(135deg, #3d0056 0%, #2d0046 100%);
    border-color: #9400d3;
  }
  .nav-dropdown.reference-dropdown-trigger.category-minor-prophets .nav-button {
    background: linear-gradient(135deg, #5d3800 0%, #4d2800 100%);
    border-color: #ff8c00;
  }
  .nav-dropdown.reference-dropdown-trigger.category-gospels .nav-button {
    background: linear-gradient(135deg, #1d4a2f 0%, #0d3a1f 100%);
    border-color: #2e8b57;
  }
  .nav-dropdown.reference-dropdown-trigger.category-acts .nav-button {
    background: linear-gradient(135deg, #5d1f00 0%, #4d1500 100%);
    border-color: #ff4500;
  }
  .nav-dropdown.reference-dropdown-trigger.category-pauline .nav-button {
    background: linear-gradient(135deg, #4d0a1a 0%, #3d0010 100%);
    border-color: #dc143c;
  }
  .nav-dropdown.reference-dropdown-trigger.category-general .nav-button {
    background: linear-gradient(135deg, #4d2a10 0%, #3d1a00 100%);
    border-color: #d2691e;
  }
  .nav-dropdown.reference-dropdown-trigger.category-revelation .nav-button {
    background: linear-gradient(135deg, #1a2f5d 0%, #0a1f4d 100%);
    border-color: #4169e1;
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
    transition: background 0.15s;
    border-bottom: 1px solid #2a2a2a;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .dropdown-item:last-child {
    border-bottom: none;
  }

  .dropdown-item:hover {
    background: #3a3a3a;
  }

  .dropdown-item.selected {
    background: rgba(102, 126, 234, 0.2);
    color: #8899ff;
    font-weight: 500;
  }

  /* Tree Menu */
  .tree-menu {
    padding: 0;
  }

  .book-item {
    border-bottom: 1px solid #2a2a2a;
  }

  .book-item:last-child {
    border-bottom: none;
  }

  /* NT Separator */
  .book-item.first-nt {
    border-top: 3px solid #4a4a4a;
    margin-top: 8px;
    padding-top: 8px;
  }

  /* Category-specific book button styles */
  .category-pentateuch .book-button {
    background: linear-gradient(135deg, #3d2a1a 0%, #2d1f12 100%);
    border: 1px solid #8b5c2e;
    border-left: 3px solid #8b5c2e;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-pentateuch .book-button:hover {
    background: linear-gradient(135deg, #4d3a2a 0%, #3d2a1a 100%);
    border-color: #a67c52;
  }
  .category-pentateuch .chapters-container {
    background: linear-gradient(180deg, #2d1f12 0%, #1d0f02 100%);
    border: 1px solid #3d2a1a;
  }

  .category-historical .book-button {
    background: linear-gradient(135deg, #2d4a5e 0%, #1d3a4e 100%);
    border: 1px solid #4682b4;
    border-left: 3px solid #4682b4;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-historical .book-button:hover {
    background: linear-gradient(135deg, #3d5a6e 0%, #2d4a5e 100%);
    border-color: #6ca0dc;
  }
  .category-historical .chapters-container {
    background: linear-gradient(180deg, #1d3a4e 0%, #0d2a3e 100%);
    border: 1px solid #2d4a5e;
  }

  .category-wisdom .book-button {
    background: linear-gradient(135deg, #5d4a1a 0%, #4d3a0a 100%);
    border: 1px solid #daa520;
    border-left: 3px solid #daa520;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-wisdom .book-button:hover {
    background: linear-gradient(135deg, #6d5a2a 0%, #5d4a1a 100%);
    border-color: #f0c040;
  }
  .category-wisdom .chapters-container {
    background: linear-gradient(180deg, #4d3a0a 0%, #3d2a00 100%);
    border: 1px solid #5d4a1a;
  }

  .category-major-prophets .book-button {
    background: linear-gradient(135deg, #3d0056 0%, #2d0046 100%);
    border: 1px solid #9400d3;
    border-left: 3px solid #9400d3;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-major-prophets .book-button:hover {
    background: linear-gradient(135deg, #4d0066 0%, #3d0056 100%);
    border-color: #b420f3;
  }
  .category-major-prophets .chapters-container {
    background: linear-gradient(180deg, #2d0046 0%, #1d0036 100%);
    border: 1px solid #3d0056;
  }

  .category-minor-prophets .book-button {
    background: linear-gradient(135deg, #5d3800 0%, #4d2800 100%);
    border: 1px solid #ff8c00;
    border-left: 3px solid #ff8c00;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-minor-prophets .book-button:hover {
    background: linear-gradient(135deg, #6d4810 0%, #5d3800 100%);
    border-color: #ffa520;
  }
  .category-minor-prophets .chapters-container {
    background: linear-gradient(180deg, #4d2800 0%, #3d1800 100%);
    border: 1px solid #5d3800;
  }

  .category-gospels .book-button {
    background: linear-gradient(135deg, #1d4a2f 0%, #0d3a1f 100%);
    border: 1px solid #2e8b57;
    border-left: 3px solid #2e8b57;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-gospels .book-button:hover {
    background: linear-gradient(135deg, #2d5a3f 0%, #1d4a2f 100%);
    border-color: #4eab77;
  }
  .category-gospels .chapters-container {
    background: linear-gradient(180deg, #0d3a1f 0%, #0d2a0f 100%);
    border: 1px solid #1d4a2f;
  }

  .category-acts .book-button {
    background: linear-gradient(135deg, #5d1f00 0%, #4d1500 100%);
    border: 1px solid #ff4500;
    border-left: 3px solid #ff4500;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-acts .book-button:hover {
    background: linear-gradient(135deg, #6d2f10 0%, #5d1f00 100%);
    border-color: #ff6520;
  }
  .category-acts .chapters-container {
    background: linear-gradient(180deg, #4d1500 0%, #3d0500 100%);
    border: 1px solid #5d1f00;
  }

  .category-pauline .book-button {
    background: linear-gradient(135deg, #4d0a1a 0%, #3d0010 100%);
    border: 1px solid #dc143c;
    border-left: 3px solid #dc143c;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-pauline .book-button:hover {
    background: linear-gradient(135deg, #5d1a2a 0%, #4d0a1a 100%);
    border-color: #fc345c;
  }
  .category-pauline .chapters-container {
    background: linear-gradient(180deg, #3d0010 0%, #2d0000 100%);
    border: 1px solid #4d0a1a;
  }

  .category-general .book-button {
    background: linear-gradient(135deg, #4d2a10 0%, #3d1a00 100%);
    border: 1px solid #d2691e;
    border-left: 3px solid #d2691e;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-general .book-button:hover {
    background: linear-gradient(135deg, #5d3a20 0%, #4d2a10 100%);
    border-color: #f2893e;
  }
  .category-general .chapters-container {
    background: linear-gradient(180deg, #3d1a00 0%, #2d0a00 100%);
    border: 1px solid #4d2a10;
  }

  .category-revelation .book-button {
    background: linear-gradient(135deg, #1a2f5d 0%, #0a1f4d 100%);
    border: 1px solid #4169e1;
    border-left: 3px solid #4169e1;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .category-revelation .book-button:hover {
    background: linear-gradient(135deg, #2a3f6d 0%, #1a2f5d 100%);
    border-color: #6189f1;
  }
  .category-revelation .chapters-container {
    background: linear-gradient(180deg, #0a1f4d 0%, #0a0f3d 100%);
    border: 1px solid #1a2f5d;
  }

  /* Current book highlighting in category colors */
  .category-pentateuch .book-button.current {
    background: linear-gradient(135deg, #5d4a2a 0%, #4d3a1a 100%);
    border-color: #a67c52;
    font-weight: 500;
  }
  .category-historical .book-button.current {
    background: linear-gradient(135deg, #4d6a7e 0%, #3d5a6e 100%);
    border-color: #6ca0dc;
    font-weight: 500;
  }
  .category-wisdom .book-button.current {
    background: linear-gradient(135deg, #7d6a3a 0%, #6d5a2a 100%);
    border-color: #f0c040;
    font-weight: 500;
  }
  .category-major-prophets .book-button.current {
    background: linear-gradient(135deg, #5d1076 0%, #4d0066 100%);
    border-color: #b420f3;
    font-weight: 500;
  }
  .category-minor-prophets .book-button.current {
    background: linear-gradient(135deg, #7d5820 0%, #6d4810 100%);
    border-color: #ffa520;
    font-weight: 500;
  }
  .category-gospels .book-button.current {
    background: linear-gradient(135deg, #3d6a4f 0%, #2d5a3f 100%);
    border-color: #4eab77;
    font-weight: 500;
  }
  .category-acts .book-button.current {
    background: linear-gradient(135deg, #7d3f20 0%, #6d2f10 100%);
    border-color: #ff6520;
    font-weight: 500;
  }
  .category-pauline .book-button.current {
    background: linear-gradient(135deg, #6d2a3a 0%, #5d1a2a 100%);
    border-color: #fc345c;
    font-weight: 500;
  }
  .category-general .book-button.current {
    background: linear-gradient(135deg, #6d4a30 0%, #5d3a20 100%);
    border-color: #f2893e;
    font-weight: 500;
  }
  .category-revelation .book-button.current {
    background: linear-gradient(135deg, #3a4f7d 0%, #2a3f6d 100%);
    border-color: #6189f1;
    font-weight: 500;
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
  .category-pentateuch .chapter-button {
    background: linear-gradient(135deg, #3d2a1a 0%, #2d1f12 100%);
    border-color: #8b5c2e;
  }
  .category-pentateuch .chapter-button:hover {
    background: linear-gradient(135deg, #4d3a2a 0%, #3d2a1a 100%);
    border-color: #a67c52;
  }
  .category-pentateuch .chapter-button.selected {
    background: linear-gradient(135deg, #8b5c2e 0%, #6d4a1e 100%);
    border-color: #a67c52;
  }

  .category-historical .chapter-button {
    background: linear-gradient(135deg, #2d4a5e 0%, #1d3a4e 100%);
    border-color: #4682b4;
  }
  .category-historical .chapter-button:hover {
    background: linear-gradient(135deg, #3d5a6e 0%, #2d4a5e 100%);
    border-color: #6ca0dc;
  }
  .category-historical .chapter-button.selected {
    background: linear-gradient(135deg, #4682b4 0%, #3672a4 100%);
    border-color: #6ca0dc;
  }

  .category-wisdom .chapter-button {
    background: linear-gradient(135deg, #5d4a1a 0%, #4d3a0a 100%);
    border-color: #daa520;
  }
  .category-wisdom .chapter-button:hover {
    background: linear-gradient(135deg, #6d5a2a 0%, #5d4a1a 100%);
    border-color: #f0c040;
  }
  .category-wisdom .chapter-button.selected {
    background: linear-gradient(135deg, #daa520 0%, #ba8510 100%);
    border-color: #f0c040;
  }

  .category-major-prophets .chapter-button {
    background: linear-gradient(135deg, #3d0056 0%, #2d0046 100%);
    border-color: #9400d3;
  }
  .category-major-prophets .chapter-button:hover {
    background: linear-gradient(135deg, #4d0066 0%, #3d0056 100%);
    border-color: #b420f3;
  }
  .category-major-prophets .chapter-button.selected {
    background: linear-gradient(135deg, #9400d3 0%, #7400b3 100%);
    border-color: #b420f3;
  }

  .category-minor-prophets .chapter-button {
    background: linear-gradient(135deg, #5d3800 0%, #4d2800 100%);
    border-color: #ff8c00;
  }
  .category-minor-prophets .chapter-button:hover {
    background: linear-gradient(135deg, #6d4810 0%, #5d3800 100%);
    border-color: #ffa520;
  }
  .category-minor-prophets .chapter-button.selected {
    background: linear-gradient(135deg, #ff8c00 0%, #df7c00 100%);
    border-color: #ffa520;
  }

  .category-gospels .chapter-button {
    background: linear-gradient(135deg, #1d4a2f 0%, #0d3a1f 100%);
    border-color: #2e8b57;
  }
  .category-gospels .chapter-button:hover {
    background: linear-gradient(135deg, #2d5a3f 0%, #1d4a2f 100%);
    border-color: #4eab77;
  }
  .category-gospels .chapter-button.selected {
    background: linear-gradient(135deg, #2e8b57 0%, #1e7b47 100%);
    border-color: #4eab77;
  }

  .category-acts .chapter-button {
    background: linear-gradient(135deg, #5d1f00 0%, #4d1500 100%);
    border-color: #ff4500;
  }
  .category-acts .chapter-button:hover {
    background: linear-gradient(135deg, #6d2f10 0%, #5d1f00 100%);
    border-color: #ff6520;
  }
  .category-acts .chapter-button.selected {
    background: linear-gradient(135deg, #ff4500 0%, #df3500 100%);
    border-color: #ff6520;
  }

  .category-pauline .chapter-button {
    background: linear-gradient(135deg, #4d0a1a 0%, #3d0010 100%);
    border-color: #dc143c;
  }
  .category-pauline .chapter-button:hover {
    background: linear-gradient(135deg, #5d1a2a 0%, #4d0a1a 100%);
    border-color: #fc345c;
  }
  .category-pauline .chapter-button.selected {
    background: linear-gradient(135deg, #dc143c 0%, #bc042c 100%);
    border-color: #fc345c;
  }

  .category-general .chapter-button {
    background: linear-gradient(135deg, #4d2a10 0%, #3d1a00 100%);
    border-color: #d2691e;
  }
  .category-general .chapter-button:hover {
    background: linear-gradient(135deg, #5d3a20 0%, #4d2a10 100%);
    border-color: #f2893e;
  }
  .category-general .chapter-button.selected {
    background: linear-gradient(135deg, #d2691e 0%, #b2590e 100%);
    border-color: #f2893e;
  }

  .category-revelation .chapter-button {
    background: linear-gradient(135deg, #1a2f5d 0%, #0a1f4d 100%);
    border-color: #4169e1;
  }
  .category-revelation .chapter-button:hover {
    background: linear-gradient(135deg, #2a3f6d 0%, #1a2f5d 100%);
    border-color: #6189f1;
  }
  .category-revelation .chapter-button.selected {
    background: linear-gradient(135deg, #4169e1 0%, #3159d1 100%);
    border-color: #6189f1;
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
