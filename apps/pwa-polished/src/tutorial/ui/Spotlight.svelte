<script lang="ts">
  /**
   * The dimmed screen with a lime-ringed hole over the thing to tap.
   *
   * The dimming is one element's enormous shadow, so it costs nothing to move.
   * Taps are caught by four clear panels around the hole -- everything outside
   * the hole is swallowed, so nobody wanders off mid-step -- and the hole
   * itself is left open so taps inside it reach the real app. With
   * `passThrough` off, the hole is covered too: look, don't touch.
   *
   * With no box, the whole screen dims and nothing is reachable (a card in the
   * middle of the screen). `faded` hides the dimming without dropping the tap
   * panels' job -- used while a window is being dragged out, so the drag's own
   * preview is visible.
   */
  import type { Box } from "../engine/targets";

  export let box: Box | null = null;
  export let passThrough = true;
  export let faded = false;

  let vw = window.innerWidth;
  let vh = window.innerHeight;
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div class="spotlight" class:faded>
  {#if box}
    <div
      class="hole"
      style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
    ></div>

    <!-- Tap catchers around the hole. -->
    <div class="catch no-edge-gesture" style="left:0; top:0; width:100%; height:{Math.max(0, box.top)}px;"></div>
    <div
      class="catch no-edge-gesture"
      style="left:0; top:{box.top + box.height}px; width:100%; height:{Math.max(0, vh - box.top - box.height)}px;"
    ></div>
    <div
      class="catch no-edge-gesture"
      style="left:0; top:{box.top}px; width:{Math.max(0, box.left)}px; height:{box.height}px;"
    ></div>
    <div
      class="catch no-edge-gesture"
      style="left:{box.left + box.width}px; top:{box.top}px; width:{Math.max(0, vw - box.left - box.width)}px; height:{box.height}px;"
    ></div>
    {#if !passThrough}
      <div
        class="catch no-edge-gesture"
        style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
      ></div>
    {/if}
  {:else}
    <div class="dim"></div>
    <div class="catch no-edge-gesture" style="inset:0;"></div>
  {/if}
</div>

<style>
  .spotlight {
    position: fixed;
    inset: 0;
    z-index: var(--tut-z);
    pointer-events: none;
  }

  .hole {
    position: fixed;
    border-radius: 12px;
    box-shadow:
      0 0 0 2px var(--tut-lime),
      0 0 22px 4px rgba(198, 255, 0, 0.45),
      0 0 0 200vmax rgba(0, 0, 0, 0.62);
    transition:
      left 0.22s ease,
      top 0.22s ease,
      width 0.22s ease,
      height 0.22s ease,
      opacity 0.2s ease;
    animation: breathe 2.2s ease-in-out infinite;
  }

  .dim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.62);
    transition: opacity 0.2s ease;
  }

  .catch {
    position: fixed;
    pointer-events: auto;
  }

  .faded .hole,
  .faded .dim {
    opacity: 0;
  }

  @keyframes breathe {
    0%,
    100% {
      box-shadow:
        0 0 0 2px var(--tut-lime),
        0 0 16px 2px rgba(198, 255, 0, 0.35),
        0 0 0 200vmax rgba(0, 0, 0, 0.62);
    }
    50% {
      box-shadow:
        0 0 0 2px var(--tut-lime),
        0 0 28px 6px rgba(198, 255, 0, 0.55),
        0 0 0 200vmax rgba(0, 0, 0, 0.62);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hole {
      animation: none;
    }
  }
</style>
