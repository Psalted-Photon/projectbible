<script lang="ts">
  import { onMount } from 'svelte';
  import { IndexedDBCommentaryStore, type CommentaryEntry } from '../adapters/CommentaryStore';
  
  let { book, chapter, verse, isOpen = $bindable(false) }: {
    book: string;
    chapter: number;
    verse: number;
    isOpen?: boolean;
  } = $props();
  
  let commentaryStore: IndexedDBCommentaryStore;
  let chapterEntries: CommentaryEntry[] = $state([]);
  let verseEntries: CommentaryEntry[] = $state([]);
  let selectedAuthor: string | undefined = $state(undefined);
  let authors: string[] = $state([]);
  let loading = $state(false);
  let error: string | undefined = $state(undefined);
  
  onMount(() => {
    commentaryStore = new IndexedDBCommentaryStore();
    loadAuthors();
  });
  
  async function loadAuthors() {
    try {
      authors = await commentaryStore.getAuthors();
    } catch (err) {
      console.error('Failed to load authors:', err);
      error = 'Failed to load commentary authors';
    }
  }
  
  async function loadCommentary() {
    loading = true;
    error = undefined;
    
    try {
      const allEntries = await commentaryStore.getCommentary(
        { book, chapter, verse },
        selectedAuthor
      );
      
      // Separate chapter-level (verse_start = 0) from verse-level entries
      chapterEntries = allEntries.filter(e => e.verseStart === 0);
      verseEntries = allEntries.filter(e => e.verseStart !== 0);
      
      if (allEntries.length === 0) {
        error = `No commentary available for ${book} ${chapter}:${verse}`;
      }
    } catch (err) {
      console.error('Failed to load commentary:', err);
      error = 'Failed to load commentary';
    } finally {
      loading = false;
    }
  }
  
  $effect(() => {
    if (isOpen && book && chapter && verse !== undefined) {
      loadCommentary();
    }
  });
  
  function close() {
    isOpen = false;
  }
  
  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }
</script>

