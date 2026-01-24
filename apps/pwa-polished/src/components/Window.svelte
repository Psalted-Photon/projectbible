<script lang="ts">
  import { windowStore, type WindowState } from "../lib/stores/windowStore";
  import { onMount } from 'svelte';

  export let window: WindowState;

  let isDraggingResize = false;
  let dragStartPos = 0;
  let startSize = 0;

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

<div
  class="panel panel-{window.edge} panel-{window.contentType}"
  class:themed={window.contentType !== 'map'}
  style="
    {window.edge === 'left' || window.edge === 'right' ? `width: ${window.size}%` : `height: ${window.size}%`};
  "
  class:resizing={window.isResizing}
>
  <!-- Resize handle -->
  <div 
    class="resize-handle resize-{window.edge}"
    on:mousedown={handleResizeStart}
    on:touchstart={handleResizeStart}
    role="button"
    tabindex="-1"
    aria-label="Resize panel"
  ></div>

  <!-- Panel header -->
  <div class="panel-header">
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

  .resize-left {
    right: -4px;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
  }

  .resize-right {
    left: -4px;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
  }

  .resize-top {
    bottom: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
  }

  .resize-bottom {
    top: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
  }

  .panel-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: 15px;
    flex-shrink: 0;
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
