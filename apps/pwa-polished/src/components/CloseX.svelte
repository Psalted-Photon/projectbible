<script lang="ts">
  /**
   * The one close button. Phosphor's X in dark red over a black copy drawn a
   * little larger and thicker, so it reads as a red X with a black outline.
   * Enlarging the black copy alone would only show black at the four tips;
   * the stroke is what puts it along the sides too.
   *
   * No border, no background. The tap area is 40px square and follows Bar
   * size; `tall` makes it 40px wide and the full height of a header instead.
   * Position it from the parent with a class and :global().
   *
   * Not for the small x inside search boxes (that clears text) or for worded
   * buttons like Done and Got it.
   */
  import { X } from 'phosphor-svelte';

  export let label = 'Close';
  /** Fill the parent's height instead of a 40px square (window headers). */
  export let tall = false;
  /** At the right end of a header row: pushed right, and hanging into the
   *  row's padding so the 40px tap area doesn't make the row taller. */
  export let edge = false;
  /** The button itself, for parents that move focus to it. */
  export let el: HTMLButtonElement | undefined = undefined;
  /** For positioning from the parent, via :global(). */
  let className = '';
  export { className as class };
</script>

<button
  bind:this={el}
  type="button"
  class="close-x {className}"
  class:tall
  class:edge
  aria-label={label}
  title={label}
  {...$$restProps}
  on:click
>
  <span class="cx-icon" aria-hidden="true">
    <X class="cx-outline" weight="bold" />
    <X class="cx-red" weight="bold" />
  </span>
</button>

<style>
  .close-x {
    /* Tune here. Sepia gets its own red below: its filter can't be undone
       exactly, so it starts from a brighter red that lands near this one. */
    --cx-red: #b3141e;
    --cx-red-hover: #d41c27;
    --cx-black: #000;

    flex-shrink: 0;
    width: calc(40px * var(--bar-scale, 1));
    height: calc(40px * var(--bar-scale, 1));
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    background: none;
    box-shadow: none;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .close-x.tall {
    height: auto;
    align-self: stretch;
  }

  .close-x.edge {
    margin: calc(-10px * var(--bar-scale, 1)) calc(-10px * var(--bar-scale, 1))
      calc(-10px * var(--bar-scale, 1)) auto;
  }

  .close-x:hover {
    --cx-red: var(--cx-red-hover);
  }

  .close-x:focus-visible {
    outline: 2px solid var(--cx-red);
    outline-offset: -4px;
  }

  .cx-icon {
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .cx-icon > :global(svg) {
    grid-area: 1 / 1;
    overflow: visible;
  }

  .cx-icon > :global(.cx-outline) {
    width: calc(22px * var(--bar-scale, 1));
    height: calc(22px * var(--bar-scale, 1));
    fill: var(--cx-black);
  }

  /* On the path only: Phosphor's invisible 256px frame rect would take a
     stroke too and draw a box. */
  .cx-icon > :global(.cx-outline path) {
    stroke: var(--cx-black);
    stroke-width: 30;
    stroke-linejoin: round;
  }

  .cx-icon > :global(.cx-red) {
    width: calc(20px * var(--bar-scale, 1));
    height: calc(20px * var(--bar-scale, 1));
    fill: var(--cx-red);
  }

  /* Light and sepia invert every .themed panel. Re-applying the same filter
     here cancels it, the way .red-letter does, so the X looks the same on
     every theme. */
  :global(body.light-theme .themed) .close-x,
  :global(body.sepia-theme .themed) .close-x {
    filter: invert(1) hue-rotate(180deg);
  }

  /* Sepia's sepia(0.5) saturate(0.85) still lands on top and browns the red,
     so it starts from pure red, which comes out a deep brick red. */
  :global(body.sepia-theme .themed) .close-x {
    --cx-red: #ff0000;
    --cx-red-hover: #ff0000;
  }
</style>
