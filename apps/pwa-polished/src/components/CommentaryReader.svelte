<script lang="ts">
  import { onMount } from "svelte";
  import CommentaryNavigationBar from "./CommentaryNavigationBar.svelte";
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { IndexedDBCommentaryStore, type CommentaryEntry } from "../adapters/CommentaryStore";

  export let windowId: string | undefined = undefined;

  let readerElement: HTMLDivElement;
  let commentaryStore: IndexedDBCommentaryStore;
  let entries: CommentaryEntry[] = [];
  let loading = true;
  let error = "";
  let lastNavigationKey = "";

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentAuthor = windowState?.contentState?.author;
  $: highlightVerse =
    windowState?.contentState?.highlightedVerse ??
    $navigationStore.highlightedVerse ??
    null;

  // Load commentary when navigation changes
  $: {
    const navKey = `${currentBook}-${currentChapter}-${currentAuthor ?? 'all'}`;
    if (commentaryStore && navKey !== lastNavigationKey) {
      lastNavigationKey = navKey;
      loadCommentary(currentBook, currentChapter, currentAuthor);
    }
  }

  // Auto-scroll to highlighted verse
  $: if (highlightVerse !== null && entries.length > 0 && readerElement) {
    scrollToVerse(highlightVerse);
  }

  async function loadCommentary(book: string, chapter: number, author?: string) {
    loading = true;
    error = "";
    try {
      console.log(`📜 Loading commentary for ${book} ${chapter}, author: ${author || 'all'}`);
      
      // Get all verse-level commentary entries for the chapter
      entries = await commentaryStore.getAllChapterContent(book, chapter, author);
      
      console.log(`   Loaded ${entries.length} commentary entries`);

      if (readerElement) {
        readerElement.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (err: unknown) {
      console.error("Error loading commentary:", err);
      error = `Failed to load commentary for ${book} ${chapter}.`;
      entries = [];
    } finally {
      loading = false;
    }
  }

  function scrollToVerse(verseNum: number) {
    if (!readerElement) return;

    // Find the first entry that contains this verse
    const targetEntry = entries.find(
      e => verseNum >= e.verseStart && (!e.verseEnd || verseNum <= e.verseEnd)
    );

    if (!targetEntry) return;

    // Scroll to the entry element
    const entryEl = readerElement.querySelector(
      `.commentary-entry[data-verse-start="${targetEntry.verseStart}"][data-author="${targetEntry.author}"]`
    ) as HTMLElement | null;

    if (entryEl) {
      entryEl.classList.add('search-verse-highlighted');
      entryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Remove highlight after delay
      setTimeout(() => {
        entryEl.classList.remove('search-verse-highlighted');
      }, 3000);
    }
  }

  onMount(async () => {
    commentaryStore = new IndexedDBCommentaryStore();
    
    // Load initial commentary
    if (currentBook && currentChapter) {
      await loadCommentary(currentBook, currentChapter, currentAuthor);
    }
  });
</script>

<div class="commentary-reader" bind:this={readerElement}>
  <CommentaryNavigationBar {windowId} />

  <div class="commentary-container">
    {#if loading && entries.length === 0}
      <div class="loading">Loading commentary...</div>
    {:else if error}
      <div class="error">{error}</div>
      <p class="error-hint">
        Make sure you have commentary packs installed via Manage Packs.
      </p>
    {:else if entries.length === 0}
      <div class="no-content">
        <h3>No commentary available</h3>
        <p>No commentary found for {currentBook} {currentChapter}.</p>
        <p class="hint">Import more commentary packs via Manage Packs to see additional content.</p>
      </div>
    {:else}
      <div class="entries">
        {#each entries as entry (`${entry.book}-${entry.chapter}-${entry.verseStart}-${entry.author}`)}
          <div 
            class="commentary-entry"
            class:chapter-intro={entry.verseStart === 0}
            data-verse-start={entry.verseStart}
            data-author={entry.author}
          >
            {#if entry.verseStart === 0}
              <!-- Chapter-level commentary with sticky badge -->
              <div class="chapter-badge">
                <span class="badge-icon">📘</span>
                <span class="badge-text">Chapter Commentary</span>
              </div>
            {:else}
              <!-- Verse-level commentary with verse number -->
              <div class="verse-header">
                <span class="verse-number" data-verse={entry.verseStart}>
                  {entry.verseStart}{#if entry.verseEnd && entry.verseEnd !== entry.verseStart}–{entry.verseEnd}{/if}
                </span>
              </div>
            {/if}

            <div class="entry-content">
              <h3 class="author-name">{entry.author}</h3>
              {#if entry.title}
                <h4 class="entry-title">{entry.title}</h4>
              {/if}
              <div class="entry-text">{entry.text}</div>
            </div>
          </div>

          {#if entry.verseStart === 0}
            <!-- Section divider after chapter commentary -->
            <div class="section-divider">
              <span class="divider-text">Verse Commentary</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .commentary-reader {
    width: 100%;
    height: 100%;
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    background: #1a1a1a;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
  }

  .commentary-container {
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    padding: 80px 20px 100px;
    flex: 1;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }

  .loading,
  .error,
  .no-content {
    text-align: center;
    padding: 40px 20px;
    color: #888;
  }

  .error {
    color: #ff6b6b;
  }

  .error-hint,
  .hint {
    font-size: 0.9rem;
    color: #666;
    margin-top: 10px;
  }

  .no-content h3 {
    color: #e0e0e0;
    margin-bottom: 12px;
  }

  .no-content p {
    margin: 8px 0;
  }

  .entries {
    max-width: 900px;
    margin: 0 auto;
  }

  .commentary-entry {
    margin-bottom: 30px;
    padding: 20px;
    background: #222;
    border-radius: 8px;
    border-left: 3px solid #667eea;
    transition: background 0.3s;
  }

  .commentary-entry.chapter-intro {
    background: #2a2a3a;
    border-left-color: #9c27b0;
    position: sticky;
    top: 68px;
    z-index: 100;
    margin-bottom: 0;
  }

  .commentary-entry:global(.search-verse-highlighted) {
    background: rgba(102, 126, 234, 0.2);
    border-left-color: #667eea;
    box-shadow: 0 0 20px rgba(102, 126, 234, 0.3);
  }

  .chapter-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(156, 39, 176, 0.2);
    border: 1px solid rgba(156, 39, 176, 0.4);
    border-radius: 16px;
    font-size: 0.85rem;
    color: #ce93d8;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .badge-icon {
    font-size: 1rem;
  }

  .verse-header {
    margin-bottom: 12px;
  }

  .verse-number {
    display: inline-block;
    padding: 4px 10px;
    background: rgba(102, 126, 234, 0.2);
    border: 1px solid rgba(102, 126, 234, 0.4);
    border-radius: 12px;
    font-size: 0.85rem;
    color: #b8b8ff;
    font-weight: 500;
  }

  .entry-content {
    margin-top: 0;
  }

  .author-name {
    color: #667eea;
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .entry-title {
    color: #999;
    font-size: 0.95rem;
    font-weight: normal;
    font-style: italic;
    margin-bottom: 12px;
  }

  .entry-text {
    line-height: 1.7;
    color: #e0e0e0;
    font-size: 1rem;
    white-space: pre-wrap;
  }

  .section-divider {
    margin: 30px 0;
    text-align: center;
    position: relative;
  }

  .section-divider::before,
  .section-divider::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 45%;
    height: 1px;
    background: linear-gradient(to right, transparent, #444, transparent);
  }

  .section-divider::before {
    left: 0;
  }

  .section-divider::after {
    right: 0;
  }

  .divider-text {
    display: inline-block;
    padding: 0 20px;
    background: #1a1a1a;
    color: #666;
    font-size: 0.85rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Mobile optimization */
  @media (max-width: 768px) {
    .commentary-container {
      padding: 80px 15px 80px;
    }

    .commentary-entry {
      padding: 16px;
      font-size: 0.95rem;
    }

    .entry-text {
      font-size: 0.95rem;
    }
  }
</style>
