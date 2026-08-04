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
  export let busy = false;
  /** The verse text couldn't be fetched — say so instead of failing silently. */
  export let unavailable = false;

  const dispatch = createEventDispatcher();

  const WIDTH = 210;
  // Two action rows, no title.
  const HEIGHT = 84;

  /**
   * Move the popover to the end of <body>.
   *
   * Panels carry `filter: invert(1)` on the light and sepia themes, and a CSS
   * filter turns its element into the anchor for any fixed-position descendant
   * — so rendered in place this would be positioned against the panel and
   * clipped away. At body level nothing can re-anchor, clip or stack over it.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $: left = Math.min(Math.max(x - WIDTH / 2, 8), Math.max(8, window.innerWidth - WIDTH - 8));
  // Prefer above the reference; drop below when there isn't room.
  $: top = y - HEIGHT - 10 < 8 ? y + 26 : y - HEIGHT - 10;
  $: color = getBookColor(book);
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div
  class="ref-popover themed"
  use:portal
  style="left:{left}px; top:{top}px; width:{WIDTH}px; --ref-color:{color};"
>
  <button class="ref-action" on:click={() => dispatch('goto')}>
    Go to {refLabel}
  </button>

  {#if expanded}
    <button class="ref-action" on:click={() => dispatch('collapse')}>Collapse</button>
  {:else if unavailable}
    <span class="ref-note">Verse text unavailable</span>
  {:else}
    <button class="ref-action" disabled={busy} on:click={() => dispatch('expand')}>
      {busy ? 'Loading verse…' : 'Expand here'}
    </button>
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

  .ref-note {
    padding: 9px 8px;
    font-size: 0.78rem;
    font-style: italic;
    color: #8a8a8a;
    white-space: nowrap;
  }
</style>
