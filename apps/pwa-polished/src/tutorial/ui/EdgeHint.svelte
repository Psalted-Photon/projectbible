<script lang="ts">
  /**
   * "Grab here and drag": a lime finger sliding in from a screen edge, over an
   * invisible strip a real drag can start from.
   *
   * The strip is what makes the gesture work mid-tour. The app ignores a drag
   * that starts on verse text -- that is a word selection -- and on a phone the
   * text runs right up to the edges, so a drag through a plain hole in the
   * spotlight would often land on a word and do nothing. Starting on this strip
   * instead gives the app's edge detector a clean start. It carries
   * `.tut-lane` so the tutorial's own tap shield lets it through, and no
   * `.no-edge-gesture`, which would switch the gesture off.
   *
   * The strip stays mounted for the whole drag: pulling the element a touch
   * started on out from under it ends that touch's move events on some phones.
   */
  import type { EdgeLane } from "../content/types";

  export let lane: EdgeLane;
  export let dragging = false;

  $: box = lane.box;
  $: horizontal = lane.edge === "left" || lane.edge === "right";
</script>

<div
  class="tut-lane"
  style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
  aria-hidden="true"
></div>

{#if !dragging}
  <div
    class="finger edge-{lane.edge}"
    class:horizontal
    style="left:{box.left + box.width / 2}px; top:{box.top + box.height / 2}px;"
    aria-hidden="true"
  >
    <span class="dot"></span>
    <span class="chevrons">
      {#if lane.edge === "right"}‹‹‹{:else if lane.edge === "left"}›››{:else if lane.edge === "bottom"}︿{:else}﹀{/if}
    </span>
  </div>
{/if}

<style>
  .tut-lane {
    position: fixed;
    z-index: calc(var(--tut-z) + 1);
    pointer-events: auto;
    touch-action: none;
  }

  .finger {
    position: fixed;
    z-index: calc(var(--tut-z) + 1);
    pointer-events: none;
    width: 0;
    height: 0;
  }

  .dot {
    position: absolute;
    left: -14px;
    top: -14px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--tut-lime);
    box-shadow: 0 0 18px 4px rgba(198, 255, 0, 0.6);
  }

  .chevrons {
    position: absolute;
    color: var(--tut-lime);
    font-family: var(--tut-font);
    font-size: 1.4rem;
    font-weight: 600;
    text-shadow: 0 0 10px rgba(198, 255, 0, 0.7);
    white-space: nowrap;
  }

  .edge-right .chevrons {
    right: 22px;
    top: -0.8em;
  }
  .edge-left .chevrons {
    left: 22px;
    top: -0.8em;
  }
  .edge-bottom .chevrons {
    left: -0.5em;
    bottom: 20px;
  }
  .edge-top .chevrons {
    left: -0.5em;
    top: 20px;
  }

  /* The dot slides inward from the edge, again and again. */
  .edge-right .dot {
    animation: slide-left 1.6s ease-in-out infinite;
  }
  .edge-left .dot {
    animation: slide-right 1.6s ease-in-out infinite;
  }
  .edge-bottom .dot {
    animation: slide-up 1.6s ease-in-out infinite;
  }
  .edge-top .dot {
    animation: slide-down 1.6s ease-in-out infinite;
  }

  @keyframes slide-left {
    0% { transform: translateX(0); opacity: 0; }
    15% { opacity: 1; }
    70% { transform: translateX(-90px); opacity: 1; }
    100% { transform: translateX(-110px); opacity: 0; }
  }
  @keyframes slide-right {
    0% { transform: translateX(0); opacity: 0; }
    15% { opacity: 1; }
    70% { transform: translateX(90px); opacity: 1; }
    100% { transform: translateX(110px); opacity: 0; }
  }
  @keyframes slide-up {
    0% { transform: translateY(0); opacity: 0; }
    15% { opacity: 1; }
    70% { transform: translateY(-90px); opacity: 1; }
    100% { transform: translateY(-110px); opacity: 0; }
  }
  @keyframes slide-down {
    0% { transform: translateY(0); opacity: 0; }
    15% { opacity: 1; }
    70% { transform: translateY(90px); opacity: 1; }
    100% { transform: translateY(110px); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none !important;
    }
  }
</style>
