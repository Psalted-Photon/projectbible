<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { get } from "svelte/store";
  import type { CommentaryEntry } from "../adapters/CommentaryStore";
  import type { TskEntry } from "../adapters/TskReferenceStore";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { getAuthorColor, getAuthorInitials, TSK_COLOR } from "../lib/annotationConfig";
  import { parseRefString } from "../lib/parseRefString";
  import { linkifyCommentaryRefs } from "../lib/linkifyCommentaryRefs";
  import { navigationStore } from "../stores/navigationStore";

  export let open = false;
  export let book = "";
  export let chapter = 0;
  export let verse = 0;
  export let tskEntries: TskEntry[] = [];
  export let commentaryEntries: CommentaryEntry[] = [];
  export let initialTab: "references" | "commentary" = "references";
  // Which commentary author to scroll to when the panel opens ('' = scroll to top only)
  export let targetAuthor: string = '';

  // ——— Internal display state (list mode) ———
  let displayBook = book;
  let displayChapter = chapter;
  let displayVerse = verse;
  let displayTskEntries: TskEntry[] = tskEntries;
  let displayCommentaryEntries: CommentaryEntry[] = commentaryEntries;

  // ——— Verse-view mode state ———
  type VerseItem = { book: string; chapter: number; verse: number; text: string; heading?: string | null };
  type PanelMode = 'list' | 'verseView';
  let panelMode: PanelMode = 'list';
  let viewVerses: VerseItem[] = [];
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

  // Single-verse pill popup (shown before expanding to full verseView)
  let pillPreview: { book: string; chapter: number; verse: number; text: string; allVerses: VerseItem[] } | null = null;

  let panelLoading = false;
  let lastPropsKey = '';
  let lastTargetAuthor = '';

  /** Scrolls the panel body to the top, then (if an author is given) into that author's section. */
  function scrollToTarget(author: string) {
    if (!viewBodyEl) return;
    viewBodyEl.scrollTop = 0;
    if (!author) return;
    const id = authorToId(author);
    const el = viewBodyEl.querySelector(`#${id}`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'start' });
  }

  // Sync display state from props whenever the source verse changes or panel re-opens.
  $: {
    const key = open ? `${book}:${chapter}:${verse}` : '';
    if (open && key !== lastPropsKey) {
      lastPropsKey = key;
      lastTargetAuthor = targetAuthor; // capture so secondary block doesn't double-fire
      panelHistory = [];
      panelMode = 'list';
      pillPreview = null;
      displayBook = book;
      displayChapter = chapter;
      displayVerse = verse;
      displayTskEntries = tskEntries;
      displayCommentaryEntries = commentaryEntries;
      // Bug 1: always reset scroll; Bug 2: jump to clicked author if provided
      tick().then(() => scrollToTarget(targetAuthor));
    } else if (!open && lastPropsKey !== '') {
      lastPropsKey = '';
      lastTargetAuthor = '';
      panelHistory = [];
      panelMode = 'list';
      pillPreview = null;
    }
  }

  // Secondary reactive: same verse but a different author icon was clicked
  $: if (open && panelMode === 'list' && targetAuthor !== lastTargetAuthor) {
    lastTargetAuthor = targetAuthor;
    tick().then(() => scrollToTarget(targetAuthor));
  }

  // Auto-scroll highlighted verse into view after verseView renders.
  $: if (panelMode === 'verseView' && viewVerses.length > 0) {
    setTimeout(() => {
      const el = viewBodyEl?.querySelector('.view-verse.highlighted') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  const textStore = new IndexedDBTextStore();

  let activeTab: "references" | "commentary" = initialTab;
  $: if (open) activeTab = initialTab;

  const dispatch = createEventDispatcher<{ close: void; navigateTo: { book: string; chapter: number; verse: number } }>();

  function close() {
    dispatch("close");
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  async function handleRefClick(ref: string) {
    const target = parseRefString(ref, displayBook, displayChapter);
    if (!target) return;
    const savedScrollTop = viewBodyEl?.scrollTop ?? 0;
    panelLoading = true;
    const translation = get(navigationStore).translation;
    const verses = await textStore.getChapter(translation, target.book, target.chapter);
    const targetVerse = verses.find(v => v.verse === target.verse);
    pillPreview = {
      book: target.book,
      chapter: target.chapter,
      verse: target.verse,
      text: targetVerse?.text ?? '',
      allVerses: verses,
    };
    panelLoading = false;
    await tick();
    if (viewBodyEl) viewBodyEl.scrollTop = savedScrollTop;
  }

  function handlePillClick() {
    if (!pillPreview) return;
    panelHistory = [...panelHistory, {
      mode: 'list',
      book: displayBook,
      chapter: displayChapter,
      verse: displayVerse,
      tskEntries: displayTskEntries,
      commentaryEntries: displayCommentaryEntries,
      tab: activeTab,
    }];
    viewVerses = pillPreview.allVerses;
    viewBook = pillPreview.book;
    viewChapter = pillPreview.chapter;
    viewTargetVerse = pillPreview.verse;
    pillPreview = null;
    panelMode = 'verseView';
  }

  function dismissPill() {
    pillPreview = null;
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

  function handleViewVerseClick(v: VerseItem) {
    dispatch('navigateTo', { book: v.book, chapter: v.chapter, verse: v.verse });
    close();
  }

  // Event delegation for commentary-ref spans injected by linkifyCommentaryRefs.
  function handleCommentaryBodyClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('commentary-ref')) return;
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    const ref = target.dataset.ref;
    if (ref) handleRefClick(ref);
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

  /** Converts an author name to a DOM-safe id, e.g. "King Comments" → "cg-king-comments" */
  function authorToId(author: string): string {
    return 'cg-' + author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

  function trimKeyword(kw: string | null): string {
    if (!kw) return '';
    const cut = kw.indexOf('"');
    const phrase = cut > 0 ? kw.slice(0, cut).trimEnd() : kw;
    return phrase.length > 80 ? phrase.slice(0, 80) + '…' : phrase;
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
      <!-- ——— Full chapter reader ——— -->
      <div class="view-chapter-header">{viewBook} {viewChapter}</div>
      {#each viewVerses as v (v.verse)}
        {#if v.heading}
          <div class="view-heading">{v.heading}</div>
        {/if}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div
          class="view-verse"
          class:highlighted={v.verse === viewTargetVerse}
          style={v.verse === viewTargetVerse ? 'cursor:pointer' : ''}
          on:click={() => { if (v.verse === viewTargetVerse) handleViewVerseClick(v); }}
        >
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
                  <strong title={group.keyword}>{trimKeyword(group.keyword)}</strong>
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
            <div class="commentary-group" id={authorToId(group.author)}>
              <div
                class="commentary-author-header"
                style="border-left: 4px solid {getAuthorColor(group.author)}"
              >
                <span
                  class="author-badge"
                  style="background:radial-gradient(circle, {getAuthorColor(group.author)} 0%, {getAuthorColor(group.author)} 20%, #431407 100%)"
                  title={group.author}
                >{getAuthorInitials(group.author)}</span>
                <span class="author-name">{group.author}</span>
              </div>
              {#each group.entries as entry}
                {#if entry.title && entry.title !== group.author}
                  <div class="entry-title">{entry.title}</div>
                {/if}
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div
                  class="entry-text"
                  on:click={handleCommentaryBodyClick}
                  on:keydown={handleCommentaryBodyClick}
                >{@html linkifyCommentaryRefs(entry.text, entry.book, entry.chapter, entry.author)}</div>
              {/each}
            </div>
          {/each}
        {/if}
      {/if}
    {/if}
  </div>

  <!-- Single-verse pill popup -->
  {#if pillPreview !== null}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="pill-overlay" on:click={dismissPill}>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="pill-card" on:click|stopPropagation>
        <div class="pill-ref-label">{pillPreview.book} {pillPreview.chapter}:{pillPreview.verse}</div>
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div class="pill-verse-text" on:click={handlePillClick}>
          {#if pillPreview.text}
            {pillPreview.text}
          {:else}
            <span class="hint">Verse text not available.</span>
          {/if}
        </div>
        <div class="pill-hint">Tap to expand chapter</div>
      </div>
    </div>
  {/if}
</div>

<style>
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 299;
    pointer-events: none;
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
    overflow: hidden;
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
    font-family: 'Merriweather', Georgia, serif;
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

  /* ——— Verse-view full chapter reader ——— */
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

  .view-verse.highlighted:hover {
    background: rgba(255, 215, 0, 0.18);
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

  /* ——— Single-verse pill popup ——— */
  .pill-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(1px);
    z-index: 10;
    display: flex;
    align-items: flex-end;
    padding: 12px 16px;
    border-radius: 16px 16px 0 0;
  }

  .pill-card {
    background: #2a2a2a;
    border-radius: 10px;
    padding: 12px 14px;
    width: 100%;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
  }

  .pill-ref-label {
    font-size: 11px;
    color: #888;
    font-weight: 600;
    letter-spacing: 0.3px;
    margin-bottom: 6px;
  }

  .pill-verse-text {
    font-size: 15px;
    color: #e8e8e8;
    line-height: 1.65;
    cursor: pointer;
    user-select: none;
  }

  .pill-verse-text:hover {
    color: #fff;
  }

  .pill-hint {
    font-size: 10px;
    color: #555;
    margin-top: 8px;
  }

  /* ——— Inline commentary ref links ——— */
  :global(.commentary-ref) {
    color: var(--ref-color, #8ab4f8);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;
    border-radius: 2px;
    padding: 0 1px;
  }

  :global(.commentary-ref:hover) {
    color: color-mix(in srgb, var(--ref-color, #8ab4f8) 70%, white);
    text-decoration-style: solid;
    background: color-mix(in srgb, var(--ref-color, #8ab4f8) 12%, transparent);
  }
</style>
