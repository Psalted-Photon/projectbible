<script lang="ts">
  /**
   * The tutorial's card: a title, a line or two, and the buttons.
   *
   * It sits beside the spotlit thing -- below it if there is room, above it if
   * not -- and when neither side has room (a book picker filling a phone
   * screen) it docks to whichever screen edge is further from the target.
   * With no target it sits in the middle of the screen.
   *
   * The buttons and the footer are slots: the tour fills them with Skip and
   * Next by default, and a dot's card brings its own.
   *
   * The footer's default is the way out of Tutorial Mode, on every card rather
   * than said once at the start -- it is the thing people most need to find
   * again later, and the hardest to go looking for.
   */
  import { createEventDispatcher } from "svelte";
  import type { Box } from "../engine/targets";
  import { safeInsets } from "../engine/safe-area";
  import ColorLegend from "./ColorLegend.svelte";

  export let title: string;
  export let body: string;
  export let box: Box | null = null;
  export let nextLabel = "Next";
  export let altLabel: string | null = null;
  export let extra: "colors" | undefined = undefined;
  export let skipLabel: string | null = "Skip tour";
  /** A line under the body, set apart: "Needs the … pack". */
  export let note: string | null = null;
  /**
   * False inside the walk to the off switch itself, which is already there:
   * it shows the plain line instead, so the button can't lead back into it.
   */
  export let offerTurnOff = true;

  const dispatch = createEventDispatcher<{ next: void; alt: void; skip: void; turnOff: void }>();

  const GAP = 14;
  const MARGIN = 12;

  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let cardHeight = 0;
  let cardWidth = 0;

  $: position = place(box, cardWidth, cardHeight, vw, vh);

  function place(b: Box | null, w: number, h: number, screenW: number, screenH: number) {
    if (!b || !w || !h) {
      return { centered: true, left: 0, top: 0 };
    }
    // Clear of a notch, the status bar and the home indicator, not just the
    // screen's edge.
    const inset = safeInsets();
    const minTop = MARGIN + inset.top;
    const maxBottom = screenH - MARGIN - inset.bottom;

    const below = maxBottom - (b.top + b.height) - GAP;
    const above = b.top - GAP - minTop;
    let top: number;
    if (below >= h) {
      top = b.top + b.height + GAP;
    } else if (above >= h) {
      top = b.top - GAP - h;
    } else {
      // No room either side: dock to the far end of the screen.
      const targetMiddle = b.top + b.height / 2;
      top = targetMiddle > screenH / 2 ? minTop : maxBottom - h;
    }
    const middle = b.left + b.width / 2;
    const left = Math.min(
      Math.max(middle - w / 2, MARGIN + inset.left),
      screenW - w - MARGIN - inset.right,
    );
    // A card taller than the room it has (a short landscape phone) starts at
    // the top and scrolls inside itself rather than running off the screen.
    return { centered: false, left, top: Math.max(minTop, Math.min(top, maxBottom - h)) };
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="card no-edge-gesture"
  class:centered={position.centered}
  style={position.centered ? "" : `left:${position.left}px; top:${position.top}px;`}
  role="dialog"
  aria-live="polite"
  aria-label={title}
  bind:clientHeight={cardHeight}
  bind:clientWidth={cardWidth}
>
  <h2 class="title">{title}</h2>
  <p class="body">{body}</p>
  {#if note}
    <p class="note">{note}</p>
  {/if}

  <slot />

  {#if extra === "colors"}
    <ColorLegend />
  {/if}

  <div class="buttons">
    <slot name="buttons">
      {#if skipLabel}
        <button class="skip" on:click={() => dispatch("skip")}>{skipLabel}</button>
      {/if}
      <span class="spacer"></span>
      {#if altLabel}
        <button class="tut-btn-ghost small" on:click={() => dispatch("alt")}>{altLabel}</button>
      {/if}
      <button class="tut-btn small" on:click={() => dispatch("next")}>{nextLabel}</button>
    </slot>
  </div>
  <slot name="footer">
    {#if offerTurnOff}
      <button class="off-link" on:click={() => dispatch("turnOff")}>Turn off Tutorial Mode</button>
    {:else}
      <p class="off-hint">Turn off Tutorial Mode in Settings → General</p>
    {/if}
  </slot>
</div>

<style>
  .card {
    position: fixed;
    z-index: calc(var(--tut-z) + 2);
    width: min(340px, calc(100vw - 24px));
    max-height: calc(100vh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1rem 1.05rem 0.85rem;
    background: var(--tut-card);
    border: 1px solid var(--tut-lime);
    border-radius: 14px;
    box-shadow:
      0 0 24px rgba(198, 255, 0, 0.22),
      0 12px 32px rgba(0, 0, 0, 0.55);
    pointer-events: auto;
    transition:
      left 0.22s ease,
      top 0.22s ease;
  }

  .card.centered {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  .title {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--tut-lime);
  }

  .body {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.45;
    color: var(--tut-text);
  }

  .note {
    margin: 0.5rem 0 0;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--tut-lime);
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .card :global(.spacer) {
    flex: 1;
  }

  .skip {
    appearance: none;
    background: none;
    border: none;
    padding: 0.3rem 0;
    color: var(--tut-muted);
    font-family: var(--tut-font);
    font-size: 0.78rem;
    letter-spacing: 0.03em;
    cursor: pointer;
  }

  .skip:hover {
    color: var(--tut-text);
  }

  .off-hint {
    margin: 0.6rem 0 0;
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    color: var(--tut-muted);
    opacity: 0.8;
  }

  .card :global(.tut-btn.small) {
    padding: 0.5rem 1rem;
    font-size: 0.82rem;
    border-radius: 8px;
  }

  .card :global(.tut-btn-ghost.small) {
    padding: 0.45rem 0.8rem;
    font-size: 0.78rem;
    border-radius: 8px;
  }
</style>
