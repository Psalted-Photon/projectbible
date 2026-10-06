<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { navigationStore } from '../stores/navigationStore';
  import { syncedUserDataStore } from '../adapters/SyncedUserDataStore';
  import { IndexedDBTextStore } from '../lib/adapters';
  import { renderVersePreviewHtml } from '../lib/verseRendering';
  import { BIBLE_BOOKS } from '@projectbible/core';
  import type { HighlightStyle, UserNote } from '@projectbible/core';
  import { HIGHLIGHT_CATEGORIES, categoryKeyFor } from '../lib/highlightCategories';
  import { getHighlightNames, setHighlightName } from '../adapters/settings';
  import { reveal } from '../lib/motion';

  const dispatch = createEventDispatcher<{ close: void }>();

  const userDataStore = syncedUserDataStore;
  const textStore = new IndexedDBTextStore();

  // ─── sub-tab state ──────────────────────────────────────────────────────────
  type SubTab = 'verses' | 'notes';
  let activeTab: SubTab = 'verses';

  // ─── sort state ─────────────────────────────────────────────────────────────
  // 'categories' groups Highlights by the color code; Notes have no marks,
  // so on that tab it reads as Bible order.
  type SortOrder = 'recent' | 'bible' | 'categories';
  let sortOrder: SortOrder = 'recent';

  // ─── data ───────────────────────────────────────────────────────────────────
  interface SavedVerse {
    book: string;
    chapter: number;
    verse: number;
    text: string | null;
    createdAt: Date;
    /** Every category this verse's marks fall into (see highlightCategories). */
    categories: string[];
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

  // ─── categories view — each group in Bible order, empty groups hidden ─────────
  $: categoryGroups = sortOrder === 'categories'
    ? HIGHLIGHT_CATEGORIES
        .map((cat) => ({ cat, verses: sortedVerses.filter((v) => v.categories.includes(cat.key)) }))
        .filter((g) => g.verses.length > 0)
    : [];

  let folded = new Set<string>();
  function toggleFold(key: string) {
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    folded = folded;
  }

  // ─── naming — text colors and dashed start unnamed; the name follows the account ─
  let names: Record<string, string> = getHighlightNames();
  let editingKey: string | null = null;
  let editValue = '';

  function startEdit(key: string) {
    editingKey = key;
    editValue = names[key] ?? '';
  }

  function commitEdit() {
    if (editingKey === null) return;
    setHighlightName(editingKey, editValue);
    names = getHighlightNames();
    editingKey = null;
  }

  function editKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') editingKey = null;
  }

  function focusOnMount(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  // ─── data loading ────────────────────────────────────────────────────────────
  async function loadSavedVerses() {
    loadingVerses = true;
    try {
      const [highlights, wordHighlights] = await Promise.all([
        userDataStore.getHighlights(),
        userDataStore.getWordHighlights(),
      ]);

      // Deduplicate by book+chapter+verse, keeping the earliest createdAt and
      // collecting the category of every mark on the verse
      const map = new Map<string, { book: string; chapter: number; verse: number; createdAt: Date; categories: Set<string> }>();

      const addEntry = (book: string, chapter: number, verse: number, createdAt: Date, style: HighlightStyle) => {
        const key = `${book}|${chapter}|${verse}`;
        let entry = map.get(key);
        if (!entry) {
          entry = { book, chapter, verse, createdAt, categories: new Set() };
          map.set(key, entry);
        } else if (createdAt < entry.createdAt) {
          entry.createdAt = createdAt;
        }
        entry.categories.add(categoryKeyFor(style));
      };

      for (const h of highlights) {
        addEntry(h.reference.book, h.reference.chapter, h.reference.verse, h.createdAt, h.style);
      }
      for (const w of wordHighlights) {
        addEntry(w.reference.book, w.reference.chapter, w.reference.verse, w.createdAt, w.style);
      }

      const translation = $navigationStore.translation;

      // Fetch verse text for each unique verse
      const results = await Promise.all(
        Array.from(map.values()).map(async ({ book, chapter, verse, createdAt, categories }) => {
          const text = await textStore.getVerse(translation, book, chapter, verse);
          return { book, chapter, verse, text, createdAt, categories: [...categories] } satisfies SavedVerse;
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
    navigationStore.pushHistory(get(navigationStore), 'notes');
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

  // Highlights cycles Recent → Bible Order → Categories; Notes just the first two
  function toggleSort() {
    if (activeTab === 'notes') sortOrder = sortOrder === 'recent' ? 'bible' : 'recent';
    else sortOrder = sortOrder === 'recent' ? 'bible' : sortOrder === 'bible' ? 'categories' : 'recent';
  }

  $: sortLabel = sortOrder === 'recent' ? 'Recent'
    : sortOrder === 'categories' && activeTab === 'verses' ? 'Categories'
    : 'Bible Order';
</script>

<div class="svp-root">
  <!-- Sub-tab pills -->
  <div class="svp-pills">
    <button class="svp-pill" class:active={activeTab === 'verses'} on:click={() => (activeTab = 'verses')}>
      Highlights
    </button>
    <button class="svp-pill" class:active={activeTab === 'notes'} on:click={() => (activeTab = 'notes')}>
      Notes
    </button>
    <button class="svp-sort" on:click={toggleSort} title="Toggle sort order">
      {sortLabel}
    </button>
  </div>

  <!-- Highlights list -->
  {#if activeTab === 'verses'}
    {#if loadingVerses}
      <div class="svp-loading show-late">Loading…</div>
    {:else if sortedVerses.length === 0}
      <div class="svp-empty">No highlights yet — highlight or underline a verse while reading.</div>
    {:else if sortOrder === 'categories'}
      <div class="svp-groups">
        {#each categoryGroups as { cat, verses } (cat.key)}
          <section class="svp-group">
            <div class="svp-group-row">
            <button
              class="svp-group-header"
              class:svp-group-header--editing={editingKey === cat.key}
              on:click={() => toggleFold(cat.key)}
              aria-expanded={!folded.has(cat.key)}
            >
              <span class="svp-fold" class:svp-fold--closed={folded.has(cat.key)}>▾</span>
              {#if cat.kind === 'marker'}
                <span class="svp-sample svp-sample--marker" style="background: {cat.color}">Aa</span>
              {:else if cat.kind === 'text'}
                <span class="svp-sample" style="color: {cat.color}">Aa</span>
              {:else if cat.underlineStyle === 'boxed'}
                <span class="svp-sample svp-sample--boxed">Aa</span>
              {:else}
                <span class="svp-sample" style="text-decoration: underline {cat.underlineStyle} {cat.color ?? ''}; text-underline-offset: 3px;">Aa</span>
              {/if}
              {#if editingKey !== cat.key}
                <span class="svp-group-name">
                  {names[cat.key] || cat.label}
                  {#if names[cat.key]}<span class="svp-group-default">{cat.label}</span>{/if}
                </span>
                <span class="svp-group-count">{verses.length}</span>
              {/if}
            </button>
            {#if editingKey === cat.key}
              <input
                class="svp-name-input"
                bind:value={editValue}
                placeholder={cat.label}
                maxlength="40"
                aria-label="Name for {cat.label}"
                use:focusOnMount
                on:keydown={editKeydown}
                on:blur={commitEdit}
              />
            {:else if cat.nameable}
              <button class="svp-rename" on:click={() => startEdit(cat.key)} aria-label="Name this group" title="Name this group">✎</button>
            {/if}
            </div>
            {#if !folded.has(cat.key)}
              <ul class="svp-list" in:reveal>
                {#each verses as item (item.book + item.chapter + item.verse)}
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
                  <li class="svp-item" on:click={() => navigateTo(item.book, item.chapter, item.verse)}>
                    <div class="svp-item-header">
                      <span class="svp-ref">{formatRef(item.book, item.chapter, item.verse)}</span>
                    </div>
                    {#if item.text}
                      <span class="svp-text">{@html renderVersePreviewHtml(item.text)}</span>
                    {:else}
                      <span class="svp-text svp-text--missing">Text unavailable</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>
    {:else}
      <ul class="svp-list">
        {#each sortedVerses as item (item.book + item.chapter + item.verse)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <li class="svp-item" on:click={() => navigateTo(item.book, item.chapter, item.verse)}>
            <div class="svp-item-header">
              <span class="svp-ref">{formatRef(item.book, item.chapter, item.verse)}</span>
              {#if sortOrder === 'recent'}
                <span class="svp-date">{formatDate(item.createdAt)}</span>
              {/if}
            </div>
            {#if item.text}
              <span class="svp-text">{@html renderVersePreviewHtml(item.text)}</span>
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
      <div class="svp-loading show-late">Loading…</div>
    {:else if sortedNotes.length === 0}
      <div class="svp-empty">No notes yet — tap a verse and add a note while reading.</div>
    {:else}
      <ul class="svp-list">
        {#each sortedNotes as item (item.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
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
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .svp-text--missing {
    color: #555;
    font-style: italic;
  }

  /* ── categories ───────────────────────────────────────────────── */
  .svp-groups {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .svp-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .svp-group-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2a2a;
  }

  .svp-group-header {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 6px 4px;
    border: none;
    background: transparent;
    color: #ddd;
    cursor: pointer;
    font-size: 14px;
    text-align: left;
  }

  .svp-fold {
    margin-top: 2px;
    color: #777;
    font-size: 12px;
    transition: transform var(--motion-chevron-ms, 150ms) var(--ease-standard, ease);
  }

  .svp-fold--closed {
    transform: rotate(-90deg);
  }

  .svp-sample {
    min-width: 30px;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
    color: #ccc;
  }

  .svp-sample--marker {
    color: #111;
  }

  .svp-sample--boxed {
    outline: 2px solid #aaa;
    outline-offset: 1px;
  }

  .svp-group-name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    line-height: 1.35;
  }

  .svp-group-header--editing {
    flex: 0 0 auto;
  }

  .svp-group-default {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 400;
    color: #777;
  }

  .svp-name-input {
    flex: 1;
    min-width: 0;
    margin: 4px 6px 4px 0;
    padding: 3px 6px;
    border: 1px solid #4caf50;
    border-radius: 4px;
    background: #111;
    color: #eee;
    font: inherit;
    font-weight: 600;
  }

  .svp-rename {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: #888;
    cursor: pointer;
    font-size: 15px;
  }

  .svp-rename:hover {
    color: #ccc;
  }

  .svp-group-count {
    font-size: 12px;
    color: #777;
  }

  .svp-date {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
