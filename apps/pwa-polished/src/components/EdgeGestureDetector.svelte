<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { windowStore, type WindowEdge } from "../lib/stores/windowStore";

  const EDGE_ZONE_WIDTH = 20; // pixels
  const OPEN_THRESHOLD = 0.05; // 5% of screen width/height

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let edgePosition: WindowEdge | null = null;
  let hoveredEdge: WindowEdge | null = null;
  let mouseX = 0;
  let mouseY = 0;

  $: atLimit = $windowStore.length >= 6;
  $: bumperClass = atLimit ? 'at-limit' : 'normal';

  // Calculate drag distance for visual preview
  $: dragDistance = (() => {
    if (!isDragging || !edgePosition) return 0;
    
    switch (edgePosition) {
      case "top":
        return Math.max(0, currentY - startY);
      case "bottom":
        return Math.max(0, startY - currentY);
      case "left":
        return Math.max(0, currentX - startX);
      case "right":
        return Math.max(0, startX - currentX);
      default:
        return 0;
    }
  })();

  $: dragPercent = (() => {
    if (!isDragging || !edgePosition) return 0;
    const screenSize = (edgePosition === 'left' || edgePosition === 'right') 
      ? window.innerWidth 
      : window.innerHeight;
    return Math.min(90, (dragDistance / screenSize) * 100);
  })();

  function handleTouchStart(e: TouchEvent) {
    if (atLimit) return; // Don't allow new windows at limit

    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    // Detect edge zones (all 4 edges)
    if (y < EDGE_ZONE_WIDTH) {
      edgePosition = "top";
      startDrag(x, y);
    } else if (x < EDGE_ZONE_WIDTH) {
      edgePosition = "left";
      startDrag(x, y);
    } else if (x > window.innerWidth - EDGE_ZONE_WIDTH) {
      edgePosition = "right";
      startDrag(x, y);
    } else if (y > window.innerHeight - EDGE_ZONE_WIDTH) {
      edgePosition = "bottom";
      startDrag(x, y);
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (atLimit) return; // Don't allow new windows at limit

    const x = e.clientX;
    const y = e.clientY;

    if (y < EDGE_ZONE_WIDTH) {
      edgePosition = "top";
      startDrag(x, y);
    } else if (x < EDGE_ZONE_WIDTH) {
      edgePosition = "left";
      startDrag(x, y);
    } else if (x > window.innerWidth - EDGE_ZONE_WIDTH) {
      edgePosition = "right";
      startDrag(x, y);
    } else if (y > window.innerHeight - EDGE_ZONE_WIDTH) {
      edgePosition = "bottom";
      startDrag(x, y);
    }
  }

  function handleMouseMoveHover(e: MouseEvent) {
    if (isDragging) return;

    mouseX = e.clientX;
    mouseY = e.clientY;

    // Update hover state for bumpers
    if (mouseY < EDGE_ZONE_WIDTH) {
      hoveredEdge = "top";
    } else if (mouseX < EDGE_ZONE_WIDTH) {
      hoveredEdge = "left";
    } else if (mouseX > window.innerWidth - EDGE_ZONE_WIDTH) {
      hoveredEdge = "right";
    } else if (mouseY > window.innerHeight - EDGE_ZONE_WIDTH) {
      hoveredEdge = "bottom";
    } else {
      hoveredEdge = null;
    }
  }

  function startDrag(x: number, y: number) {
    isDragging = true;
    startX = x;
    startY = y;
    currentX = x;
    currentY = y;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging) return;

    const touch = e.touches[0];
    currentX = touch.clientX;
    currentY = touch.clientY;

    // Prevent default scrolling while dragging
    e.preventDefault();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    currentX = e.clientX;
    currentY = e.clientY;
  }

  function handleTouchEnd() {
    if (!isDragging || !edgePosition) return;

    let dragDistance = 0;
    let threshold = 0;
    let screenSize = 0;

    switch (edgePosition) {
      case "top":
        dragDistance = currentY - startY;
        screenSize = window.innerHeight;
        threshold = screenSize * OPEN_THRESHOLD;
        break;
      case "bottom":
        dragDistance = startY - currentY;
        screenSize = window.innerHeight;
        threshold = screenSize * OPEN_THRESHOLD;
        break;
      case "left":
        dragDistance = currentX - startX;
        screenSize = window.innerWidth;
        threshold = screenSize * OPEN_THRESHOLD;
        break;
      case "right":
        dragDistance = startX - currentX;
        screenSize = window.innerWidth;
        threshold = screenSize * OPEN_THRESHOLD;
        break;
    }

    const dragPercent = Math.min(90, Math.max(10, (dragDistance / screenSize) * 100));

    console.log('🪟 EDGE GESTURE:', {
      edge: edgePosition,
      dragDistance: `${dragDistance}px`,
      screenSize: `${screenSize}px`,
      dragPercent: `${dragPercent.toFixed(1)}%`,
      threshold: `${threshold}px`,
      willOpen: dragDistance > threshold
    });

    if (dragDistance > threshold) {
      // Create new window with the actual dragged size
      const windowId = windowStore.createWindow(edgePosition, dragPercent);
      console.log(`✅ Window opened: ${windowId} at ${dragPercent.toFixed(1)}%`);
    } else {
      console.log('❌ Drag too short, window not opened');
    }

    isDragging = false;
    edgePosition = null;
  }

  function handleMouseUp() {
    handleTouchEnd();
  }

  onMount(() => {
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousemove", handleMouseMoveHover);
    window.addEventListener("mouseup", handleMouseUp);
  });

  onDestroy(() => {
    window.removeEventListener("touchstart", handleTouchStart);
    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", handleTouchEnd);

    window.removeEventListener("mousedown", handleMouseDown);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mousemove", handleMouseMoveHover);
    window.removeEventListener("mouseup", handleMouseUp);
  });
