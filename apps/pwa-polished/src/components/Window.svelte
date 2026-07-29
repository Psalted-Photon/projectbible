<script lang="ts">
  import { windowStore, type WindowState, type WindowEdge } from "../lib/stores/windowStore";
  import { onMount } from 'svelte';

  export let window: WindowState;

  // Send this window to another edge. The reader re-insets itself from the
  // store, so nothing here has to know about the layout.
  const EDGES: { edge: WindowEdge; label: string; glyph: string }[] = [
    { edge: 'left', label: 'Dock left', glyph: '◀' },
    { edge: 'top', label: 'Dock top', glyph: '▲' },
    { edge: 'bottom', label: 'Dock bottom', glyph: '▼' },
    { edge: 'right', label: 'Dock right', glyph: '▶' },
  ];

  function moveTo(edge: WindowEdge) {
    if (edge === window.edge) return;
    windowStore.setWindowEdge(window.id, edge);
  }

  let isDraggingResize = false;
  let dragStartPos = 0;
  let startSize = 0;
  let isInCloseZone = false;

  onMount(() => {
    const windowNumber = window.id.split('-')[1];
    console.log(`🎨 WINDOW ${windowNumber} MOUNTED:`, {
      edge: window.edge,
      size: `${window.size.toFixed(1)}%`,
      contentType: window.contentType
    });
  });

  // Track size changes reactively
  $: if (window.size !== undefined) {
    const windowNumber = window.id.split('-')[1];
    console.log(`📊 WINDOW ${windowNumber} SIZE REACTIVE UPDATE:`, {
      edge: window.edge,
      newSize: `${window.size.toFixed(1)}%`
    });
  }

  function handleResizeStart(e: MouseEvent | TouchEvent) {
    isDraggingResize = true;
    windowStore.setResizing(window.id, true);
    
    const windowNumber = window.id.split('-')[1];
    console.log(`🔹 WINDOW ${windowNumber} RESIZE START:`, {
      edge: window.edge,
      currentSize: `${window.size.toFixed(1)}%`
    });
    
    const clientPos = 'touches' in e ? e.touches[0] : e;
    if (window.edge === 'left' || window.edge === 'right') {
      dragStartPos = clientPos.clientX;
    } else {
      dragStartPos = clientPos.clientY;
    }
    startSize = window.size;
    
    e.preventDefault();
  }

  function handleResizeMove(e: MouseEvent | TouchEvent) {
    if (!isDraggingResize) return;

    const clientPos = 'touches' in e ? e.touches[0] : e;
    const screenSize = window.edge === 'left' || window.edge === 'right' 
      ? globalThis.window.innerWidth 
      : globalThis.window.innerHeight;
    
    let currentPos = 0;
    let delta = 0;
    
    if (window.edge === 'left' || window.edge === 'right') {
      currentPos = clientPos.clientX;
      delta = currentPos - dragStartPos;
    } else {
      currentPos = clientPos.clientY;
      delta = currentPos - dragStartPos;
    }

    // Convert delta to percentage
    const deltaPercent = (delta / screenSize) * 100;
    
    // Adjust based on edge
    let newSize = startSize;
    if (window.edge === 'right') {
      // RIGHT panel: handle is on LEFT side
      // Drag LEFT (negative delta) = make panel BIGGER
      // Drag RIGHT (positive delta) = make panel SMALLER
      newSize = startSize - deltaPercent;
    } else if (window.edge === 'left') {
      // LEFT panel: handle is on RIGHT side  
      // Drag RIGHT (positive delta) = make panel BIGGER
      newSize = startSize + deltaPercent;
    } else if (window.edge === 'bottom') {
      // BOTTOM panel: handle is on TOP (opposite side like RIGHT)
      // Drag UP (negative delta) = make panel BIGGER
      // Drag DOWN (positive delta) = make panel SMALLER
      newSize = startSize - deltaPercent;
    } else {
      // TOP panel: handle is on BOTTOM (same side as LEFT)
      // Drag DOWN (positive delta) = make panel BIGGER
      newSize = startSize + deltaPercent;
    }

    const windowNumber = window.id.split('-')[1];
    if (Math.abs(delta) > 50) { // Only log significant movements
      console.log(`🔧 WINDOW ${windowNumber} RESIZE MOVE:`, {
        edge: window.edge,
        dragStartPos: `${dragStartPos}px`,
        currentPos: `${currentPos}px`,
        delta: `${delta}px`,
        screenSize: `${screenSize}px`,
        deltaPercent: `${deltaPercent.toFixed(1)}%`,
        startSize: `${startSize.toFixed(1)}%`,
        calculatedNewSize: `${newSize.toFixed(1)}%`
      });
    }

    // Close zone: fires the moment unclamped size drops below the 10% minimum —
    // the instant the user pushes "through" where the window stopped. Zero dead zone.
    isInCloseZone = newSize < 10;

    windowStore.updateWindowSize(window.id, newSize);
  }

  function handleResizeEnd() {
    if (!isDraggingResize) return;
    
    const windowNumber = window.id.split('-')[1];
    console.log(`✅ WINDOW ${windowNumber} RESIZE END:`, {
      edge: window.edge,
      finalSize: `${window.size.toFixed(1)}%`
    });

    isDraggingResize = false;
    windowStore.setResizing(window.id, false);

    if (isInCloseZone) {
      windowStore.closeWindow(window.id);
    }
    isInCloseZone = false;
  }

  function handleCloseClick() {
    windowStore.closeWindow(window.id);
  }
