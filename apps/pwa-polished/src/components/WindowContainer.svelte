<script lang="ts">
  import { windowStore } from "../lib/stores/windowStore";
  import Window from "./Window.svelte";
  import WindowContent from "./WindowContent.svelte";
  import EdgeGestureDetector from "./EdgeGestureDetector.svelte";
  import { parallelStore } from "../stores/parallelStore";

  // Group windows by edge. Each container is a full-viewport flex box that only
  // its panels take hits in, so several windows on one edge stack side by side.
  // The reader's own insets are computed from the same sizes in App.svelte.
  $: leftPanels = $windowStore.filter(w => w.edge === 'left');
  $: rightPanels = $windowStore.filter(w => w.edge === 'right');
  $: topPanels = $windowStore.filter(w => w.edge === 'top');
  $: bottomPanels = $windowStore.filter(w => w.edge === 'bottom');

  // Harmonies (ParallelView) covers the screen at z-index 8000, which is above
  // this layer's 100 — so a window opened from inside a harmony reader (Art,
  // for one) rendered underneath it and only appeared once harmonies closed.
  // While the harmony view is up, the window layer rises over it; the modals,
  // which all sit at 10000+, still open on top of both.
  $: overParallel = $parallelStore.active;
</script>

<EdgeGestureDetector />

<!-- The four containers stay written out because their classes have to be
     literal — a computed class name would be stripped by Svelte's CSS scoping.
     What goes inside a window lives once, in WindowContent. -->

<!-- Left panels -->
<div class="panel-container panel-container-left" class:over-parallel={overParallel}>
  {#each leftPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Right panels -->
<div class="panel-container panel-container-right" class:over-parallel={overParallel}>
  {#each rightPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Top panels -->
<div class="panel-container panel-container-top" class:over-parallel={overParallel}>
  {#each topPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Bottom panels -->
<div class="panel-container panel-container-bottom" class:over-parallel={overParallel}>
  {#each bottomPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<style>
  .panel-container {
    position: fixed;
    display: flex;
    z-index: 100;
  }

  /* Above ParallelView's 8000, below the 10000 modal band. */
  .panel-container.over-parallel {
    z-index: 8500;
  }

  .panel-container-left {
    left: 0;
    top: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    flex-direction: row;
    justify-content: flex-start;
    pointer-events: none;
  }

  .panel-container-right {
    right: 0;
    top: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    flex-direction: row;
    justify-content: flex-end;
    pointer-events: none;
  }

  .panel-container-top {
    left: 0;
    right: 0;
    top: 0;
    width: 100vw;
    height: 100vh;
    flex-direction: column;
    justify-content: flex-start;
    pointer-events: none;
  }

  .panel-container-bottom {
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    flex-direction: column;
    justify-content: flex-end;
    pointer-events: none;
  }
</style>
