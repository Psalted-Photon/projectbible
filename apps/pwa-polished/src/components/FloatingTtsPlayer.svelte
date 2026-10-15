<script lang="ts">
  /**
   * The floating Read Aloud player for plain text — a commentary, a devotional,
   * a verse's commentary. Scripture keeps its controls in the top bar; this
   * shows only while text is being read.
   *
   * Fixed to the screen, so scrolling never moves it, and dragged by anything
   * that is not a button. The spot it is left in is remembered per device.
   * Dark by design and carries `themed`, so light and sepia flip it the same
   * way they flip the reader, and Custom paints it with the reader's colors.
   */
  import { onDestroy, tick } from 'svelte';
  import { DotsSixVertical, SkipBack, SkipForward, Play, Pause, Stop, X } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import { fixedOrigin } from '../lib/fixedOrigin';
  import { getTtsPlayerPos, setTtsPlayerPos } from '../adapters/settings';
  import {
    readingState,
    readingSource,
    readingError,
    isPreparing,
    chapterProgress,
    togglePlayPause,
    stopReading,
    skipParagraph,
  } from '../lib/tts/readingEngine';
  import BrandSpinner from './BrandSpinner.svelte';

  /** Gap kept from the screen's edges, for the default spot and the clamp. */
  const MARGIN = 8;

  $: isText = $readingSource.kind === 'text';
  $: title = $readingSource.kind === 'text' ? $readingSource.title : '';
  $: failed = $readingState === 'error';
  $: visible =
    isText &&
    ($readingState === 'starting' || $readingState === 'playing' || $readingState === 'paused' || failed);
  $: progress =
    $chapterProgress && $chapterProgress.duration > 0
      ? Math.min(1, $chapterProgress.position / $chapterProgress.duration)
      : 0;

  let el: HTMLDivElement | null = null;
  let left = 0;
  let top = 0;
  let placed = false;
  /** Hidden until placed, so it never flashes in the top-left corner. */
  let ready = false;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let gestureBounds: { width: number; height: number } | null = null;
  let observer: ResizeObserver | null = null;

  $: if (visible && el && !placed) void place();
  $: if (!visible) teardown();

  /** First showing: the remembered spot, or bottom-right. */
  async function place() {
    placed = true;
    await tick();
    if (!el) return;
    const saved = getTtsPlayerPos();
    const { width, height } = bounds();
    if (saved) {
      left = saved.x;
      top = saved.y;
    } else {
      left = width - el.offsetWidth - MARGIN;
      top = height - el.offsetHeight - MARGIN;
    }
    clampIntoView();
    ready = true;
    // The title changes length as the reading moves on, and unfolding the
    // phone changes the screen — either can push it off an edge.
    window.addEventListener('resize', clampIntoView);
    observer = new ResizeObserver(() => clampIntoView());
    observer.observe(el);
  }

  function teardown() {
    placed = false;
    ready = false;
    window.removeEventListener('resize', clampIntoView);
    observer?.disconnect();
    observer = null;
  }

  /** The box it is placed in. See lib/fixedOrigin.ts. */
  function bounds(): { width: number; height: number } {
    if (gestureBounds) return gestureBounds;
    const origin = fixedOrigin(el);
    return { width: origin.width, height: origin.height };
  }

  /** Wholly on screen — it is small enough that a sliver would be useless. */
  function clampIntoView() {
    if (!el) return;
    const { width, height } = bounds();
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, width - el.offsetWidth - MARGIN));
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, height - el.offsetHeight - MARGIN));
  }

  function startDrag(e: PointerEvent) {
    // Buttons are buttons; everything else is the handle.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const origin = fixedOrigin(el);
    gestureBounds = { width: origin.width, height: origin.height };
    startX = e.clientX;
    startY = e.clientY;
    startLeft = left;
    startTop = top;
    dragging = true;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety — the window listeners below still work */
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    left = startLeft + (e.clientX - startX);
    top = startTop + (e.clientY - startY);
    clampIntoView();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    gestureBounds = null;
    removeDragListeners();
    setTtsPlayerPos({ x: Math.round(left), y: Math.round(top) });
  }

  function removeDragListeners() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }

  onDestroy(() => {
    teardown();
    removeDragListeners();
  });
</script>

{#if visible}
  <div
    bind:this={el}
    use:portal
    class="ftp themed"
    class:dragging
    class:failed
    style="left: {left}px; top: {top}px; visibility: {ready ? 'visible' : 'hidden'};"
    role="region"
    aria-label="Read Aloud"
    on:pointerdown={startDrag}
  >
    <span class="grip" aria-hidden="true"><DotsSixVertical size="1em" weight="bold" /></span>

    {#if failed}
      <span class="title" title={$readingError}>{$readingError || 'Could not read this aloud.'}</span>
      <button class="btn" on:click={stopReading} aria-label="Dismiss" title="Dismiss">
        <X size="1em" weight="bold" />
      </button>
    {:else}
      <span class="title" {title}>{title}</span>
      <button class="btn" on:click={() => skipParagraph(-1)} aria-label="Back a paragraph" title="Back a paragraph">
        <SkipBack size="1em" weight="fill" />
      </button>
      <button
        class="btn play"
        on:click={togglePlayPause}
        disabled={$readingState === 'starting'}
        aria-label={$readingState === 'playing' ? 'Pause' : 'Play'}
        title={$readingState === 'playing' ? 'Pause' : 'Play'}
      >
        {#if $isPreparing}
          <BrandSpinner size={18} />
        {:else if $readingState === 'playing'}
          <Pause size="1em" weight="fill" />
        {:else}
          <Play size="1em" weight="fill" />
        {/if}
      </button>
      <button class="btn" on:click={() => skipParagraph(1)} aria-label="Forward a paragraph" title="Forward a paragraph">
        <SkipForward size="1em" weight="fill" />
      </button>
      <button class="btn" on:click={stopReading} aria-label="Stop" title="Stop">
        <Stop size="1em" weight="fill" />
      </button>
      <span class="progress" style="transform: scaleX({progress});" aria-hidden="true"></span>
    {/if}
  </div>
{/if}

<style>
  .ftp {
    --s: var(--bar-scale, 1);
    position: fixed;
    /* Over the devotional overlay and popovers, under notices and questions. */
    z-index: 10055;
    display: flex;
    align-items: center;
    gap: calc(2px * var(--s));
    max-width: min(calc(100vw - 16px), calc(340px * var(--s)));
    padding: calc(3px * var(--s)) calc(4px * var(--s)) calc(3px * var(--s)) calc(2px * var(--s));
    overflow: hidden;
    background: var(--reader-bg, #1c1c1e);
    color: var(--reader-text, rgba(255, 255, 255, 0.92));
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    font-size: calc(16px * var(--s));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }

  .ftp.dragging {
    cursor: grabbing;
  }

  .grip {
    display: flex;
    flex-shrink: 0;
    font-size: 0.85em;
    opacity: 0.4;
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 calc(4px * var(--s)) 0 calc(1px * var(--s));
    font-family: 'Milonga', cursive;
    font-size: 0.85em;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .failed .title {
    color: #e57373;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: calc(30px * var(--s));
    height: calc(30px * var(--s));
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 1em;
    cursor: pointer;
  }

  .btn:hover {
    background: rgba(127, 127, 127, 0.18);
  }

  .btn.play {
    color: #e6b84a;
  }

  .btn:disabled {
    cursor: default;
  }

  /* How far through the passage, as a hairline along the bottom edge. */
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: #e6b84a;
    opacity: 0.7;
    transform-origin: left;
    pointer-events: none;
  }
</style>
