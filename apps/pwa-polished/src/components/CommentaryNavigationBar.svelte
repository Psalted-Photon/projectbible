<script lang="ts">
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { BIBLE_BOOKS } from "../lib/bibleData";
  import { onMount, onDestroy } from "svelte";
  import { CaretDown, CaretRight, CaretUp } from "phosphor-svelte";
  import { IndexedDBCommentaryStore } from "../adapters/CommentaryStore";
  import { ENOCH_EDITIONS, isEnochAuthor, enochLabelFor, loadEnoch } from "../lib/enochBooks";

  export let windowId: string | undefined = undefined;
  export let visible: boolean = true;
  export let style: string = "";

  /* Matches the main navbar: the reference dropdown is two side-by-side columns,
     OT then NT, each reading straight top-to-bottom. */
  const REFERENCE_COLUMNS = [
    { testament: "ot", label: "Old Testament", books: BIBLE_BOOKS.filter((b) => b.testament === "OT") },
    { testament: "nt", label: "New Testament", books: BIBLE_BOOKS.filter((b) => b.testament === "NT") },
  ];

  let commentaryStore: IndexedDBCommentaryStore;
  let authors: string[] = [];
  let authorDropdownOpen = false;
  let referenceDropdownOpen = false;
  let expandedBooks = new Set<string>();

  // Book of Enoch: chapter list for the active edition (in-mode chapter picker)
  let enochChapters: { chapter: number; label: string }[] = [];
  let enochLoadedFor = "";

  // Refs for dropdown positioning
  let authorButtonRef: HTMLElement;
  let referenceButtonRef: HTMLElement;

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentAuthor =
    windowState?.contentState?.author ?? "All Authors";
  $: isEnoch = isEnochAuthor(currentAuthor);
  $: displayAuthor = enochLabelFor(currentAuthor) ?? currentAuthor;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentReference = isEnoch
    ? `Enoch ${currentChapter}`
    : `${currentBook} ${currentChapter}`;
  $: currentBookCategory = BIBLE_BOOKS.find(b => b.name === currentBook)?.category || '';

  // Load the active Enoch edition's chapter list for the reference picker
  $: if (isEnoch && currentAuthor && currentAuthor !== enochLoadedFor) {
    enochLoadedFor = currentAuthor;
    loadEnoch(currentAuthor).then((b) => {
      if (b) enochChapters = b.chapters.map((c) => ({ chapter: c.chapter, label: c.label }));
    });
  }

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
          dropdown.style.removeProperty('width');
          
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
      // Leaving an Enoch edition: drop the Enoch book/chapter so the reader and
      // reference picker return to the normal Bible position.
      const patch: Record<string, unknown> = { author, highlightedVerse: null };
      if (isEnoch) {
        patch.book = undefined;
        patch.chapter = undefined;
      }
      windowStore.updateContentState(windowId, patch);
    }
    // For global panes without windowId, we don't persist author selection
    // Users should use windows for independent commentary instances
    authorDropdownOpen = false;
  }

  // Book of Enoch — the ONLY way to reach Enoch. Selecting an edition pins the
  // book to "Enoch" and starts at chapter 1; the reference pill becomes an
  // in-mode Enoch chapter picker.
  function selectEnoch(author: string) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        author,
        book: "Enoch",
        chapter: 1,
        highlightedVerse: null,
      });
    }
    authorDropdownOpen = false;
  }

  function selectEnochChapter(chapter: number) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        chapter,
        highlightedVerse: null,
      });
    }
    referenceDropdownOpen = false;
  }

  function toggleBook(bookName: string, event: MouseEvent) {
    const isExpanding = !expandedBooks.has(bookName);
    expandedBooks = isExpanding ? new Set([bookName]) : new Set();
    if (isExpanding) {
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
      // Same as the reader's own chapter picker: no mark, no trail, new home.
      navigationStore.clearHistory();
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
        dropdown.style.removeProperty('width');
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
        <span class="nav-value">{displayAuthor}</span>
        <span class="nav-arrow">{authorDropdownOpen ? "▲" : "▼"}</span>
      </button>
    </div>

    <!-- Reference Dropdown (Tree Structure) -->
    <div class="nav-dropdown reference-dropdown-trigger category-{currentBookCategory}">
      <button
        bind:this={referenceButtonRef}
        class="pill-btn pill-btn-text pill-btn-reference"
        on:click={toggleReferenceDropdown}
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
      {#if windowId}
        <!-- Book of Enoch: the single entry point (per-window only) -->
        <div class="dropdown-section-label">📜 Ancient Book</div>
        {#each ENOCH_EDITIONS as ed}
          <button
            class="dropdown-item enoch-item"
            class:selected={ed.author === currentAuthor}
            on:click={() => selectEnoch(ed.author)}
          >
            {ed.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  {#if referenceDropdownOpen && isEnoch}
    <div class="dropdown-menu tree-menu commentary-reference-dropdown">
      <div class="enoch-chapter-grid">
        {#each enochChapters as ch}
          <button
            class="chapter-button"
            class:selected={ch.chapter === currentChapter}
            title={ch.label}
            on:click={() => selectEnochChapter(ch.chapter)}
          >
            {ch.chapter}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if referenceDropdownOpen && !isEnoch}
    <!-- book-tree carries the two-column layout; .tree-menu is shared with the
         Enoch picker above, which must stay a single block. -->
    <div class="dropdown-menu tree-menu book-tree commentary-reference-dropdown">
      {#each REFERENCE_COLUMNS as column}
        <div class="book-column book-column-{column.testament}">
          <div class="book-column-title">{column.label}</div>
          <!-- The books sit in their own box so the NT column can spread its
               spare height between them without pushing the title away. -->
          <div class="book-column-body">
          {#each column.books as book}
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

  /* pill-btn base (mirrors NavigationBar.svelte) */
  .pill-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    background: #1c1c1c;
    border: none;
    border-radius: 6px;
    color: #aaa;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
    touch-action: manipulation;
  }
  .pill-btn:hover {
    background: #252525;
    color: #ccc;
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

  /* Reference button category colors (text tint only) */
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

  /* Book of Enoch entries in the author dropdown */
  .dropdown-section-label {
    padding: 9px 14px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #b39ddb;
    background: #161616;
    border-top: 1px solid #2a2a2a;
  }

  .dropdown-item.enoch-item {
    color: #cbb8ff;
  }

  .dropdown-item.enoch-item.selected {
    background: rgba(156, 39, 176, 0.22);
    color: #e3d3ff;
  }

  /* In-mode Enoch chapter picker */
  .enoch-chapter-grid {
    display: grid;
    grid-template-columns: repeat(7, 40px);
    gap: 4px;
    padding: 8px;
    max-width: 90vw;
  }

  /* Tree Menu */
  .tree-menu {
    padding: 0;
    width: fit-content;
    max-width: 90vw;
    /* Tracks the viewport so landscape phones (~390px tall) don't get a dropdown
       that runs off the bottom of the screen. */
    max-height: min(400px, 85vh);
  }

  /* Old Testament left, New Testament right. Two equal fr tracks inside a
     fit-content box make both columns as wide as the widest book name - the
     expanded chapter overlay leans on that, since it spans 200% of one column. */
  .book-tree {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    align-items: stretch;
  }

  .book-column {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .book-column-nt {
    border-left: 1px solid #2a2a2a;
    background: #000;
  }

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
     keeps both columns starting and ending level. The black shows through those
     gaps; space-between adds none before the first row or after the last, so the
     column stays flush top and bottom. */
  .book-column-nt .book-column-body {
    justify-content: space-between;
  }

  .book-item {
    position: relative; /* anchors the expanded chapter overlay */
    border-bottom: 1px solid #2a2a2a;
  }

  .book-item:last-child {
    border-bottom: none;
  }

  /* Category Colors — Radial Gradient Theme */
  /* Pentateuch — amber */
  .category-pentateuch .book-button { background: radial-gradient(circle, #a67c52 0%, #a67c52 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-pentateuch .book-button:hover { background: radial-gradient(circle, #a67c52 0%, #a67c52 35%, #222222 100%); }
  .category-pentateuch .book-button.current { background: radial-gradient(circle, #a67c52 0%, #a67c52 50%, #222222 100%); font-weight: 500; }

  /* Historical — blue */
  .category-historical .book-button { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-historical .book-button:hover { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 35%, #222222 100%); }
  .category-historical .book-button.current { background: radial-gradient(circle, #6ca0dc 0%, #6ca0dc 50%, #222222 100%); font-weight: 500; }

  /* Wisdom — gold */
  .category-wisdom .book-button { background: radial-gradient(circle, #f0c040 0%, #f0c040 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-wisdom .book-button:hover { background: radial-gradient(circle, #f0c040 0%, #f0c040 35%, #222222 100%); }
  .category-wisdom .book-button.current { background: radial-gradient(circle, #f0c040 0%, #f0c040 50%, #222222 100%); font-weight: 500; }

  /* Major Prophets — purple */
  .category-major-prophets .book-button { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-major-prophets .book-button:hover { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 35%, #222222 100%); }
  .category-major-prophets .book-button.current { background: radial-gradient(circle, #5c1e99 0%, #5c1e99 50%, #222222 100%); font-weight: 500; }

  /* Minor Prophets — purple */
  .category-minor-prophets .book-button { background: radial-gradient(circle, #a45be9 0%, #a45be9 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-minor-prophets .book-button:hover { background: radial-gradient(circle, #a45be9 0%, #a45be9 35%, #222222 100%); }
  .category-minor-prophets .book-button.current { background: radial-gradient(circle, #a45be9 0%, #a45be9 50%, #222222 100%); font-weight: 500; }

  /* Gospels — red/pink */
  .category-gospels .book-button { background: radial-gradient(circle, #fc345c 0%, #fc345c 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-gospels .book-button:hover { background: radial-gradient(circle, #fc345c 0%, #fc345c 35%, #222222 100%); }
  .category-gospels .book-button.current { background: radial-gradient(circle, #fc345c 0%, #fc345c 50%, #222222 100%); font-weight: 500; }

  /* Acts — red-orange */
  .category-acts .book-button { background: radial-gradient(circle, #ff6520 0%, #ff6520 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-acts .book-button:hover { background: radial-gradient(circle, #ff6520 0%, #ff6520 35%, #222222 100%); }
  .category-acts .book-button.current { background: radial-gradient(circle, #ff6520 0%, #ff6520 50%, #222222 100%); font-weight: 500; }

  /* Pauline — crimson */
  .category-pauline .book-button { background: radial-gradient(circle, #6048cc 0%, #6048cc 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-pauline .book-button:hover { background: radial-gradient(circle, #6048cc 0%, #6048cc 35%, #222222 100%); }
  .category-pauline .book-button.current { background: radial-gradient(circle, #6048cc 0%, #6048cc 50%, #222222 100%); font-weight: 500; }

  /* General — warm orange */
  .category-general .book-button { background: radial-gradient(circle, #f2893e 0%, #f2893e 20%, #222222 100%); border: 1px solid #222222; color: #e2e2e2; }
  .category-general .book-button:hover { background: radial-gradient(circle, #f2893e 0%, #f2893e 35%, #222222 100%); }
  .category-general .book-button.current { background: radial-gradient(circle, #f2893e 0%, #f2893e 50%, #222222 100%); font-weight: 500; }

  /* Revelation — royal blue */
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

  /* Two columns need ~420px and a portrait phone only offers ~350px, so upright
     phones fall back to the single top-to-bottom list. The same phone turned
     sideways is 670px+ wide, so landscape keeps the columns. */
  @media (max-width: 600px) and (orientation: portrait) {
    .book-tree {
      display: block;
    }

    .book-column-nt {
      background: none;
      border-left: none;
      border-top: 12px solid #000; /* the OT/NT break, back where the split was */
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
