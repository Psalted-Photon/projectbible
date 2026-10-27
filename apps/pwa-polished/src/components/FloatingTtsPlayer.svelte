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
  import { onDestroy } from 'svelte';
  import { DotsSixVertical, SkipBack, SkipForward, Play, Pause, Stop, X } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import { floatDrag } from '../lib/floatDrag';
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
  /** Placing, clamping and dragging live in lib/floatDrag.ts. */
  const drag = floatDrag({ load: getTtsPlayerPos, save: setTtsPlayerPos });

  $: if (visible && el) void drag.place(el);
  $: if (!visible) drag.teardown();

  onDestroy(() => drag.teardown());
</script>

{#if visible}
  <div
    bind:this={el}
    use:portal
    class="ftp themed"
    class:dragging={$drag.dragging}
    class:failed
    style="left: {$drag.left}px; top: {$drag.top}px; visibility: {$drag.ready ? 'visible' : 'hidden'};"
    role="region"
    aria-label="Read Aloud"
    on:pointerdown={drag.start}
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
