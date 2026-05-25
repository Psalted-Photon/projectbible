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

  type PillPreview = { book: string; chapter: number; verse: number; text: string } | null;
  let pillPreview: PillPreview = null;
  let panelLoading = false;

  function close() {
    pillPreview = null;
    dispatch("close");
  }

  function handleBackdropClick() {
    close();
  }

  $: introHtml = (bookIntroductions as Record<string, string>)[book] ?? "";
  $: processedHtml = open && book ? linkifyCommentaryRefs(introHtml, book, 1) : introHtml;
  $: if (!open) pillPreview = null;

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
    };
    panelLoading = false;
  }

  function handleCommentaryBodyClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("commentary-ref")) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    const ref = target.dataset.ref;
    if (ref) handleRefClick(ref);
  }

  function dismissPill() {
    pillPreview = null;
  }

  function goToVerse() {
    if (!pillPreview) return;
    dispatch("navigateTo", {
      book: pillPreview.book,
      chapter: pillPreview.chapter,
      verse: pillPreview.verse,
    });
    close();
  }
</script>

<!-- Backdrop -->
{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="intro-backdrop" on:click={handleBackdropClick}></div>
{/if}

<div class="book-intro-panel" class:open>
  <!-- Header -->
  <div class="intro-header">
    <div class="intro-title">
      <span class="intro-icon">📖</span>
      Introduction to {book}
    </div>
    <button class="close-btn" on:click={close} aria-label="Close">✕</button>
  </div>

  <!-- Source attribution -->
  <div class="intro-source">KingComments Commentary</div>

  <!-- Body -->
  <div class="intro-body">
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
  </div>

  <!-- Loading spinner -->
  {#if panelLoading}
    <div class="intro-loading">Loading…</div>
  {/if}

  <!-- Verse pill popup -->
  {#if pillPreview !== null}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="pill-overlay" on:click={dismissPill}>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="pill-card" on:click|stopPropagation>
        <div class="pill-ref-label">{pillPreview.book} {pillPreview.chapter}:{pillPreview.verse}</div>
        <div class="pill-verse-text">
          {#if pillPreview.text}
            {pillPreview.text}
          {:else}
            <span class="hint">Verse text not available.</span>
          {/if}
        </div>
        <div class="pill-actions">
          <button class="pill-go-btn" on:click={goToVerse}>Go to verse →</button>
          <button class="pill-dismiss-btn" on:click={dismissPill}>✕</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .intro-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 299;
  }

  .book-intro-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 70vh;
    min-height: 320px;
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

  .book-intro-panel.open {
    transform: translateY(0);
  }

  /* Header */
  .intro-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .intro-title {
    font-size: 1.05rem;
    font-weight: 600;
    color: #f0f0f0;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .intro-icon {
    font-size: 1.1rem;
  }

  .intro-source {
    padding: 4px 16px 6px;
    font-size: 0.72rem;
    color: #888;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    flex-shrink: 0;
    border-bottom: 1px solid #2a2a2a;
  }

  .close-btn {
    background: none;
    border: none;
    color: #aaa;
    font-size: 1.1rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: #333;
    color: #fff;
  }

  /* Body */
  .intro-body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 20px 32px;
    -webkit-overflow-scrolling: touch;
  }

  /* Content typography */
  .intro-content :global(h3) {
    font-size: 0.85rem;
    font-weight: 700;
    color: #b0b8c8;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 1.4em 0 0.5em;
    padding-bottom: 4px;
    border-bottom: 1px solid #2c2c2c;
  }

  .intro-content :global(h3:first-child) {
    margin-top: 0;
  }

  .intro-content :global(p) {
    font-size: 0.96rem;
    line-height: 1.75;
    color: #d0d0d0;
    margin: 0 0 0.9em;
  }

  .intro-content :global(b),
  .intro-content :global(strong) {
    color: #f0f0f0;
  }

  .intro-content :global(i),
  .intro-content :global(em) {
    color: #c8c8d8;
  }

  .intro-content :global(ul),
  .intro-content :global(ol) {
    margin: 0.5em 0 0.9em 1.4em;
    padding: 0;
  }

  .intro-content :global(li) {
    font-size: 0.96rem;
    line-height: 1.7;
    color: #d0d0d0;
    margin-bottom: 0.3em;
  }

  .empty-msg {
    color: #888;
    font-size: 0.95rem;
    text-align: center;
    margin-top: 3rem;
  }

  /* Loading indicator */
  .intro-loading {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #aaa;
    font-size: 0.8rem;
    padding: 6px 14px;
    border-radius: 20px;
    pointer-events: none;
  }

  /* Verse pill popup */
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
  }

  .hint {
    color: #666;
    font-style: italic;
  }

  .pill-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
  }

  .pill-go-btn {
    background: #3a5a9a;
    color: #e8eeff;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .pill-go-btn:hover {
    background: #4a6ab0;
  }

  .pill-dismiss-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s;
  }

  .pill-dismiss-btn:hover {
    color: #aaa;
  }

  /* Inline verse ref links (injected by linkifyCommentaryRefs) */
  :global(.commentary-ref) {
    color: #8ab4f8;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;
    border-radius: 2px;
    padding: 0 1px;
  }

  :global(.commentary-ref:hover) {
    color: #c0d8ff;
    text-decoration-style: solid;
    background: rgba(138, 180, 248, 0.1);
  }
</style>