</script>

<svelte:window 
  on:mousemove={handleResizeMove} 
  on:mouseup={handleResizeEnd}
  on:touchmove={handleResizeMove}
  on:touchend={handleResizeEnd}
/>

<!-- `themed` is a whole-panel color inversion on the light and sepia themes.
     Maps can't take it (the tiles invert), and neither can the encyclopedia,
     which paints its own dark card in every theme so a pinned article looks
     exactly like the modal it came out of. -->
<div
  class="panel panel-{window.edge} panel-{window.contentType}"
  class:themed={window.contentType !== 'map' && window.contentType !== 'isbe'}
  style="
    {window.edge === 'left' || window.edge === 'right' ? `width: ${window.size}%` : `height: ${window.size}%`};
  "
  class:resizing={window.isResizing}
>
  <!-- Resize handle -->
  <div 
    class="resize-handle resize-{window.edge}"
    class:close-zone={isInCloseZone}
    on:mousedown={handleResizeStart}
    on:touchstart={handleResizeStart}
    role="button"
    tabindex="-1"
    aria-label="Resize panel"
  ></div>

  <!-- Panel header -->
  <div class="panel-header">
    <div class="edge-buttons">
      {#each EDGES as e}
        <button
          class="edge-button"
          class:current={window.edge === e.edge}
          on:click={() => moveTo(e.edge)}
          disabled={window.edge === e.edge}
          title={e.label}
          aria-label={e.label}
        >{e.glyph}</button>
      {/each}
    </div>
    <button class="close-button" on:click={handleCloseClick} aria-label="Close panel">×</button>
  </div>

  <!-- Panel content -->
  <div class="panel-content">
    <slot />
  </div>
</div>

<style>
  .panel {
    position: relative;
    background: #2a2a2a;
    border: 1px solid #444;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    pointer-events: auto;
  }

  .panel-left,
  .panel-right {
    height: 100%;
    flex-shrink: 0;
  }

  .panel-top,
  .panel-bottom {
    width: 100%;
    flex-shrink: 0;
  }

  .panel-left {
    border-right: 2px solid #667eea;
  }

  .panel-right {
    border-left: 2px solid #667eea;
  }

  .panel-top {
    border-bottom: 2px solid #667eea;
  }

  .panel-bottom {
    border-top: 2px solid #667eea;
  }

  .resize-handle {
    position: absolute;
    background: transparent;
    z-index: 100;
    transition: background 0.2s;
  }

  .resize-handle:hover,
  .panel.resizing .resize-handle {
    background: rgba(102, 126, 234, 0.3);
  }

  .resize-handle.close-zone {
    background: rgba(220, 38, 38, 0.8);
  }

  .resize-left {
    right: -8px;
    top: 0;
    bottom: 0;
    width: 32px;
    cursor: ew-resize;
  }

  .resize-right {
    left: -8px;
    top: 0;
    bottom: 0;
    width: 32px;
    cursor: ew-resize;
  }

  .resize-top {
    bottom: -8px;
    left: 0;
    right: 0;
    height: 32px;
    cursor: ns-resize;
  }

  .resize-bottom {
    top: -8px;
    left: 0;
    right: 0;
    height: 32px;
    cursor: ns-resize;
  }

  /* Above the resize handle. The handle runs the full length of the panel's
     inner edge at z-index 100, which puts it over this strip on left-, right-
     and bottom-docked panels — the close button there was unclickable, and the
     edge buttons would have been too. Losing 20px of drag length at one end of
     the handle costs nothing; the rest of the edge still resizes. */
  .panel-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 0 2px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 20px;
    flex-shrink: 0;
    position: relative;
    z-index: 101;
  }

  /* Clips rather than pushing the close button off the end when a window is
     dragged down near its 10% minimum. */
  .edge-buttons {
    display: flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
    overflow: hidden;
  }

  .edge-button {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.65);
    font-size: 9px;
    line-height: 1;
    width: 17px;
    height: 16px;
    border-radius: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.2s, color 0.2s;
  }

  .edge-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }

  /* The edge it's already on: shown filled in as a position marker rather than
     hidden, so the four together read as "here, and where else it can go". */
  .edge-button.current {
    color: white;
    background: rgba(255, 255, 255, 0.28);
    cursor: default;
  }

  .close-button {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    font-size: 12px;
    width: 15px;
    height: 15px;
    border-radius: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .panel-content {
    flex: 1;
    overflow: auto;
    background: #1a1a1a;
  }
</style>
