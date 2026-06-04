<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { navigationStore } from '../stores/navigationStore';
  import { syncedUserDataStore } from '../adapters/SyncedUserDataStore';
  import { IndexedDBTextStore } from '../lib/adapters';
  import { BIBLE_BOOKS } from '@projectbible/core';
  import type { UserHighlight, UserWordHighlight, UserNote } from '@projectbible/core';

  const dispatch = createEventDispatcher<{ close: void }>();

  const userDataStore = syncedUserDataStore;
  const textStore = new IndexedDBTextStore();

  // ─── sub-tab state ──────────────────────────────────────────────────────────
  type SubTab = 'verses' | 'notes';
  let activeTab: SubTab = 'verses';

  // ─── sort state ─────────────────────────────────────────────────────────────
  type SortOrder = 'recent' | 'bible';
  let sortOrder: SortOrder = 'recent';

  // ─── data ───────────────────────────────────────────────────────────────────
  interface SavedVerse {
    book: string;
    chapter: number;
    verse: number;
    text: string | null;
    createdAt: Date;
  }

  interface SavedNote {
    id: string;
    book: string;
    chapter: number;
    verse: number;
    createdAt: Date;
  }

  let savedVerses: SavedVerse[] = [];
  let savedNotes: SavedNote[] = [];
  let loadingVerses = true;
  let loadingNotes = true;

  // ─── bible book order index (canonical Genesis→Revelation order) ─────────────
  const bookOrder = new Map<string, number>(
    BIBLE_BOOKS.map((b, i) => [b.name, i])
  );

  function bookIndex(book: string): number {
    return bookOrder.get(book) ?? 999;
  }

  // ─── sorting — sortOrder is a direct param so Svelte re-runs on every change ─
  function sortVerses(list: SavedVerse[], order: SortOrder): SavedVerse[] {
    return [...list].sort((a, b) => {
      if (order === 'recent') {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      const bi = bookIndex(a.book) - bookIndex(b.book);
      if (bi !== 0) return bi;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });
  }

  function sortNotes(list: SavedNote[], order: SortOrder): SavedNote[] {
    return [...list].sort((a, b) => {
      if (order === 'recent') {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      const bi = bookIndex(a.book) - bookIndex(b.book);
      if (bi !== 0) return bi;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });
  }

  $: sortedVerses = sortVerses(savedVerses, sortOrder);
  $: sortedNotes = sortNotes(savedNotes, sortOrder);

  // ─── data loading ────────────────────────────────────────────────────────────
  async function loadSavedVerses() {
    loadingVerses = true;
    try {
      const [highlights, wordHighlights] = await Promise.all([
        userDataStore.getHighlights(),
        userDataStore.getWordHighlights(),
      ]);

      // Deduplicate by book+chapter+verse, keeping the earliest createdAt
      const map = new Map<string, { book: string; chapter: number; verse: number; createdAt: Date }>();

      const addEntry = (book: string, chapter: number, verse: number, createdAt: Date) => {
        const key = `${book}|${chapter}|${verse}`;
        const existing = map.get(key);
        if (!existing || createdAt < existing.createdAt) {
          map.set(key, { book, chapter, verse, createdAt });
        }
      };

      for (const h of highlights) {
        addEntry(h.reference.book, h.reference.chapter, h.reference.verse, h.createdAt);
      }
      for (const w of wordHighlights) {
        addEntry(w.reference.book, w.reference.chapter, w.reference.verse, w.createdAt);
      }

      const translation = $navigationStore.translation;

      // Fetch verse text for each unique verse
      const results = await Promise.all(
        Array.from(map.values()).map(async ({ book, chapter, verse, createdAt }) => {
          const text = await textStore.getVerse(translation, book, chapter, verse);
          return { book, chapter, verse, text, createdAt } satisfies SavedVerse;
        })
      );

      savedVerses = results;
    } catch (e) {
      console.error('Error loading saved verses:', e);
      savedVerses = [];
    } finally {
      loadingVerses = false;
    }
  }

  async function loadNotes() {
    loadingNotes = true;
    try {
      const notes: UserNote[] = await userDataStore.getNotes();
      savedNotes = notes.map(n => ({
        id: n.id,
        book: n.reference.book,
        chapter: n.reference.chapter,
        verse: n.reference.verse,
        createdAt: n.createdAt,
      }));
    } catch (e) {
      console.error('Error loading notes:', e);
      savedNotes = [];
    } finally {
      loadingNotes = false;
    }
  }

  onMount(() => {
    loadSavedVerses();
    loadNotes();
  });

  // ─── navigation ──────────────────────────────────────────────────────────────
  function navigateTo(book: string, chapter: number, verse: number) {
    navigationStore.navigateTo($navigationStore.translation, book, chapter, verse);
    dispatch('close');
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────
  function formatRef(book: string, chapter: number, verse: number): string {
    return `${book} ${chapter}:${verse}`;
  }

  function formatDate(d: Date): string {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toggleSort() {
    sortOrder = sortOrder === 'recent' ? 'bible' : 'recent';
  }
</script>

<div class="svp-root">
  <!-- Sub-tab pills -->
  <div class="svp-pills">
    <button class="svp-pill" class:active={activeTab === 'verses'} on:click={() => (activeTab = 'verses')}>
      Saved Verses
    </button>
    <button class="svp-pill" class:active={activeTab === 'notes'} on:click={() => (activeTab = 'notes')}>
      Notes
    </button>
    <button class="svp-sort" on:click={toggleSort} title="Toggle sort order">
      {sortOrder === 'recent' ? 'Recent' : 'Bible Order'}
    </button>
  </div>

  <!-- Saved Verses list -->
  {#if activeTab === 'verses'}
    {#if loadingVerses}
      <div class="svp-loading">Loading…</div>
    {:else if sortedVerses.length === 0}
      <div class="svp-empty">No saved verses yet — highlight or underline a verse while reading.</div>
    {:else}
      <ul class="svp-list">
        {#each sortedVerses as item (item.book + item.chapter + item.verse)}
          <li class="svp-item" on:click={() => navigateTo(item.book, item.chapter, item.verse)}>
            <div class="svp-item-header">
              <span class="svp-ref">{formatRef(item.book, item.chapter, item.verse)}</span>
              {#if sortOrder === 'recent'}
                <span class="svp-date">{formatDate(item.createdAt)}</span>
              {/if}
            </div>
            {#if item.text}
              <span class="svp-text">{item.text}</span>
            {:else}
              <span class="svp-text svp-text--missing">Text unavailable</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <!-- Notes list -->
  {#if activeTab === 'notes'}
    {#if loadingNotes}
      <div class="svp-loading">Loading…</div>
    {:else if sortedNotes.length === 0}
      <div class="svp-empty">No notes yet — tap a verse and add a note while reading.</div>
    {:else}
      <ul class="svp-list">
        {#each sortedNotes as item (item.id)}
          <li class="svp-item" on:click={() => navigateTo(item.book, item.chapter, item.verse)}>
            <div class="svp-item-header">
              <span class="svp-ref">{formatRef(item.book, item.chapter, item.verse)}</span>
              {#if sortOrder === 'recent'}
                <span class="svp-date">{formatDate(item.createdAt)}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .svp-root {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── pills row ────────────────────────────────────────────────── */
  .svp-pills {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .svp-pill {
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid #3a3a3a;
    background: #252525;
    color: #ccc;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .svp-pill.active {
    background: #4caf50;
    border-color: #4caf50;
    color: #fff;
  }

  .svp-sort {
    margin-left: auto;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 12px;
    transition: color 0.15s, border-color 0.15s;
  }

  .svp-sort:hover {
    color: #ccc;
    border-color: #555;
  }

  /* ── states ───────────────────────────────────────────────────── */
  .svp-loading,
  .svp-empty {
    padding: 24px 0;
    text-align: center;
    color: #777;
    font-size: 14px;
  }

  /* ── list ─────────────────────────────────────────────────────── */
  .svp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .svp-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #2a2a2a;
    background: #1a1a1a;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .svp-item:hover {
    background: #242424;
    border-color: #3a3a3a;
  }

  .svp-item-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .svp-ref {
    font-size: 13px;
    font-weight: 600;
    color: #9ccc65;
  }

  .svp-text {
    font-size: 13px;
    color: #c0c0c0;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .svp-text--missing {
    color: #555;
    font-style: italic;
  }

  .svp-date {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
