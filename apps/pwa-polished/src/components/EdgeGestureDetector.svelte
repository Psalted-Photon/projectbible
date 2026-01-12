<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { usePaneStore } from '../stores/paneStore';
  
  const EDGE_ZONE_WIDTH = 20; // pixels
  const OPEN_THRESHOLD = 0.3; // 30% of screen width/height
  
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let edgePosition: 'left' | 'right' | 'bottom' | null = null;
  
  function handleTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    
    // Detect edge zones
    if (x < EDGE_ZONE_WIDTH) {
      edgePosition = 'left';
      startDrag(x, y);
    } else if (x > window.innerWidth - EDGE_ZONE_WIDTH) {
      edgePosition = 'right';
      startDrag(x, y);
    } else if (y > window.innerHeight - EDGE_ZONE_WIDTH) {
      edgePosition = 'bottom';
      startDrag(x, y);
    }
  }
  
  function handleMouseDown(e: MouseEvent) {
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < EDGE_ZONE_WIDTH) {
      edgePosition = 'left';
      startDrag(x, y);
    } else if (x > window.innerWidth - EDGE_ZONE_WIDTH) {
      edgePosition = 'right';
      startDrag(x, y);
    } else if (y > window.innerHeight - EDGE_ZONE_WIDTH) {
      edgePosition = 'bottom';
      startDrag(x, y);
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
    
    const dragDistance = edgePosition === 'bottom'
      ? startY - currentY
      : edgePosition === 'left'
        ? currentX - startX
        : startX - currentX;
    
    const threshold = edgePosition === 'bottom'
      ? window.innerHeight * OPEN_THRESHOLD
      : window.innerWidth * OPEN_THRESHOLD;
    
    if (dragDistance > threshold) {
      // Open appropriate pane based on edge
      const paneType = getPaneTypeForEdge(edgePosition);
      usePaneStore.getState().openPane(paneType, edgePosition);
    }
    
    isDragging = false;
    edgePosition = null;
  }
  
  function handleMouseUp() {
    handleTouchEnd();
  }
  
  function getPaneTypeForEdge(position: 'left' | 'right' | 'bottom') {
    // Default pane types for each edge - can be customized
    switch (position) {
      case 'left':
        return 'settings';
      case 'right':
        return 'search';
      case 'bottom':
        return 'map';
      default:
        return 'settings';
    }
  }
  
  onMount(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  });
  
  onDestroy(() => {
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    
    window.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });
</script>

<!-- Visual feedback during drag (optional) -->
{#if isDragging && edgePosition}
  <div class="drag-indicator {edgePosition}"></div>
{/if}

<style>
  .drag-indicator {
    position: fixed;
    background: rgba(255, 255, 255, 0.1);
    pointer-events: none;
    z-index: 9999;
    transition: opacity 0.2s;
  }
  
  .drag-indicator.left {
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }
  
  .drag-indicator.right {
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }
  
  .drag-indicator.bottom {
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
  }
</style>