</script>

<!-- Visual bumpers at screen edges -->
<div class="bumper bumper-top {bumperClass}" class:hovered={hoveredEdge === 'top'}></div>
<div class="bumper bumper-left {bumperClass}" class:hovered={hoveredEdge === 'left'}></div>
<div class="bumper bumper-right {bumperClass}" class:hovered={hoveredEdge === 'right'}></div>
<div class="bumper bumper-bottom {bumperClass}" class:hovered={hoveredEdge === 'bottom'}></div>

<!-- Visual feedback during drag - preview panel -->
{#if isDragging && edgePosition}
  <div 
    class="drag-preview drag-preview-{edgePosition}"
    style="
      {edgePosition === 'left' || edgePosition === 'right' ? `width: ${dragPercent}%` : `height: ${dragPercent}%`};
    "
  ></div>
{/if}

<style>
  .bumper {
    position: fixed;
    background: rgba(80, 80, 80, 0.3); /* dark grey */
    pointer-events: none;
    z-index: 9998;
    transition: background 0.2s;
  }

  .bumper.hovered {
    background: rgba(140, 140, 140, 0.5); /* light grey */
  }

  .bumper.at-limit {
    background: rgba(139, 0, 0, 0.6); /* dark red */
  }

  .bumper.at-limit.hovered {
    background: rgba(139, 0, 0, 0.6); /* stay dark red */
  }

  .bumper-top {
    left: 0;
    right: 0;
    top: 0;
    height: 4px;
  }

  .bumper-left {
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }

  .bumper-right {
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }

  .bumper-bottom {
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
  }

  .drag-preview {
    position: fixed;
    background: rgba(102, 126, 234, 0.2);
    border: 2px solid rgba(102, 126, 234, 0.6);
    pointer-events: none;
    z-index: 9999;
    transition: none;
  }

  .drag-preview-left {
    left: 0;
    top: 0;
    bottom: 0;
    border-right: 2px solid #667eea;
  }

  .drag-preview-right {
    right: 0;
    top: 0;
    bottom: 0;
    border-left: 2px solid #667eea;
  }

  .drag-preview-top {
    left: 0;
    right: 0;
    top: 0;
    border-bottom: 2px solid #667eea;
  }

  .drag-preview-bottom {
    left: 0;
    right: 0;
    bottom: 0;
    border-top: 2px solid #667eea;
  }
</style>