{#if isOpen}
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div class="modal-container" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>Commentary: {book} {chapter}:{verse}</h2>
        <button class="close-btn" onclick={close} aria-label="Close">×</button>
      </div>
      
      {#if authors.length > 1}
        <div class="author-filter">
          <label for="author-select">Filter by author:</label>
          <select id="author-select" bind:value={selectedAuthor} onchange={loadCommentary}>
            <option value={undefined}>All Authors ({authors.length})</option>
            {#each authors as author}
              <option value={author}>{author}</option>
            {/each}
          </select>
        </div>
      {/if}
      
      <div class="modal-body">
        {#if loading}
          <div class="loading">
            <div class="spinner"></div>
            <p>Loading commentary...</p>
          </div>
        {:else if error}
          <div class="error">
            <p>{error}</p>
          </div>
        {:else if chapterEntries.length === 0 && verseEntries.length === 0}
          <div class="empty">
            <p>No commentary available for this verse.</p>
            <p class="help-text">
              Try selecting a different verse or check if the commentary pack is installed.
            </p>
          </div>
        {:else}
          {#if chapterEntries.length > 0}
            <div class="chapter-section">
              <div class="section-header">
                <span class="badge chapter-badge">📘 Chapter Commentary</span>
                <span class="chapter-reference">{book} {chapter}</span>
              </div>
              {#each chapterEntries as entry}
                <div class="commentary-entry chapter-entry">
                  <div class="entry-header">
                    <h3>{entry.author}</h3>
                    {#if entry.title}
                      <h4>{entry.title}</h4>
                    {/if}
                  </div>
                  <div class="entry-text">
                    {entry.text}
                  </div>
                  {#if entry.source || entry.year}
                    <div class="entry-source">
                      {#if entry.source}
                        — {entry.source}
                      {/if}
                      {#if entry.year}
                        ({entry.year})
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          
          {#if verseEntries.length > 0}
            {#if chapterEntries.length > 0}
              <div class="section-divider"></div>
            {/if}
            {#each verseEntries as entry}
              <div class="commentary-entry">
                <div class="entry-header">
                  <h3>{entry.author}</h3>
                  {#if entry.title}
                    <h4>{entry.title}</h4>
                  {/if}
                  {#if entry.verseEnd && entry.verseEnd > entry.verseStart}
                    <span class="verse-range">Verses {entry.verseStart}–{entry.verseEnd}</span>
                  {/if}
                </div>
                <div class="entry-text">
                  {entry.text}
                </div>
                {#if entry.source || entry.year}
                  <div class="entry-source">
                    {#if entry.source}
                      — {entry.source}
                    {/if}
                    {#if entry.year}
                      ({entry.year})
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  
  .modal-container {
    background: white;
    border-radius: 8px;
    max-width: 900px;
    width: 100%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #333;
  }
  
  .close-btn {
    font-size: 32px;
    border: none;
    background: none;
    cursor: pointer;
    color: #666;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s, color 0.2s;
  }
  
  .close-btn:hover {
    background: #f0f0f0;
    color: #333;
  }
  
  .author-filter {
    padding: 15px 20px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  
  .author-filter label {
    font-size: 14px;
    color: #666;
    font-weight: 500;
  }
  
  .author-filter select {
    padding: 8px 12px;
    font-size: 14px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    flex: 1;
    max-width: 300px;
  }
  
  .author-filter select:focus {
    outline: none;
    border-color: #4a90e2;
  }
  
  .modal-body {
    overflow-y: auto;
    padding: 20px;
    flex: 1;
  }
  
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #666;
  }
  
  .spinner {
    border: 3px solid #f3f3f3;
    border-top: 3px solid #4a90e2;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin-bottom: 15px;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .error {
    padding: 20px;
    background: #ffebee;
    border: 1px solid #ef5350;
    border-radius: 4px;
    color: #c62828;
  }
  
  .empty {
    text-align: center;
    padding: 40px 20px;
    color: #666;
  }
  
  .empty .help-text {
    font-size: 14px;
    color: #999;
    margin-top: 10px;
  }
  
  .chapter-section {
    margin-bottom: 2rem;
    padding: 1rem;
    background: #f0f7ff;
    border-radius: 8px;
    border-left: 4px solid #4a90e2;
  }
  
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.875rem;
    font-weight: 600;
  }
  
  .chapter-badge {
    background: #4a90e2;
    color: white;
  }
  
  .chapter-reference {
    font-size: 0.875rem;
    color: #666;
  }
  
  .chapter-entry {
    background: white;
    padding: 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    border-left: 3px solid #4a90e2;
  }
  
  .chapter-entry:last-child {
    margin-bottom: 0;
  }
  
  .section-divider {
    height: 2px;
    background: linear-gradient(to right, transparent, #e0e0e0, transparent);
    margin: 2rem 0;
  }
  
  .commentary-entry {
    margin-bottom: 30px;
    padding: 20px;
    border-left: 4px solid #4a90e2;
    background: #f9f9f9;
    border-radius: 4px;
  }
  
  .commentary-entry:last-child {
    margin-bottom: 0;
  }
  
  .entry-header {
    margin-bottom: 15px;
  }
  
  .entry-header h3 {
    margin: 0 0 5px 0;
    font-size: 1.1rem;
    color: #333;
    font-weight: 600;
  }
  
  .entry-header h4 {
    margin: 0 0 5px 0;
    font-size: 0.95rem;
    color: #666;
    font-weight: normal;
    font-style: italic;
  }
  
  .chapter-note,
  .verse-range {
    display: inline-block;
    font-size: 0.85rem;
    color: #888;
    font-style: italic;
    margin-top: 5px;
  }
  
  .entry-text {
    line-height: 1.7;
    color: #444;
    font-size: 1rem;
    white-space: pre-wrap;
  }
  
  .entry-source {
    margin-top: 15px;
    font-size: 0.9rem;
    color: #888;
    font-style: italic;
  }
  
  /* Mobile responsive */
  @media (max-width: 768px) {
    .modal-container {
      max-height: 90vh;
      margin: 10px;
    }
    
    .modal-header h2 {
      font-size: 1.2rem;
    }
    
    .author-filter {
      flex-direction: column;
      align-items: stretch;
    }
    
    .author-filter select {
      max-width: none;
    }
    
    .entry-text {
      font-size: 0.95rem;
    }
  }
</style>
