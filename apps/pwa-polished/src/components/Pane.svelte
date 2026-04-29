<script lang="ts">
  import { fly } from "svelte/transition";
  import { get } from "svelte/store";
  import { paneStore, pendingCloseEdge, type PaneState } from "../stores/paneStore";
  import SettingsPane from "./panes/SettingsPane.svelte";
  import MapPane from "./panes/MapPane.svelte";
  import PacksPane from "./panes/PacksPane.svelte";
  import SearchPane from "./panes/SearchPane.svelte";


  export let pane: PaneState;

  let isDraggingResize = false;
  let resizeStartPos = 0;
  let resizeStartSize = 0;

  function handleClose() {
    paneStore.closePane(pane.id);
  }

  function handleBackdropClick() {
    handleClose();
  }

  function startResize(e: MouseEvent | TouchEvent) {
    isDraggingResize = true;

    const pos = "touches" in e ? e.touches[0] : e;
    resizeStartPos = pane.position === "bottom" ? pos.clientY : pos.clientX;
    resizeStartSize =
      pane.position === "bottom" ? pane.height || 50 : pane.width || 40;

    e.preventDefault();
  }

  const CLOSE_THRESHOLD_PX = 40;

  function handleResizeMove(e: MouseEvent | TouchEvent) {
    if (!isDraggingResize) return;

    const pos = "touches" in e ? e.touches[0] : e;
    const currentPos = pane.position === "bottom" ? pos.clientY : pos.clientX;
    const delta = resizeStartPos - currentPos;

    const screenSize =
      pane.position === "bottom" ? window.innerHeight : window.innerWidth;
    const deltaPercent = (delta / screenSize) * 100;

    let newSize =
      resizeStartSize +
      (pane.position === "right" ? -deltaPercent : deltaPercent);

    paneStore.resizePane(pane.id, newSize);

    // Check if dragging toward the originating edge to dismiss
    let nearEdge = false;
    if (pane.position === "left" && pos.clientX < CLOSE_THRESHOLD_PX) nearEdge = true;
    if (pane.position === "right" && pos.clientX > window.innerWidth - CLOSE_THRESHOLD_PX) nearEdge = true;
    if (pane.position === "bottom" && pos.clientY > window.innerHeight - CLOSE_THRESHOLD_PX) nearEdge = true;
    pendingCloseEdge.set(nearEdge ? pane.position : null);
  }

  function handleResizeEnd() {
    if (get(pendingCloseEdge) !== null) {
      handleClose();
    }
    pendingCloseEdge.set(null);
    isDraggingResize = false;
  }

  $: transitionConfig = {
    x: pane.position === "left" ? -100 : pane.position === "right" ? 100 : 0,
    y: pane.position === "bottom" ? 100 : 0,
    duration: 300,
    opacity: 1,
  };

  $: paneStyle = `
    ${pane.position === "left" ? `left: 0; width: ${pane.width}%;` : ""}
    ${pane.position === "right" ? `right: 0; width: ${pane.width}%;` : ""}
    ${pane.position === "bottom" ? `bottom: 0; height: ${pane.height}%;` : ""}
    z-index: ${pane.zIndex + 100};
  `;
</script>

<svelte:window
  on:mousemove={handleResizeMove}
  on:mouseup={handleResizeEnd}
  on:touchmove={handleResizeMove}
  on:touchend={handleResizeEnd}
/>

<!-- Backdrop -->
<div
  class="backdrop"
  role="none"
  style="z-index: {pane.zIndex + 99};"
  on:click={handleBackdropClick}
  on:keydown={(e) => e.key === 'Escape' && handleBackdropClick()}
  transition:fly={{ opacity: 0, duration: 300 }}
></div>

<!-- Pane -->
<div
  class="pane {pane.position} pane-{pane.type}"
  class:themed={pane.type !== "map"}
  style={paneStyle}
  transition:fly={transitionConfig}
>
  <!-- Resize handle -->
  <div
    class="resize-handle {pane.position}"
    role="slider"
    tabindex="0"
    aria-label="Resize pane"
    aria-valuenow={pane.position === 'bottom' ? pane.height : pane.width}
    aria-valuemin={20}
    aria-valuemax={80}
    aria-orientation={pane.position === 'bottom' ? 'horizontal' : 'vertical'}
    on:mousedown={startResize}
    on:touchstart={startResize}
  ></div>

  <!-- Close button -->
  <button class="close-btn" on:click={handleClose}>×</button>

  <!-- Pane content -->
  <div class="pane-content">
    {#if pane.type === "settings"}
      <SettingsPane />
    {:else if pane.type === "map"}
      <MapPane />
    {:else if pane.type === "packs"}
      <PacksPane />
    {:else if pane.type === "search"}
      <SearchPane />
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
  }

  .pane {
    position: fixed;
    background: #2a2a2a;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }

  .pane.left,
  .pane.right {
    top: 0;
    bottom: 0;
  }

  .pane.bottom {
    left: 0;
    right: 0;
  }

  .resize-handle {
    position: absolute;
    background: transparent;
    z-index: 10;
  }

  .resize-handle.left {
    right: -8px;
    top: 0;
    bottom: 0;
    width: 32px;
    cursor: ew-resize;
  }

  .resize-handle.right {
    left: -8px;
    top: 0;
    bottom: 0;
    width: 32px;
    cursor: ew-resize;
  }

  .resize-handle.bottom {
    top: -8px;
    left: 0;
    right: 0;
    height: 32px;
    cursor: ns-resize;
  }

  .resize-handle:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .close-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 24px;
    border-radius: 50%;
    cursor: pointer;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .pane-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 60px 20px 20px;
  }
</style>
