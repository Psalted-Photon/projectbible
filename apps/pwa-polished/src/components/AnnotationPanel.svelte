<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import type { CommentaryEntry } from "../adapters/CommentaryStore";
  import type { TskEntry } from "../adapters/TskReferenceStore";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { getAuthorColor, getAuthorInitials, TSK_COLOR } from "../lib/annotationConfig";
  import { parseRefString } from "../lib/parseRefString";
  import { navigationStore } from "../stores/navigationStore";

  export let open = false;
  export let book = "";
  export let chapter = 0;
  export let verse = 0;
  export let tskEntries: TskEntry[] = [];
  export let commentaryEntries: CommentaryEntry[] = [];
  export let initialTab: "references" | "commentary" = "references";

  // ——— Internal display state (list mode) ———
  let displayBook = book;
  let displayChapter = chapter;
  let displayVerse = verse;
  let displayTskEntries: TskEntry[] = tskEntries;
  let displayCommentaryEntries: CommentaryEntry[] = commentaryEntries;

  // ——— Verse-view mode state ———
  type PanelMode = 'list' | 'verseView';
  let panelMode: PanelMode = 'list';
  let viewVerses: Array<{ book: string; chapter: number; verse: number; text: string; heading?: string | null }> = [];
  let viewBook = '';
  let viewChapter = 0;
  let viewTargetVerse = 0;
  let viewBodyEl: HTMLDivElement | null = null;

  interface HistoryEntry {
    mode: 'list';
    book: string;
    chapter: number;
    verse: number;
    tskEntries: TskEntry[];
    commentaryEntries: CommentaryEntry[];
    tab: 'references' | 'commentary';
  }
  let panelHistory: HistoryEntry[] = [];
  let panelLoading = false;
  let lastPropsKey = '';

  // Sync display state from props whenever the source verse changes or panel re-opens.
  $: {
    const key = open ? `${book}:${chapter}:${verse}` : '';
    if (open && key !== lastPropsKey) {
      lastPropsKey = key;
      panelHistory = [];
      panelMode = 'list';
      displayBook = book;
      displayChapter = chapter;
      displayVerse = verse;
      displayTskEntries = tskEntries;
      displayCommentaryEntries = commentaryEntries;
    } else if (!open && lastPropsKey !== '') {
      lastPropsKey = '';
      panelHistory = [];
      panelMode = 'list';
    }
  }

  // Auto-scroll highlighted verse into view after viewVerses renders.
  $: if (panelMode === 'verseView' && viewVerses.length > 0) {
    // Wait one tick for the DOM to render, then scroll.
    setTimeout(() => {
      const el = viewBodyEl?.querySelector('.view-verse.highlighted') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  const textStore = new IndexedDBTextStore();

  let activeTab: "references" | "commentary" = initialTab;
  $: if (open) activeTab = initialTab;

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch("close");
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  async function handleRefClick(ref: string) {
    const target = parseRefString(ref, displayBook, displayChapter);
    if (!target) return;
    panelLoading = true;
    // Push current list-mode state so Back can restore it.
    panelHistory = [...panelHistory, {
      mode: 'list',
      book: displayBook,
      chapter: displayChapter,
      verse: displayVerse,
      tskEntries: displayTskEntries,
      commentaryEntries: displayCommentaryEntries,
      tab: activeTab,
    }];
    const translation = get(navigationStore).translation;
    const verses = await textStore.getChapter(translation, target.book, target.chapter);
    viewVerses = verses;
    viewBook = target.book;
    viewChapter = target.chapter;
    viewTargetVerse = target.verse;
    panelMode = 'verseView';
    panelLoading = false;
  }

  function handlePanelBack() {
    const prev = panelHistory[panelHistory.length - 1];
    if (!prev) return;
    panelHistory = panelHistory.slice(0, -1);
    panelMode = 'list';
    displayBook = prev.book;
    displayChapter = prev.chapter;
    displayVerse = prev.verse;
    displayTskEntries = prev.tskEntries;
    displayCommentaryEntries = prev.commentaryEntries;
    activeTab = prev.tab;
  }

  // Group TSK entries by keyword
  $: tskByKeyword = groupTskByKeyword(displayTskEntries);

  function groupTskByKeyword(entries: TskEntry[]): Array<{ keyword: string | null; refs: string[] }> {
    const map = new Map<string, string[]>();
    const order: Array<string | null> = [];
    for (const entry of entries) {
      const key = entry.keyword ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(entry.keyword);
      }
      map.get(key)!.push(...entry.references);
    }
    return order.map((k) => ({ keyword: k, refs: map.get(k ?? "") ?? [] }));
  }

  // Group commentary entries by author
  $: commentaryByAuthor = groupCommentaryByAuthor(displayCommentaryEntries);

  function groupCommentaryByAuthor(
    entries: CommentaryEntry[]
  ): Array<{ author: string; entries: CommentaryEntry[] }> {
    const map = new Map<string, CommentaryEntry[]>();
    for (const entry of entries) {
      if (!map.has(entry.author)) map.set(entry.author, []);
      map.get(entry.author)!.push(entry);
    }
    return Array.from(map.entries()).map(([author, entries]) => ({ author, entries }));
  }

  function verseLabel(): string {
    if (panelMode === 'verseView') {
      return viewBook ? `${viewBook} ${viewChapter}` : '';
    }
    if (!displayBook) return '';
    return displayVerse
      ? `${displayBook} ${displayChapter}:${displayVerse}`
      : `${displayBook} ${displayChapter}`;
  }
</script>

<!-- Backdrop (click-away to close) -->
{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="panel-backdrop" on:click={handleBackdropClick}></div>
{/if}

<div class="annotation-panel" class:open>
  <!-- Header -->
  <div class="panel-header">
    {#if panelHistory.length > 0}
      <button class="panel-back-btn" on:click={handlePanelBack}>← Back</button>
    {/if}
    {#if panelMode === 'list'}
      <div class="panel-tabs">
        <button
          class="tab-btn"
          class:active={activeTab === "references"}
          on:click={() => (activeTab = "references")}
        >
          ◆ References
          {#if displayTskEntries.length > 0}
            <span class="badge" style="background:{TSK_COLOR}">{displayTskEntries.length}</span>
          {/if}
        </button>
        <button
          class="tab-btn"
          class:active={activeTab === "commentary"}
          on:click={() => (activeTab = "commentary")}
        >
          ● Commentaries
          {#if displayCommentaryEntries.length > 0}
            <span class="badge" style="background:#666">{displayCommentaryEntries.length}</span>
          {/if}
        </button>
      </div>
    {/if}
    <div class="panel-title">{verseLabel()}</div>
    <button class="close-btn" on:click={close} aria-label="Close">✕</button>
  </div>

  <!-- Content -->
  <div class="panel-body" bind:this={viewBodyEl}>
    {#if panelLoading}
      <div class="panel-loading">Loading…</div>
    {:else if panelMode === 'verseView'}
      <!-- ——— Mini verse reader ——— -->
      <div class="view-chapter-header">{viewBook} {viewChapter}</div>
      {#each viewVerses as v (v.verse)}
        {#if v.heading}
          <div class="view-heading">{v.heading}</div>
        {/if}
        <div class="view-verse" class:highlighted={v.verse === viewTargetVerse}>
          <span class="view-verse-num">{v.verse}</span>
          <span class="view-verse-text">{v.text}</span>
        </div>
      {/each}
      {#if viewVerses.length === 0}
        <p class="empty-msg">No text found for {viewBook} {viewChapter}.<br/><span class="hint">Make sure a Bible translation pack is installed.</span></p>
      {/if}
    {:else}
      <!-- ——— List mode: tabs ——— -->
      {#if activeTab === "references"}
        {#if displayTskEntries.length === 0}
          <p class="empty-msg">No TSK cross-references for this verse.<br/><span class="hint">Import the <em>tsk-references.sqlite</em> pack to enable them.</span></p>
        {:else}
          {#each tskByKeyword as group}
            <div class="ref-group">
              {#if group.keyword}
                <div class="ref-keyword">
                  <span class="diamond" style="color:{TSK_COLOR}">◆</span>
                  <strong>{group.keyword}</strong>
                </div>
              {/if}
              <ul class="ref-list">
                {#each group.refs as ref}
                  {@const refTarget = parseRefString(ref, displayBook, displayChapter)}
                  <li class="ref-item">
                    <button
                      class="ref-link-btn"
                      class:navigable={!!refTarget}
                      on:click={() => handleRefClick(ref)}
                    >{ref}</button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}
      {/if}

      {#if activeTab === "commentary"}
        {#if displayCommentaryEntries.length === 0}
          <p class="empty-msg">No commentary for this verse.<br/><span class="hint">Import the <em>commentaries.sqlite</em> pack to enable them.</span></p>
        {:else}
          {#each commentaryByAuthor as group}
            <div class="commentary-group">
              <div
                class="commentary-author-header"
                style="border-left: 4px solid {getAuthorColor(group.author)}"
              >
                <span
                  class="author-badge"
                  style="background:{getAuthorColor(group.author)}"
                  title={group.author}
                >{getAuthorInitials(group.author)}</span>
                <span class="author-name">{group.author}</span>
              </div>
              {#each group.entries as entry}
                {#if entry.title && entry.title !== group.author}
                  <div class="entry-title">{entry.title}</div>
                {/if}
                <div class="entry-text">{@html entry.text}</div>
              {/each}
            </div>
          {/each}
        {/if}
      {/if}
    {/if}
  </div>
</div>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 299;
  }

  .annotation-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 52vh;
    min-height: 280px;
    background: #1e1e1e;
    color: #e0e0e0;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.5);
    z-index: 300;
    display: flex;
    flex-direction: column;
    transform: translateY(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }

  .annotation-panel.open {
    transform: translateY(0);
  }

  /* ——— Header ——— */
  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 0;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .panel-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .tab-btn.active {
    color: #e0e0e0;
    border-bottom-color: #667eea;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    padding: 0 4px;
  }

  .panel-title {
    font-size: 12px;
    color: #777;
    white-space: nowrap;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: #e0e0e0;
    background: #333;
  }

  /* ——— Body ——— */
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px 24px;
    overscroll-behavior: contain;
  }

  /* ——— References ——— */
  .ref-group {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #2a2a2a;
  }

  .ref-group:last-child {
    border-bottom: none;
  }

  .ref-keyword {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #ccc;
  }

  .diamond {
    font-size: 10px;
  }

  .ref-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }

  .ref-item {
    font-size: 12px;
    color: #8ab4f8;
    cursor: default;
  }

  /* ——— Commentary ——— */
  .commentary-group {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid #2a2a2a;
  }

  .commentary-group:last-child {
    border-bottom: none;
  }

  .commentary-author-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding-left: 8px;
  }

  .author-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .author-name {
    font-size: 13px;
    font-weight: 600;
    color: #ccc;
  }

  .entry-title {
    font-size: 12px;
    font-weight: 600;
    color: #888;
    margin-bottom: 4px;
    padding-left: 8px;
  }

  .entry-text {
    font-size: 13px;
    line-height: 1.6;
    color: #d0d0d0;
    padding-left: 8px;
    margin-bottom: 8px;
  }

  /* ——— Empty states ——— */
  .empty-msg {
    color: #666;
    font-size: 13px;
    margin-top: 20px;
    text-align: center;
    line-height: 1.8;
  }

  .hint {
    font-size: 11px;
    color: #555;
  }

  /* ——— Panel back button ——— */
  .panel-back-btn {
    background: none;
    border: 1px solid #444;
    color: #aaa;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .panel-back-btn:hover {
    color: #e0e0e0;
    border-color: #667eea;
  }

  /* ——— Clickable ref link buttons ——— */
  .ref-link-btn {
    background: none;
    border: none;
    color: #8ab4f8;
    font: inherit;
    font-size: 12px;
    padding: 0;
    cursor: default;
    text-align: left;
  }

  .ref-link-btn.navigable {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }

  .ref-link-btn.navigable:hover {
    color: #c0d8ff;
    text-decoration-style: solid;
  }

  /* ——— Loading indicator ——— */
  .panel-loading {
    color: #666;
    font-size: 12px;
    padding: 8px 0 4px;
    text-align: center;
  }

  /* ——— Verse-view mini reader ——— */
  .view-chapter-header {
    font-size: 15px;
    font-weight: 700;
    color: #ccc;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2a2a2a;
  }

  .view-heading {
    font-size: 12px;
    font-weight: 600;
    color: #777;
    margin: 10px 0 4px;
    font-style: italic;
  }

  .view-verse {
    display: flex;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    margin-bottom: 2px;
    line-height: 1.7;
  }

  .view-verse.highlighted {
    background: rgba(255, 215, 0, 0.1);
    border-left: 3px solid rgba(255, 215, 0, 0.6);
    padding-left: 8px;
  }

  .view-verse-num {
    font-size: 10px;
    color: #555;
    flex-shrink: 0;
    padding-top: 4px;
    min-width: 18px;
    text-align: right;
  }

  .view-verse.highlighted .view-verse-num {
    color: rgba(255, 215, 0, 0.7);
  }

  .view-verse-text {
    font-size: 14px;
    color: #d8d8d8;
  }
</style>
