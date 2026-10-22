<script lang="ts">
  /**
   * The window types, dropped down from whichever button opened it: the apps
   * button on the bar (open a new window) or the swap button in a window's
   * header (show something else in this one). A small grid, four groups of
   * tiles under their headings, the same groups and badges as the tiles in a
   * brand-new window.
   *
   * Portalled to <body>. The window header that opens it carries a
   * backdrop-filter, and on light themes the panel carries a filter, and
   * either one would trap a fixed-position child inside the panel and clip it.
   *
   * The host decides what a pick means; this only says which one.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import PanelIcon from './icons/PanelIcon.svelte';
  import { WINDOW_TYPES_BY_GROUP, type WindowChoice } from '../lib/windowTypes';
  import { fadeAway, growFrom } from '../lib/motion';

  /** The button it hangs from. */
  export let anchor: HTMLElement;
  export let heading = 'Open a window';
  /** The type the window already shows, marked and not offered again. */
  export let current: string | null = null;

  const dispatch = createEventDispatcher<{ pick: WindowChoice; close: void }>();

  let menuEl: HTMLElement;
  let top = 0;
  let left = 0;
  let maxHeight = 0;
  let placed = false;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  /**
   * Under the button when there's room, above it when there isn't (a window
   * docked at the bottom has its header halfway down the screen), and kept
   * on screen sideways. Lined up with the button's left edge, or its right
   * edge when that's the side with room.
   */
  async function place() {
    await tick();
    if (!menuEl || !anchor) return;
    const gap = 6;
    const margin = 8;
    const a = anchor.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const below = vh - a.bottom - gap - margin;
    const above = a.top - gap - margin;
    const natural = menuEl.scrollHeight;
    const goUp = natural > below && above > below;
    maxHeight = Math.max(160, goUp ? above : below);
    const h = Math.min(natural, maxHeight);
    top = goUp ? a.top - gap - h : a.bottom + gap;

    const fromLeft = a.left;
    const fromRight = a.right - w;
    left = fromLeft + w <= vw - margin ? fromLeft : fromRight;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    const first = !placed;
    placed = true;
    // Placed again on every resize; only the first showing grows.
    if (first) {
      await tick();
      growFrom(menuEl, a);
    }
  }

  function choose(type: WindowChoice) {
    if (type === current) return;
    dispatch('pick', type);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dispatch('close');
    }
  }

  onMount(() => {
    void place();
    const onResize = () => void place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<svelte:window on:keydown={onKey} />

<div class="wtm-layer no-edge-gesture" use:portal out:fadeAway>
  <button
    type="button"
    class="wtm-backdrop"
    aria-label="Close"
    tabindex="-1"
    on:click={() => dispatch('close')}
  ></button>
  <div
    class="wtm-menu"
    class:placed
    bind:this={menuEl}
    style="top: {top}px; left: {left}px; {maxHeight ? `max-height: ${maxHeight}px;` : ''}"
    role="menu"
    aria-label={heading}
  >
    <div class="wtm-heading">{heading}</div>
    {#each WINDOW_TYPES_BY_GROUP as g (g.key)}
      <div class="wtm-group" role="group" aria-label={g.label}>
        <div class="wtm-group-label" aria-hidden="true">{g.label}</div>
        <div class="wtm-grid">
          {#each g.types as t (t.type)}
            <button
              type="button"
              class="wtm-tile"
              class:current={t.type === current}
              style="--accent: {t.accent}"
              role="menuitem"
              aria-current={t.type === current ? 'true' : undefined}
              on:click={() => choose(t.type)}
            >
              <span class="wtm-badge"><PanelIcon name={t.icon} size={18} /></span>
              <span class="wtm-label">{t.label}</span>
              {#if t.type === current}<span class="wtm-here">Showing</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .wtm-layer {
    position: fixed;
    inset: 0;
    z-index: 10060;
  }

  .wtm-backdrop {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  /* The bar's dropdown look: the same gray card, border and shadow. Sized in
     bar-scale steps like the rest of the chrome, so a bigger bar gets a bigger
     grid; the four columns share whatever width that comes to. */
  .wtm-menu {
    --s: var(--bar-scale, 1);
    position: fixed;
    width: calc(300px * var(--s));
    max-width: calc(100vw - 16px);
    box-sizing: border-box;
    overflow-y: auto;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: calc(4px * var(--s)) calc(6px * var(--s)) calc(6px * var(--s));
    visibility: hidden;
  }

  .wtm-menu.placed {
    visibility: visible;
  }

  /* What a pick does here, in plain case so it doesn't read as a fifth group. */
  .wtm-heading {
    padding: calc(6px * var(--s)) calc(6px * var(--s)) calc(2px * var(--s));
    font-size: calc(0.8rem * var(--s));
    font-weight: 600;
    color: #cfcfcf;
  }

  .wtm-group-label {
    padding: calc(8px * var(--s)) calc(6px * var(--s)) calc(3px * var(--s));
    font-size: calc(0.62rem * var(--s));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #8f8f8f;
  }

  .wtm-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: calc(2px * var(--s));
  }

  .wtm-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(4px * var(--s));
    min-width: 0;
    padding: calc(6px * var(--s)) calc(2px * var(--s));
    background: transparent;
    border: none;
    border-radius: 7px;
    color: #e0e0e0;
    font-family: inherit;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .wtm-tile:hover:not(.current) {
    background: #3a3a3a;
  }

  .wtm-tile.current {
    cursor: default;
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }

  /* The tile picker's badge at menu scale: the second color stop is the state,
     20% resting and 35% on hover or when it's the one showing. */
  .wtm-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(28px * var(--s));
    height: calc(28px * var(--s));
    border-radius: calc(7px * var(--s));
    line-height: 0;
    flex-shrink: 0;
    background: radial-gradient(circle, var(--accent) 0%, var(--accent) 20%, #222 100%);
    transition: background 0.15s;
  }

  .wtm-badge :global(svg) {
    width: calc(18px * var(--s));
    height: calc(18px * var(--s));
  }

  .wtm-tile:hover .wtm-badge,
  .wtm-tile.current .wtm-badge {
    background: radial-gradient(circle, var(--accent) 0%, var(--accent) 35%, #222 100%);
  }

  /* One line, trimmed rather than wrapped, should a narrow screen squeeze the
     columns past "Encyclopedia". */
  .wtm-label {
    max-width: 100%;
    font-size: calc(10.5px * var(--s));
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wtm-here {
    margin-top: calc(-2px * var(--s));
    font-size: calc(9px * var(--s));
    line-height: 1.1;
    color: #8f8f8f;
  }
</style>
