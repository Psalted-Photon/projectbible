<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import bookIntroductions from "../data/book-introductions.json";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { parseRefString } from "../lib/parseRefString";
  import { linkifyCommentaryRefs } from "../lib/linkifyCommentaryRefs";
  import { navigationStore } from "../stores/navigationStore";

  export let open = false;
  export let book = "";

  const dispatch = createEventDispatcher<{
    close: void;
    navigateTo: { book: string; chapter: number; verse: number };
  }>();

  const textStore = new IndexedDBTextStore();

  type VerseItem = { book: string; chapter: number; verse: number; text: string; heading?: string | null };
  type PanelMode = "intro" | "verseView";
  let panelMode: PanelMode = "intro";
  let viewVerses: VerseItem[] = [];
  let viewBook = "";
  let viewChapter = 0;
  let viewTargetVerse = 0;
  let viewBodyEl: HTMLDivElement | null = null;

  type PillPreview = { book: string; chapter: number; verse: number; text: string; allVerses: VerseItem[] } | null;
  let pillPreview: PillPreview = null;
  let panelLoading = false;

  // Reset state when panel closes
  $: if (!open) {
    panelMode = "intro";
    pillPreview = null;
    viewVerses = [];
  }

  // Auto-scroll highlighted verse into view after verseView renders
  $: if (panelMode === "verseView" && viewVerses.length > 0) {
    setTimeout(() => {
      const el = viewBodyEl?.querySelector(".view-verse.highlighted") as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  $: introHtml = (bookIntroductions as Record<string, string>)[book] ?? "";
  $: processedHtml = open && book ? linkifyCommentaryRefs(introHtml, book, 1) : introHtml;

  function close() {
    panelMode = "intro";
    pillPreview = null;
    dispatch("close");
  }

  function handleBackdropClick() { close(); }

  async function handleRefClick(ref: string) {
    const target = parseRefString(ref, book, 1);
    if (!target) return;
    panelLoading = true;
    const translation = get(navigationStore).translation;
    const verses = await textStore.getChapter(translation, target.book, target.chapter);
    const targetVerse = verses.find((v: any) => v.verse === target.verse);
    pillPreview = {
      book: target.book,
      chapter: target.chapter,
      verse: target.verse,
      text: targetVerse?.text ?? "",
      allVerses: verses,
    };
    panelLoading = false;
  }

  function handlePillClick() {
    if (!pillPreview) return;
    viewVerses = pillPreview.allVerses;
    viewBook = pillPreview.book;
    viewChapter = pillPreview.chapter;
    viewTargetVerse = pillPreview.verse;
    pillPreview = null;
    panelMode = "verseView";
  }

  function dismissPill() { pillPreview = null; }

  function handlePanelBack() {
    panelMode = "intro";
    pillPreview = null;
    viewVerses = [];
  }

  function handleViewVerseClick(v: VerseItem) {
    dispatch("navigateTo", { book: v.book, chapter: v.chapter, verse: v.verse });
    close();
  }

  function handleCommentaryBodyClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("commentary-ref")) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    const ref = target.dataset.ref;
    if (ref) handleRefClick(ref);
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="intro-backdrop" on:click={handleBackdropClick}></div>
{/if}

<div class="book-intro-panel" class:open>
  <!-- Header -->
  <div class="intro-header">
    {#if panelMode === "verseView"}
      <button class="panel-back-btn" on:click={handlePanelBack}>← Back</button>
    {/if}
    <div class="intro-title">
      {#if panelMode === "verseView"}
        {viewBook} {viewChapter}
      {:else}
        <span class="intro-icon">📖</span>
        Introduction to {book}
      {/if}
    </div>
    <button class="close-btn" on:click={close} aria-label="Close">✕</button>
  </div>

  <!-- Source attribution (intro mode only) -->
  {#if panelMode === "intro"}
    <div class="intro-source">KingComments Commentary</div>
  {/if}

  <!-- Body -->
  <div class="intro-body" bind:this={viewBodyEl}>
    {#if panelLoading}
      <div class="panel-loading">Loading…</div>
    {:else if panelMode === "verseView"}
      <!-- Full chapter reader — identical behaviour to AnnotationPanel -->
      <div class="view-chapter-header">{viewBook} {viewChapter}</div>
      {#each viewVerses as v (v.verse)}
        {#if v.heading}
          <div class="view-heading">{v.heading}</div>
        {/if}
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div
          class="view-verse"
          class:highlighted={v.verse === viewTargetVerse}
          style={v.verse === viewTargetVerse ? "cursor:pointer" : ""}
          on:click={() => { if (v.verse === viewTargetVerse) handleViewVerseClick(v); }}
        >
          <span class="view-verse-num">{v.verse}</span>
          <span class="view-verse-text">{v.text}</span>
        </div>
      {/each}
      {#if viewVerses.length === 0}
        <p class="empty-msg">No text found for {viewBook} {viewChapter}.</p>
      {/if}
    {:else}
      <!-- Intro content -->
      {#if introHtml}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="intro-content"
          on:click={handleCommentaryBodyClick}
          on:keydown={handleCommentaryBodyClick}
        >
          {@html processedHtml}
        </div>
      {:else}
        <p class="empty-msg">No introduction available for {book}.</p>
      {/if}
    {/if}
  </div>

  <!-- Single-verse pill popup — identical to AnnotationPanel -->
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
  .intro-backdrop { position:fixed; inset:0; background:transparent; z-index:299; }

  .book-intro-panel {
    position: fixed; bottom: 0; left: 0; right: 0;
    height: 70vh; min-height: 320px;
    background: #1e1e1e; color: #e0e0e0;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0,0,0,.5);
    z-index: 300; overflow: hidden;
    display: flex; flex-direction: column;
    transform: translateY(100%);
    transition: transform .28s cubic-bezier(.4,0,.2,1);
    will-change: transform;
  }

  .book-intro-panel.open { transform: translateY(0); }

  .intro-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 10px; border-bottom: 1px solid #333;
    flex-shrink: 0; gap: 8px;
  }

  .intro-title {
    font-size: 1.05rem; font-weight: 600; color: #f0f0f0;
    display: flex; align-items: center; gap: 7px;
    flex: 1; min-width: 0;
  }

  .intro-icon { font-size: 1.1rem; }

  .panel-back-btn {
    background: none; border: none; color: #8ab4f8;
    font-size: .9rem; cursor: pointer;
    padding: 4px 8px 4px 0; border-radius: 6px;
    white-space: nowrap; flex-shrink: 0;
  }
  .panel-back-btn:hover { color: #c0d8ff; }

  .intro-source {
    padding: 4px 16px 6px; font-size: .72rem; color: #888;
    letter-spacing: .03em; text-transform: uppercase;
    flex-shrink: 0; border-bottom: 1px solid #2a2a2a;
  }

  .close-btn {
    background: none; border: none; color: #aaa;
    font-size: 1.1rem; cursor: pointer;
    padding: 4px 6px; border-radius: 6px; line-height: 1;
    transition: background .15s, color .15s; flex-shrink: 0;
  }
  .close-btn:hover { background: #333; color: #fff; }

  .intro-body {
    flex: 1; overflow-y: auto; overscroll-behavior: contain;
    padding: 16px 20px 32px; -webkit-overflow-scrolling: touch;
    position: relative;
  }

  .panel-loading { color: #888; font-size: .9rem; text-align: center; margin-top: 3rem; }

  /* verseView */
  .view-chapter-header {
    font-size: .8rem; font-weight: 700; color: #666;
    text-transform: uppercase; letter-spacing: .08em; padding: 0 0 12px;
  }
  .view-heading { font-size: .82rem; font-weight: 600; color: #9ab; margin: 1.2em 0 .4em; font-style: italic; }
  .view-verse { display: flex; gap: 10px; padding: 5px 0; border-radius: 6px; transition: background .12s; }
  .view-verse.highlighted { background: rgba(138,180,248,.12); padding: 8px 10px; margin: 0 -10px; border-left: 3px solid #8ab4f8; }
  .view-verse-num { font-size: .72rem; color: #666; font-weight: 600; min-width: 22px; padding-top: 3px; flex-shrink: 0; }
  .view-verse-text { font-size: .95rem; line-height: 1.7; color: #d8d8d8; }
  .view-verse.highlighted .view-verse-text { color: #f0f0f0; }

  /* Intro typography */
  .intro-content :global(h3) {
    font-size: .85rem; font-weight: 700; color: #b0b8c8;
    text-transform: uppercase; letter-spacing: .07em;
    margin: 1.4em 0 .5em; padding-bottom: 4px;
    border-bottom: 1px solid #2c2c2c;
  }
  .intro-content :global(h3:first-child) { margin-top: 0; }
  .intro-content :global(p) { font-size: .96rem; line-height: 1.75; color: #d0d0d0; margin: 0 0 .9em; }
  .intro-content :global(b), .intro-content :global(strong) { color: #f0f0f0; }
  .intro-content :global(i), .intro-content :global(em) { color: #c8c8d8; }
  .intro-content :global(ul), .intro-content :global(ol) { margin: .5em 0 .9em 1.4em; padding: 0; }
  .intro-content :global(li) { font-size: .96rem; line-height: 1.7; color: #d0d0d0; margin-bottom: .3em; }

  .empty-msg { color: #888; font-size: .95rem; text-align: center; margin-top: 3rem; }

  /* Pill */
  .pill-overlay {
    position: absolute; inset: 0;
    background: rgba(0,0,0,.45); backdrop-filter: blur(1px);
    z-index: 10; display: flex; align-items: flex-end;
    padding: 12px 16px; border-radius: 16px 16px 0 0;
  }
  .pill-card { background: #2a2a2a; border-radius: 10px; padding: 12px 14px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,.55); }
  .pill-ref-label { font-size: 11px; color: #888; font-weight: 600; letter-spacing: .3px; margin-bottom: 6px; }
  .pill-verse-text { font-size: 15px; color: #e8e8e8; line-height: 1.65; cursor: pointer; user-select: none; }
  .pill-verse-text:hover { color: #fff; }
  .hint { color: #666; font-style: italic; }
  .pill-hint { font-size: 10px; color: #555; margin-top: 8px; }

  /* Ref links */
  :global(.commentary-ref) {
    color: var(--ref-color, #8ab4f8); text-decoration: underline;
    text-decoration-style: dotted; text-underline-offset: 2px;
    cursor: pointer; border-radius: 2px; padding: 0 1px;
  }
  :global(.commentary-ref:hover) {
    color: color-mix(in srgb, var(--ref-color, #8ab4f8) 70%, white); text-decoration-style: solid;
    background: color-mix(in srgb, var(--ref-color, #8ab4f8) 12%, transparent);
  }
</style>
