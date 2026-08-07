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
    if (suppressClick) return;
    if (edge === window.edge) return;
    windowStore.setWindowEdge(window.id, edge);
  }

  let isDraggingResize = false;
  let dragStartPos = 0;
  let startSize = 0;
  let isInCloseZone = false;

  // A press on the header that hasn't yet moved far enough to count as a drag.
  // The header carries the dock arrows and the close button, so grabbing it can
  // mean either thing; which one it was is only known once the pointer moves.
  let pendingHeaderDrag = false;
  // Set once a header press turns into a real drag, so the click that arrives
  // on mouseup doesn't also dock or close the panel.
  let suppressClick = false;

  /** How far the pointer must travel on the resize axis before a press on the
      header stops being a button click and becomes a resize. */
  const DRAG_THRESHOLD_PX = 4;

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

  /** The pointer coordinate on whichever axis this panel resizes along. */
  function axisPos(e: MouseEvent | TouchEvent): number {
    const clientPos = 'touches' in e ? e.touches[0] : e;
    return window.edge === 'left' || window.edge === 'right'
      ? clientPos.clientX
      : clientPos.clientY;
  }

  /** Arm a drag from the given start coordinate, without engaging it yet. */
  function armResize(startPos: number) {
    dragStartPos = startPos;
    startSize = window.size;
  }

  function engageResize() {
    isDraggingResize = true;
    windowStore.setResizing(window.id, true);

    const windowNumber = window.id.split('-')[1];
    console.log(`🔹 WINDOW ${windowNumber} RESIZE START:`, {
      edge: window.edge,
      currentSize: `${window.size.toFixed(1)}%`
    });
  }

  /** The edge strip. Nothing to click inside it, so it drags immediately. */
  function handleResizeStart(e: MouseEvent | TouchEvent) {
    armResize(axisPos(e));
    engageResize();
    e.preventDefault();
  }

  /**
   * The header bar. Same drag, but deferred: it only becomes a resize once the
   * pointer has moved past the threshold, so tapping an arrow still docks.
   *
   * preventDefault is for mouse only. On mousedown it suppresses the text
   * selection a drag would otherwise paint, and the click still fires after it.
   * On touchstart it would cancel the synthesised click and kill the buttons,
   * so scrolling is held off with `touch-action: none` in the CSS instead.
   */
  function handleHeaderDragStart(e: MouseEvent | TouchEvent) {
    suppressClick = false;
    pendingHeaderDrag = true;
    armResize(axisPos(e));

    if (!('touches' in e)) e.preventDefault();
  }

  function handleResizeMove(e: MouseEvent | TouchEvent) {
    if (pendingHeaderDrag && !isDraggingResize) {
      if (Math.abs(axisPos(e) - dragStartPos) < DRAG_THRESHOLD_PX) return;
      suppressClick = true;
      engageResize();
    }
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
    pendingHeaderDrag = false;
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
    if (suppressClick) return;
    windowStore.closeWindow(window.id);
  }

  // The three reference works put an alphabet rail and per-row buttons hard
  // against the panel's inner edge — the same strip the resize grip covers.
  // They get an inset; nothing else needs one.
  $: isLibrary = ['isbe', 'naves', 'person'].includes(window.contentType);
</script>

<svelte:window 
  on:mousemove={handleResizeMove} 
  on:mouseup={handleResizeEnd}
  on:touchmove={handleResizeMove}
  on:touchend={handleResizeEnd}
/>

<!-- `themed` is a whole-panel color inversion on the light and sepia themes.
     Maps can't take it (the tiles invert), and neither can the encyclopedia or
     a person's bio, which paint their own dark card in every theme so a pinned
     page looks exactly like the modal it came out of. -->
