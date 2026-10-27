<script lang="ts">
  /**
   * The Bible's Read Aloud player, pulled out of the navbar into a pill of its
   * own. The tab under the player in the bar tears it out (NavigationBar); the
   * pill appears under the same finger, changing shape out of the bar's
   * player, and floats from then on — the next reading too — until it is
   * docked back. See lib/tts/playerDock.ts.
   *
   * Two rows: what is being read and the verse to jump to, then every control
   * the bar has, play in the middle. Dragged by anything that is not a control,
   * in a spot of its own (the Comms pill keeps another). Dark by design and
   * carries `themed`, like the Comms pill, so the themes treat the two alike.
   */
  import { onDestroy, tick } from 'svelte';
  import {
    DotsSixVertical,
    SkipBack,
    SkipForward,
    Play,
    Pause,
    Stop,
    ArrowFatLinesRight,
  } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import { floatDrag, type FloatPos } from '../lib/floatDrag';
  import { fixedOrigin } from '../lib/fixedOrigin';
  import { morphFrom, morphInto } from '../lib/motion';
  import { getBibleTtsPlayerPos, setBibleTtsPlayerPos } from '../adapters/settings';
  import { continuousPlay } from '../stores/audioStore';
  import {
    readingState,
    readingPosition,
    readingVerseList,
    isBibleReadingActive,
    isPreparing,
    chapterProgress,
    togglePlayPause,
    stopReading,
    jumpToVerse,
    skipChapter,
  } from '../lib/tts/readingEngine';
  import {
    sleepRemaining,
    stopAtChapterEnd,
    startSleepTimer,
    setStopAtChapterEnd,
    cancelSleepTimer,
    remainingMinutes,
  } from '../lib/tts/sleepTimer';
  import {
    bibleFloating,
    setBibleFloating,
    takeTearOut,
    dockDrag,
    homeBar,
    setDockNear,
    dockSlotRect,
  } from '../lib/tts/playerDock';
  import BrandSpinner from './BrandSpinner.svelte';

  $: visible = $isBibleReadingActive && $bibleFloating;
  $: reference = $readingPosition ? `${$readingPosition.book} ${$readingPosition.chapter}` : '';
  $: progress =
    $chapterProgress && $chapterProgress.duration > 0
      ? Math.min(1, $chapterProgress.position / $chapterProgress.duration)
      : 0;

  // The same sleep timer as the bar's.
  $: sleepArmed = $sleepRemaining !== null || $stopAtChapterEnd;
  $: sleepLabel = $stopAtChapterEnd
    ? '⏱ chapter'
    : $sleepRemaining !== null
      ? `⏱ ${remainingMinutes($sleepRemaining)}m`
      : '⏱';
  $: sleepChoice = sleepArmed ? 'keep' : '0';

  function applySleepChoice(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'keep') return;
    if (value === '0') cancelSleepTimer();
    else if (value === 'chapter') setStopAtChapterEnd();
    else startSleepTimer(parseInt(value, 10));
  }

  /**
   * A verse back or on. Past either end of the chapter it goes to the chapter
   * after, or back to the top of this one, the way skipping does elsewhere.
   */
  function stepVerse(direction: 1 | -1): void {
    const verses = $readingVerseList;
    const here = $readingPosition?.verse;
    const next = here == null ? undefined : verses[verses.indexOf(here) + direction];
    if (next !== undefined) jumpToVerse(next);
    else skipChapter(direction);
  }

  let el: HTMLDivElement | null = null;
  let gripEl: HTMLElement | null = null;
  /** Placing, clamping and dragging live in lib/floatDrag.ts. */
  const drag = floatDrag({
    load: getBibleTtsPlayerPos,
    save: setBibleTtsPlayerPos,
    adjust: leanTowardSlot,
    drop: dockIfNear,
  });

  $: if (visible && el) void show(el);
  $: if (!visible) drag.teardown();

  // ── Docking back ───────────────────────────────────────────────────────────
  // Carrying the pill offers its slot back: the bar it came from comes down
  // and shows a glowing gap where the player sat (NavigationBar). Within
  // NEAR_PX of it the glow brightens and the pill leans in; let go there and
  // it goes back into the bar. Let go anywhere else and it just stays put.
  const NEAR_PX = 16;
  /** How far toward the slot it leans: a share of the way, up to a cap. */
  const LEAN = 0.3;
  const LEAN_MAX = 28;

  /** Going into the slot; the slot has to stay until it is in. */
  let docking = false;

  $: carrying = $drag.dragging && $drag.moved;
  $: if (carrying && !$dockDrag) {
    dockDrag.set({ mode: 'dock', bar: homeBar(), near: false });
  } else if (!carrying && !docking && $dockDrag?.mode === 'dock') {
    dockDrag.set(null);
  }

  function leanTowardSlot(pos: FloatPos): FloatPos {
    const slot = dockSlotRect();
    if (!slot || !el) {
      setDockNear(false);
      return pos;
    }
    const origin = fixedOrigin(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = origin.left + pos.x;
    const top = origin.top + pos.y;
    const near =
      left < slot.right + NEAR_PX &&
      left + w > slot.left - NEAR_PX &&
      top < slot.bottom + NEAR_PX &&
      top + h > slot.top - NEAR_PX;
    setDockNear(near);
    if (!near) return pos;
    const dx = slot.left + slot.width / 2 - (left + w / 2);
    const dy = slot.top + slot.height / 2 - (top + h / 2);
    const k = Math.min(LEAN, LEAN_MAX / Math.max(1, Math.hypot(dx, dy)));
    return { x: pos.x + dx * k, y: pos.y + dy * k };
  }

  /** Let go in range: into the slot, and the bar's player takes over. */
  function dockIfNear(): boolean {
    const slot = $dockDrag?.near ? dockSlotRect() : null;
    if (!slot || !el) return false;
    docking = true;
    void morphInto(el, slot, '8px').then(() => {
      setBibleFloating(false);
      dockDrag.set(null);
      docking = false;
    });
    return true;
  }

  async function show(target: HTMLDivElement): Promise<void> {
    await drag.place(target);
    // Just torn out of the bar: take over the finger, holding the pill by its
    // grip, and change shape out of the player it was a moment ago.
    const torn = takeTearOut();
    if (!torn || el !== target || !$drag.ready) return;
    drag.pickUp(torn, gripCenter());
    await tick();
    morphFrom(el, torn.from, '8px');
  }

  /** Where the grip is in the pill's own box. */
  function gripCenter(): { x: number; y: number } {
    if (!el || !gripEl) return { x: 0, y: 0 };
    const pill = el.getBoundingClientRect();
    const grip = gripEl.getBoundingClientRect();
    return {
      x: grip.left - pill.left + grip.width / 2,
      y: grip.top - pill.top + grip.height / 2,
    };
  }

  onDestroy(() => drag.teardown());
</script>

{#if visible}
  <div
    bind:this={el}
    use:portal
    class="fbp themed no-edge-gesture"
    class:dragging={$drag.dragging}
    class:docking
    style="left: {$drag.left}px; top: {$drag.top}px; visibility: {$drag.ready ? 'visible' : 'hidden'};"
    role="region"
    aria-label="Read Aloud"
    on:pointerdown={drag.start}
  >
    <div class="row top">
      <span class="grip" bind:this={gripEl} aria-hidden="true">
        <DotsSixVertical size="1em" weight="bold" />
      </span>
      <span class="ref">{reference}</span>
      {#if $readingVerseList.length > 0}
        <select
          class="picker"
          value={$readingPosition?.verse ?? $readingVerseList[0]}
          on:change={(e) => jumpToVerse(parseInt(e.currentTarget.value, 10))}
          title="Jump to a verse"
          aria-label="Jump to a verse"
        >
          {#each $readingVerseList as verse}
            <option value={verse}>v. {verse}</option>
          {/each}
        </select>
      {/if}
    </div>

    <div class="row controls">
      <div class="side left">
        <button class="btn" on:click={stopReading} aria-label="Stop reading" title="Stop reading">
          <Stop size="1em" weight="fill" />
        </button>
        <button class="btn" on:click={() => stepVerse(-1)} aria-label="Back a verse" title="Back a verse">
          <SkipBack size="1em" weight="fill" />
        </button>
      </div>

      <button
        class="btn play"
        on:click={togglePlayPause}
        disabled={$readingState === 'starting'}
        aria-label={$readingState === 'playing' ? 'Pause reading' : 'Resume reading'}
        title={$readingState === 'playing' ? 'Pause reading' : 'Resume reading'}
      >
        {#if $isPreparing}
          <BrandSpinner size={18} />
        {:else if $readingState === 'playing'}
          <Pause size="1em" weight="fill" />
        {:else}
          <Play size="1em" weight="fill" />
        {/if}
      </button>

      <div class="side right">
        <button class="btn" on:click={() => stepVerse(1)} aria-label="Forward a verse" title="Forward a verse">
          <SkipForward size="1em" weight="fill" />
        </button>
        <button
          class="btn"
          class:on={$continuousPlay}
          on:click={() => continuousPlay.update((v) => !v)}
          aria-label="Toggle auto-advance"
          title={$continuousPlay ? 'Auto-advance: on (click to turn off)' : 'Auto-advance to next chapter'}
        >
          <ArrowFatLinesRight size="1em" weight="bold" />
        </button>
        <select
          class="picker sleep"
          class:on={sleepArmed}
          bind:value={sleepChoice}
          on:change={applySleepChoice}
          title={sleepArmed ? 'Sleep timer running — fades out and stops' : 'Sleep timer'}
          aria-label="Sleep timer"
        >
          {#if sleepArmed}
            <option value="keep">{sleepLabel}</option>
          {/if}
          <option value="0">{sleepArmed ? 'Off' : '⏱'}</option>
          <option value="10">10 min</option>
          <option value="20">20 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
          <option value="chapter">End of chapter</option>
        </select>
      </div>
    </div>

    <span class="progress" style="transform: scaleX({progress});" aria-hidden="true"></span>
  </div>
{/if}

<style>
  /* Matches the Comms pill (FloatingTtsPlayer.svelte), one row taller. */
  .fbp {
    --s: var(--bar-scale, 1);
    position: fixed;
    /* Over the devotional overlay and popovers, under notices and questions. */
    z-index: 10055;
    display: flex;
    flex-direction: column;
    gap: calc(1px * var(--s));
    max-width: min(calc(100vw - 16px), calc(340px * var(--s)));
    padding: calc(4px * var(--s)) calc(8px * var(--s)) calc(5px * var(--s));
    overflow: hidden;
    background: var(--reader-bg, #1c1c1e);
    color: var(--reader-text, rgba(255, 255, 255, 0.92));
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: calc(22px * var(--s));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    font-size: calc(16px * var(--s));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }

  .fbp.dragging {
    cursor: grabbing;
  }

  /* On its way into the bar: nothing on it can be pressed any more. */
  .fbp.docking {
    pointer-events: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: calc(2px * var(--s));
  }

  .top {
    padding: 0 calc(4px * var(--s)) 0 calc(2px * var(--s));
  }

  .grip {
    display: flex;
    flex-shrink: 0;
    padding: calc(2px * var(--s));
    font-size: 0.85em;
    opacity: 0.4;
  }

  .ref {
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

  /* Play sits in the middle whatever the two sides hold. */
  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
  }

  .side {
    display: flex;
    align-items: center;
    gap: calc(2px * var(--s));
  }

  .side.left {
    justify-self: end;
  }

  .side.right {
    justify-self: start;
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

  .btn.on {
    color: #e6b84a;
  }

  .btn:disabled {
    cursor: default;
  }

  .picker {
    flex-shrink: 0;
    max-width: 9ch;
    padding: calc(2px * var(--s)) calc(4px * var(--s));
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: calc(6px * var(--s));
    color: inherit;
    font-size: 0.72em;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .picker:hover {
    border-color: rgba(127, 127, 127, 0.7);
  }

  .picker.sleep {
    margin-left: calc(2px * var(--s));
    opacity: 0.75;
  }

  .picker.sleep.on {
    opacity: 1;
    color: #e6b84a;
    border-color: rgba(230, 184, 74, 0.55);
  }

  /* How far through the chapter, as a hairline along the bottom edge. */
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
