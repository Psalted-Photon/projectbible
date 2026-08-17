<script lang="ts">
  import { fly } from "svelte/transition";
  import { get } from "svelte/store";
  import { paneStore, pendingCloseEdge, type PaneState } from "../stores/paneStore";
  import SettingsPane from "./panes/SettingsPane.svelte";
  import MapPane from "./panes/MapPane.svelte";
  import PacksPane from "./panes/PacksPane.svelte";
  import SearchPane from "./panes/SearchPane.svelte";
  import WakeAlarmPane from "./panes/WakeAlarmPane.svelte";


  export let pane: PaneState;

  let isDraggingResize = false;
  let resizeStartPos = 0;
  let resizeStartSize = 0;

  // Set by the settings pane while its Appearance section is open, so the
  // reader behind shows its real colours and typeface as they are edited.
  let clearBackdrop = false;

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

  // Reactive: true when this pane's drag is in the "will close" zone
  $: isPendingClose = $pendingCloseEdge === pane.position;

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

    // Fire the moment the unclamped size drops below the 20% minimum —
    // this is the exact instant the user has pushed as far as the pane goes.
    pendingCloseEdge.set(newSize < 20 ? pane.position : null);
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
  class:clear={clearBackdrop}
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
    class:pending-close={isPendingClose}
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
      <SettingsPane bind:clearBackdrop />
    {:else if pane.type === "map"}
      <MapPane />
    {:else if pane.type === "packs"}
      <PacksPane />
    {:else if pane.type === "search"}
      <SearchPane />
    {:else if pane.type === "wakealarm"}
      <WakeAlarmPane />
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
    transition: background 0.25s ease, backdrop-filter 0.25s ease;
  }

  /* Still catches clicks — the reader is visible, not interactive. */
  .backdrop.clear {
    background: transparent;
    backdrop-filter: none;
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

  .resize-handle.pending-close {
    background: rgba(220, 30, 30, 0.75);
    transition: background 0.1s;
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