<div
  class="panel panel-{window.edge} panel-{window.contentType}"
  class:themed={!['map', 'isbe', 'person', 'naves'].includes(window.contentType)}
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

  <!-- Panel header. Doubles as the main resize grip — see the CSS below. The
       accessible name for resizing stays on the handle above, which is the
       same gesture; no role here, so the buttons inside keep theirs. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="panel-header header-{window.edge}"
    class:close-zone={isInCloseZone}
    on:mousedown={handleHeaderDragStart}
    on:touchstart={handleHeaderDragStart}
  >
    <div class="edge-buttons">
      {#each EDGES as e}
        <button
          class="edge-button"
          class:current={window.edge === e.edge}
          on:click={() => moveTo(e.edge)}
          aria-disabled={window.edge === e.edge}
          title={e.label}
          aria-label={e.label}
        >{e.glyph}</button>
      {/each}
    </div>
    <button class="close-button" on:click={handleCloseClick} aria-label="Close panel">×</button>
  </div>

  <!-- Panel content -->
  <div class="panel-content" class:library={isLibrary}>
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

  /* Scoped under .panel.resizing to outrank the blue tint above it. As plain
     `.resize-handle.close-zone` it lost on specificity to the three-class
     selector — and since the close zone can only be entered mid-drag, that
     meant the red never once appeared. Losing nothing by narrowing it: the
     panel is always resizing when this class is set. */
  .panel.resizing .resize-handle.close-zone {
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
     edge buttons would have been too.

     Which is why this bar is itself a resize grip. It was covering the part of
     the handle nearest the buttons and leaving only the few pixels overhanging
     outside the panel to grab; now the whole bar drags. `touch-action: none`
     stands in for the preventDefault that touchstart can't have without
     killing the buttons — see handleHeaderDragStart. */
  .panel-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 0 2px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 24px;
    flex-shrink: 0;
    position: relative;
    z-index: 101;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: background 0.2s;
  }

  .header-left,
  .header-right {
    cursor: ew-resize;
  }

  .header-top,
  .header-bottom {
    cursor: ns-resize;
  }

  /* Same warning the edge handle gives, on the surface actually being dragged.
     Releasing here closes the panel. */
  .panel-header.close-zone {
    background: rgba(220, 38, 38, 0.8);
  }

  /* The other half of why the warning was never seen: on light and sepia the
     panel carries `filter: invert(1) hue-rotate(180deg)` (App.svelte), which
     turns this red into cyan. Cancelled by re-applying the same filter, the
     way .red-letter does. Maps and the encyclopedia never get .themed, so
     they're excluded and keep their red directly. */
  :global(body.light-theme) .panel.themed .panel-header.close-zone,
  :global(body.sepia-theme) .panel.themed .panel-header.close-zone,
  :global(body.light-theme) .panel.themed.resizing .resize-handle.close-zone,
  :global(body.sepia-theme) .panel.themed.resizing .resize-handle.close-zone {
    filter: invert(1) hue-rotate(180deg);
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

  .edge-button:hover:not(.current) {
    background: rgba(255, 255, 255, 0.25);
    color: white;
  }

  /* The edge it's already on: shown filled in as a position marker rather than
     hidden, so the four together read as "here, and where else it can go".
     Marked aria-disabled rather than disabled — a real disabled button swallows
     mouse events, which would leave a dead spot in the drag surface. moveTo
     ignores it either way. Cursor comes from the header so it reads as part of
     the grip. */
  .edge-button.current {
    color: white;
    background: rgba(255, 255, 255, 0.28);
    cursor: inherit;
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

  /* The resize grip runs the panel's full height along its inner edge at
     z-index 100, and this content sits underneath it. The header escapes by
     being z-index 101, but on a left- or right-docked panel the grip covers a
     24px column of everything below — which is exactly where the alphabet rail
     and the row buttons live. So library content is inset clear of it.

     Top- and bottom-docked panels need nothing: there the grip lies along the
     header's own band, which is already above it. */
  .panel-right .panel-content.library {
    padding-left: 26px;
  }
  .panel-left .panel-content.library {
    padding-right: 26px;
  }
</style>
