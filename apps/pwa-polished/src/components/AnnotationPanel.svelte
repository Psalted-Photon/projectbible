<script lang="ts">
  import { createEventDispatcher, tick } from "svelte";
  import { get } from "svelte/store";
  import type { CommentaryEntry } from "../adapters/CommentaryStore";
  import type { TskEntry } from "../adapters/TskReferenceStore";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { renderVersePreviewHtml } from "../lib/verseRendering";
  import { getAuthorColor, getAuthorInitials, TSK_COLOR } from "../lib/annotationConfig";
  import { parseRefString } from "../lib/parseRefString";
  import { getBookColor } from "../lib/bibleData";
  import { linkifyCommentaryRefs } from "../lib/linkifyCommentaryRefs";
  import { navigationStore } from "../stores/navigationStore";
  import { fixedOrigin } from "../lib/fixedOrigin";
  import AuthorPill from "./AuthorPill.svelte";

  export let open = false;
  export let book = "";
  export let chapter = 0;
  export let verse = 0;
  export let tskEntries: TskEntry[] = [];
  export let commentaryEntries: CommentaryEntry[] = [];
  export let initialTab: "references" | "commentary" = "references";
  // Which commentary author to scroll to when the panel opens ('' = scroll to top only)
  export let targetAuthor: string = '';
  /** The reader's box in viewport coordinates, so the sheet tracks it instead of
      spanning the whole screen when a window is docked left or right. */
  export let panelLeft = 0;
  export let panelWidth = 0;

  // The sheet is `position: fixed`, but what that resolves against depends on the
  // theme — see lib/fixedOrigin.ts. panelLeft arrives in viewport coordinates, so
  // rebase it onto whatever box we are actually being placed in.
  let sheetEl: HTMLDivElement;
  let originLeft = 0;
  // Re-measure whenever the reader moves or the sheet is shown; a theme change
  // swaps the containing block out from under us, and opening is the first point
  // at which that could have happened unnoticed.
  $: if (sheetEl) {
    void panelLeft; void panelWidth; void open;
    originLeft = fixedOrigin(sheetEl).left;
  }
  // Until the reader has been measured, stay full-bleed rather than collapsing to
  // zero width on the first paint.
  $: sheetStyle =
    panelWidth > 0
      ? `left:${panelLeft - originLeft}px; width:${panelWidth}px; right:auto;`
      : '';

  // ——— Internal display state (list mode) ———
  let displayBook = book;
  let displayChapter = chapter;
  let displayVerse = verse;
  let displayTskEntries: TskEntry[] = tskEntries;
  let displayCommentaryEntries: CommentaryEntry[] = commentaryEntries;

  let bodyEl: HTMLDivElement | null = null;

  /**
   * A tapped reference's verse, shown over the bottom of the sheet. Tapping it
   * goes there in the reader itself, with the usual start-here mark and a crumb
   * back, rather than into a cut-down copy of the chapter inside the sheet.
   */
  let pillPreview: { book: string; chapter: number; verse: number; text: string } | null = null;

  let panelLoading = false;
  let lastPropsKey = '';
  let lastTargetAuthor = '';

  /**
   * How far down the panel is scrolled, and how to put it back.
   *
   * A long commentary is read by scrolling, so a link tapped near the bottom of
   * one should come back to that spot rather than to the top of the article.
   */
  export function bodyScrollTop(): number {
    return bodyEl?.scrollTop ?? 0;
  }

  export function scrollBodyTo(top: number): void {
    if (bodyEl) bodyEl.scrollTop = top;
  }

  /** Scrolls the panel body to the top, then (if an author is given) into that author's section. */
  function scrollToTarget(author: string) {
    if (!bodyEl) return;
    bodyEl.scrollTop = 0;
    if (!author) return;
    const id = authorToId(author);
    const el = bodyEl.querySelector(`#${id}`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'start' });
  }

  // Sync display state from props whenever the source verse changes or panel re-opens.
  $: {
    const key = open ? `${book}:${chapter}:${verse}` : '';
    if (open && key !== lastPropsKey) {
      lastPropsKey = key;
      lastTargetAuthor = targetAuthor; // capture so secondary block doesn't double-fire
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
      pillPreview = null;
    }
  }

  // Secondary reactive: same verse but a different author icon was clicked
  $: if (open && targetAuthor !== lastTargetAuthor) {
    lastTargetAuthor = targetAuthor;
    tick().then(() => scrollToTarget(targetAuthor));
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
    const savedScrollTop = bodyEl?.scrollTop ?? 0;
    panelLoading = true;
    const translation = get(navigationStore).translation;
    const verses = await textStore.getChapter(translation, target.book, target.chapter);
    const targetVerse = verses.find(v => v.verse === target.verse);
    pillPreview = {
      book: target.book,
      chapter: target.chapter,
      verse: target.verse,
      text: targetVerse?.text ?? '',
    };
    panelLoading = false;
    await tick();
    if (bodyEl) bodyEl.scrollTop = savedScrollTop;
  }

  /** Go to the previewed verse in the reader. The reader closes the sheet and leaves a crumb. */
  function handlePillClick() {
    if (!pillPreview) return;
    const { book: toBook, chapter: toChapter, verse: toVerse } = pillPreview;
    pillPreview = null;
    dispatch('navigateTo', { book: toBook, chapter: toChapter, verse: toVerse });
  }

  function dismissPill() {
    pillPreview = null;
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

<div class="annotation-panel" class:open bind:this={sheetEl} style={sheetStyle}>
  <!-- Header -->
  <div class="panel-header">
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
    <div class="panel-title">{verseLabel()}</div>
    <button class="close-btn" on:click={close} aria-label="Close">✕</button>
  </div>

  <!-- Content -->
  <div class="panel-body" bind:this={bodyEl}>
    {#if panelLoading}
      <div class="panel-loading">Loading…</div>
    {:else}
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
                      style="--ref-color:{refTarget ? getBookColor(refTarget.book) : '#8ab4f8'}"
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
                <AuthorPill
                  variant="round"
                  color={getAuthorColor(group.author)}
                  initials={getAuthorInitials(group.author)}
                  title={group.author}
                />
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
            {@html renderVersePreviewHtml(pillPreview.text)}
          {:else}
            <span class="hint">Verse text not available.</span>
          {/if}
        </div>
        <div class="pill-hint">Tap to go there</div>
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
    /* left/width are overridden inline once the reader has been measured, so the
       sheet narrows with the text when a window is docked. `right` stays out of
       it — setting all three would over-constrain the box. */
    left: 0;
    width: 100%;
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

  /* ——— Clickable ref link buttons ——— */
  .ref-link-btn {
    background: none;
    border: none;
    color: var(--ref-color, #8ab4f8);
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
    color: color-mix(in srgb, var(--ref-color, #8ab4f8) 70%, white);
    text-decoration-style: solid;
  }

  /* ——— Loading indicator ——— */
  .panel-loading {
    color: #666;
    font-size: 12px;
    padding: 8px 0 4px;
    text-align: center;
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
