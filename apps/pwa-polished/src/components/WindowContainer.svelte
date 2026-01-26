<script lang="ts">
  import { windowStore } from "../lib/stores/windowStore";
  import Window from "./Window.svelte";
  import WindowContentSelector from "./WindowContentSelector.svelte";
  import BibleReader from "./BibleReader.svelte";
  import EdgeGestureDetector from "./EdgeGestureDetector.svelte";
  import MapPane from "./MapPane.svelte";
  import CommentaryReader from "./CommentaryReader.svelte";

  // Group windows by edge
  $: leftPanels = $windowStore.filter(w => w.edge === 'left');
  $: rightPanels = $windowStore.filter(w => w.edge === 'right');
  $: topPanels = $windowStore.filter(w => w.edge === 'top');
  $: bottomPanels = $windowStore.filter(w => w.edge === 'bottom');

  // Calculate main content area dimensions
  $: leftWidth = leftPanels.reduce((sum, p) => sum + p.size, 0);
  $: rightWidth = rightPanels.reduce((sum, p) => sum + p.size, 0);
  $: topHeight = topPanels.reduce((sum, p) => sum + p.size, 0);
  $: bottomHeight = bottomPanels.reduce((sum, p) => sum + p.size, 0);

  $: mainContentStyle = `
    margin-left: ${leftWidth}%;
    margin-right: ${rightWidth}%;
    margin-top: ${topHeight}%;
    margin-bottom: ${bottomHeight}%;
    width: ${100 - leftWidth - rightWidth}%;
    height: ${100 - topHeight - bottomHeight}%;
  `;
</script>

<EdgeGestureDetector />

<!-- Left panels -->
<div class="panel-container panel-container-left">
  {#each leftPanels as panel (panel.id)}
    <Window window={panel}>
      {#if panel.contentType === 'selector'}
        <WindowContentSelector windowId={panel.id} />
      {:else if panel.contentType === 'bible'}
        <BibleReader windowId={panel.id} />
      {:else if panel.contentType === 'map'}
        <MapPane windowId={panel.id} />      {:else if panel.contentType === 'commentaries'}
        <CommentaryReader windowId={panel.id} />      {:else if panel.contentType === 'notes'}
        <div class="placeholder">
          <h2>Notes</h2>
          <p>Coming soon...</p>
        </div>
      {:else if panel.contentType === 'wordstudy'}
        <div class="placeholder">
          <h2>Word Study</h2>
          <p>Coming soon...</p>
        </div>
      {/if}
    </Window>
  {/each}
</div>

<!-- Right panels -->
<div class="panel-container panel-container-right">
  {#each rightPanels as panel (panel.id)}
    <Window window={panel}>
      {#if panel.contentType === 'selector'}
        <WindowContentSelector windowId={panel.id} />
      {:else if panel.contentType === 'bible'}
        <BibleReader windowId={panel.id} />
      {:else if panel.contentType === 'map'}
        <MapPane windowId={panel.id} />      {:else if panel.contentType === 'commentaries'}
        <CommentaryReader windowId={panel.id} />      {:else if panel.contentType === 'notes'}
        <div class="placeholder">
          <h2>Notes</h2>
          <p>Coming soon...</p>
        </div>
      {:else if panel.contentType === 'wordstudy'}
        <div class="placeholder">
          <h2>Word Study</h2>
          <p>Coming soon...</p>
        </div>
      {/if}
    </Window>
  {/each}
</div>

<!-- Top panels -->
<div class="panel-container panel-container-top">
  {#each topPanels as panel (panel.id)}
    <Window window={panel}>
      {#if panel.contentType === 'selector'}
        <WindowContentSelector windowId={panel.id} />
      {:else if panel.contentType === 'bible'}
        <BibleReader windowId={panel.id} />
      {:else if panel.contentType === 'map'}
        <MapPane windowId={panel.id} />
      {:else if panel.contentType === 'commentaries'}
        <CommentaryReader windowId={panel.id} />
      {:else if panel.contentType === 'notes'}
        <div class="placeholder">
          <h2>Notes</h2>
          <p>Coming soon...</p>
        </div>
      {:else if panel.contentType === 'wordstudy'}
        <div class="placeholder">
          <h2>Word Study</h2>
          <p>Coming soon...</p>
        </div>
      {/if}
    </Window>
  {/each}
</div>

<!-- Bottom panels -->
<div class="panel-container panel-container-bottom">
  {#each bottomPanels as panel (panel.id)}
    <Window window={panel}>
      {#if panel.contentType === 'selector'}
        <WindowContentSelector windowId={panel.id} />
      {:else if panel.contentType === 'bible'}
        <BibleReader windowId={panel.id} />
      {:else if panel.contentType === 'map'}
        <MapPane windowId={panel.id} />
      {:else if panel.contentType === 'commentaries'}
        <CommentaryReader windowId={panel.id} />
      {:else if panel.contentType === 'notes'}
        <div class="placeholder">
          <h2>Notes</h2>
          <p>Coming soon...</p>
        </div>
      {:else if panel.contentType === 'wordstudy'}
        <div class="placeholder">
          <h2>Word Study</h2>
          <p>Coming soon...</p>
        </div>
      {/if}
    </Window>
  {/each}
</div>

<!-- Export main content style for parent -->
<div class="layout-info" data-main-style={mainContentStyle} style="display: none;"></div>

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

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    padding: 40px;
    text-align: center;
  }

  .placeholder h2 {
    font-size: 32px;
    margin-bottom: 16px;
    color: #e0e0e0;
  }

  .placeholder p {
    font-size: 18px;
  }

  .layout-info {
    display: none;
  }
</style>
