<script lang="ts">
  import { windowStore } from "../lib/stores/windowStore";
  import Window from "./Window.svelte";
  import WindowContent from "./WindowContent.svelte";
  import EdgeGestureDetector from "./EdgeGestureDetector.svelte";

  // Group windows by edge. Each container is a full-viewport flex box that only
  // its panels take hits in, so several windows on one edge stack side by side.
  // The reader's own insets are computed from the same sizes in App.svelte.
  $: leftPanels = $windowStore.filter(w => w.edge === 'left');
  $: rightPanels = $windowStore.filter(w => w.edge === 'right');
  $: topPanels = $windowStore.filter(w => w.edge === 'top');
  $: bottomPanels = $windowStore.filter(w => w.edge === 'bottom');
</script>

<EdgeGestureDetector />

<!-- The four containers stay written out because their classes have to be
     literal — a computed class name would be stripped by Svelte's CSS scoping.
     What goes inside a window lives once, in WindowContent. -->

<!-- Left panels -->
<div class="panel-container panel-container-left">
  {#each leftPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Right panels -->
<div class="panel-container panel-container-right">
  {#each rightPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Top panels -->
<div class="panel-container panel-container-top">
  {#each topPanels as panel (panel.id)}
    <Window window={panel}>
      <WindowContent {panel} />
    </Window>
  {/each}
</div>

<!-- Bottom panels -->
<div class="panel-container panel-container-bottom">
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
