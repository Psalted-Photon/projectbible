<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import bookIntroductions from "../data/book-introductions.json";

  export let open = false;
  export let book = "";

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch("close");
  }

  function handleBackdropClick() {
    close();
  }

  $: introHtml = (bookIntroductions as Record<string, string>)[book] ?? "";
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
      <div class="intro-content">
        {@html introHtml}
      </div>
    {:else}
      <p class="empty-msg">No introduction available for {book}.</p>
    {/if}
  </div>
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
</style>
