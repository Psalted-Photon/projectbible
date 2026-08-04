<script lang="ts">
  /**
   * The little menu that opens when you click a Bible reference in a note.
   *
   * Fixed-position like SelectionToast, and clamped to the viewport the same
   * way, so it stays on screen even when the reference sits at the edge of a
   * narrow docked panel.
   */
  import { createEventDispatcher } from 'svelte';
  import { getBookColor } from '../lib/bibleData';

  export let x = 0;
  export let y = 0;
  export let refLabel = '';
  export let book = '';
  export let expanded = false;
  /** A chapter-only reference has no single verse to print, so it can only navigate. */
  export let chapterOnly = false;
  export let busy = false;

  const dispatch = createEventDispatcher();

  const WIDTH = 210;
  const HEIGHT = 96;

  $: left = Math.min(Math.max(x - WIDTH / 2, 8), Math.max(8, window.innerWidth - WIDTH - 8));
  // Prefer above the reference; drop below when there isn't room.
  $: top = y - HEIGHT - 10 < 8 ? y + 26 : y - HEIGHT - 10;
  $: color = getBookColor(book);
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div class="ref-popover" style="left:{left}px; top:{top}px; width:{WIDTH}px; --ref-color:{color};">
  <div class="ref-head">{refLabel}</div>

  <button class="ref-action" on:click={() => dispatch('goto')}>
    Go to {refLabel}
  </button>

  {#if !chapterOnly}
    {#if expanded}
      <button class="ref-action" on:click={() => dispatch('collapse')}>Collapse verse</button>
    {:else}
      <button class="ref-action" disabled={busy} on:click={() => dispatch('expand')}>
        {busy ? 'Loading verse…' : 'Expand verse here'}
      </button>
    {/if}
  {/if}
</div>

<style>
  .ref-popover {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid var(--ref-color, #c0392b);
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .ref-head {
    padding: 2px 8px 5px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ref-color, #c0392b);
    border-bottom: 1px solid #3a3a3a;
    margin-bottom: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ref-action {
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #ddd;
    cursor: pointer;
    font-size: 0.82rem;
    padding: 9px 8px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ref-action:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: #fff;
  }

  .ref-action:disabled {
    color: #888;
    cursor: default;
  }
</style>
