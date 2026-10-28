<script lang="ts">
  /**
   * The Bible's Read Aloud player, pulled out of the navbar into a pill of its
   * own. The tab under the player in the bar tears it out (NavigationBar); the
   * pill appears under the same finger, changing shape out of the bar's
   * player, and floats from then on — the next reading too — until it is
   * docked back. See lib/tts/playerDock.ts.
   *
   * Two rows: what is being read and the verse to jump to, then every control
   * the bar has. No padding anywhere: each row is only as wide as what it
   * holds, and the outline is drawn around them like a balloon (see The
   * balloon). Dragged by anything that is not a control, in a spot of its own
   * (the Comms pill keeps another). Dark by design and carries `themed`, like
   * the Comms pill, so the themes treat the two alike.
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

  // ── The balloon ────────────────────────────────────────────────────────────
  // There is no box around the rows. Each row is measured, and the outline is
  // drawn around it at its own width: round at the far ends, rounded off where
  // the wider row sticks out past the narrower one, and curving in at the
  // join. A short reference makes the top narrow, a long one makes it the
  // wider of the two, and the sleep timer's label widens the bottom as it runs.
  type Rows = { tw: number; th: number; bw: number; bh: number };
  /** A corner of the outline and how round it is. */
  type Corner = [x: number, y: number, r: number];
  /** How far a cubic's handles reach to draw a quarter circle. */
  const K = 0.5523;

  let rows: Rows = { tw: 0, th: 0, bw: 0, bh: 0 };
  $: outline = balloon(rows);
  /** The bottom row's own stretch of the bottom edge, for the progress line. */
  $: progressLeft = (outline.w - rows.bw) / 2;

  /** Keeps `rows` up to date with one row's size. */
  function sized(node: HTMLElement, which: 'top' | 'bottom') {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      rows = which === 'top' ? { ...rows, tw: width, th: height } : { ...rows, bw: width, bh: height };
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function balloon({ tw, th, bw, bh }: Rows): { w: number; h: number; path: string } {
    const w = Math.max(tw, bw);
    const h = th + bh;
    if (!w || !h) return { w: 0, h: 0, path: '' };
    // Worked out with the narrower row on top, and turned over if it isn't.
    const flip = tw > bw;
    const [nw, nh, wh] = flip ? [bw, bh, th] : [tw, th, bh];
    const step = (w - nw) / 2;
    // Both curves at the step share its width, so a slight one stays smooth.
    const fillet = Math.min(Math.min(nh, wh) * 0.3, step / 2);
    const shoulder = Math.min(wh / 2, step / 2);
    const corners: Corner[] =
      step < 0.5
        ? [[0, 0, nh / 2], [w, 0, nh / 2], [w, h, wh / 2], [0, h, wh / 2]]
        : [
            [step, 0, nh / 2],
            [w - step, 0, nh / 2],
            [w - step, nh, fillet],
            [w, nh, shoulder],
            [w, h, wh / 2],
            [0, h, wh / 2],
            [0, nh, shoulder],
            [step, nh, fillet],
          ];
    // Half a pixel in from the edges, so the 1px line sits inside the box.
    const inset = (v: number, max: number) => Math.min(max - 0.5, Math.max(0.5, v));
    return {
      w,
      h,
      path: roundedPath(corners.map(([x, y, r]) => [inset(x, w), inset(flip ? h - y : y, h), r])),
    };
  }

  /** A closed path through the corners, each rounded off by its own radius. */
  function roundedPath(corners: Corner[]): string {
    const n = corners.length;
    const f = (v: number) => +v.toFixed(2);
    let path = '';
    for (let i = 0; i < n; i++) {
      const [x, y, r] = corners[i];
      const [px, py] = corners[(i + n - 1) % n];
      const [nx, ny] = corners[(i + 1) % n];
      const toPrev = Math.hypot(px - x, py - y);
      const toNext = Math.hypot(nx - x, ny - y);
      const round = Math.min(r, toPrev / 2, toNext / 2);
      const ax = x + ((px - x) / toPrev) * round;
      const ay = y + ((py - y) / toPrev) * round;
      const bx = x + ((nx - x) / toNext) * round;
      const by = y + ((ny - y) / toNext) * round;
      path +=
        `${i ? 'L' : 'M'}${f(ax)},${f(ay)}` +
        `C${f(ax + (x - ax) * K)},${f(ay + (y - ay) * K)} ` +
        `${f(bx + (x - bx) * K)},${f(by + (y - by) * K)} ${f(bx)},${f(by)}`;
    }
    return path + 'Z';
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
    if (!slot) return false;
    void goIn(slot, false);
    return true;
  }

  /**
   * Enter (or Space) on the grip: the slot is shown just for this, and the
   * pill goes into it the same way. The focus follows it to the bar's tab.
   */
  async function onGripKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (docking || $drag.dragging) return;
    docking = true;
    dockDrag.set({ mode: 'dock', bar: homeBar(), near: true });
    await tick();
    await goIn(dockSlotRect(), true);
  }

  async function goIn(slot: DOMRect | null, focusTab: boolean): Promise<void> {
    docking = true;
    if (slot && el) await morphInto(el, slot, '8px');
    setBibleFloating(false);
    dockDrag.set(null);
    docking = false;
    if (!focusTab) return;
    await tick();
    document.querySelector<HTMLElement>('.nav-tts:not(.nav-tts-slot) .tts-nav-tab')?.focus();
  }

  async function show(target: HTMLDivElement): Promise<void> {
    await drag.place(target);
    // Just torn out of the bar: take over the finger, holding the pill by its
    // grip, and change shape out of the player it was a moment ago. Popped out
    // from the keyboard it stays at its own spot, and the grip takes the focus.
    const torn = takeTearOut();
    if (!torn || el !== target || !$drag.ready) return;
    if (torn.pointer) drag.pickUp(torn.pointer, gripCenter());
    await tick();
    morphFrom(el, torn.from, '8px');
    if (!torn.pointer) gripEl?.focus();
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
    <svg class="skin" width={outline.w} height={outline.h} aria-hidden="true">
      <defs>
        <clipPath id="fbp-outline"><path d={outline.path} /></clipPath>
      </defs>
      <path class="fill" d={outline.path} />
      <!-- How far through the chapter, as a hairline along the bottom edge. -->
      <rect
        class="progress"
        x={progressLeft}
        y={outline.h - 2}
        width={rows.bw * progress}
        height="2"
        clip-path="url(#fbp-outline)"
      />
    </svg>

    <div class="row top" use:sized={'top'}>
      <!-- The handle by which it is carried, and for a keyboard the way back
           into the bar. Not a <button>, so it still drags. -->
      <span
        class="grip no-press"
        bind:this={gripEl}
        role="button"
        tabindex="0"
        title="Drag to move the player, or back into the bar"
        aria-label="Put the player back in the bar"
        on:keydown={onGripKeydown}
      >
        <DotsSixVertical size="1em" weight="bold" />
      </span>
      <span class="ref">{reference}</span>
      <!-- Each dropdown shows only what it is set to, with the real one laid
           invisibly over it, so it is as wide as that and not its longest
           choice. -->
      {#if $readingVerseList.length > 0}
        <span class="chip">
          v. {$readingPosition?.verse ?? $readingVerseList[0]}
          <select
            value={$readingPosition?.verse ?? $readingVerseList[0]}
            on:change={(e) => jumpToVerse(parseInt(e.currentTarget.value, 10))}
            title="Jump to a verse"
            aria-label="Jump to a verse"
          >
            {#each $readingVerseList as verse}
              <option value={verse}>v. {verse}</option>
            {/each}
          </select>
        </span>
      {/if}
    </div>

    <div class="row controls" use:sized={'bottom'}>
      <button class="btn" on:click={stopReading} aria-label="Stop reading" title="Stop reading">
        <Stop size="1em" weight="fill" />
      </button>
      <button class="btn" on:click={() => stepVerse(-1)} aria-label="Back a verse" title="Back a verse">
        <SkipBack size="1em" weight="fill" />
      </button>
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
      <span class="chip sleep" class:on={sleepArmed}>
        {sleepLabel}
        <select
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
      </span>
    </div>
  </div>
{/if}

<style>
  /* Colored like the Comms pill (FloatingTtsPlayer.svelte); shaped by its rows. */
  .fbp {
    --s: var(--bar-scale, 1);
    position: fixed;
    /* Over the devotional overlay and popovers, under notices and questions. */
    z-index: 10055;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: min(calc(100vw - 16px), calc(340px * var(--s)));
    color: var(--reader-text, rgba(255, 255, 255, 0.92));
    font-size: calc(16px * var(--s));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    /* Only the rows take presses: the box's corners beside a narrower row are
       outside the balloon. A press on a row still reaches the drag here. */
    pointer-events: none;
  }

  .fbp.dragging {
    cursor: grabbing;
  }

  /* The outline, drawn behind the rows. */
  .skin {
    position: absolute;
    left: 0;
    top: 0;
    z-index: -1;
    overflow: visible;
    pointer-events: none;
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
  }

  .skin .fill {
    fill: var(--reader-bg, #1c1c1e);
    stroke: rgba(127, 127, 127, 0.25);
    stroke-width: 1;
  }

  .skin .progress {
    fill: #e6b84a;
    opacity: 0.7;
  }

  .row {
    display: flex;
    align-items: center;
    max-width: 100%;
    pointer-events: auto;
  }

  /* On its way into the bar: nothing on it can be pressed any more. */
  .fbp.docking .row {
    pointer-events: none;
  }

  .top {
    height: calc(20px * var(--s));
  }

  .controls {
    height: calc(22px * var(--s));
  }

  .grip {
    display: flex;
    flex-shrink: 0;
    border-radius: calc(4px * var(--s));
    font-size: 0.85em;
    opacity: 0.4;
  }

  .grip:focus-visible {
    opacity: 1;
    outline: 1px solid #e6b84a;
    outline-offset: 1px;
  }

  .ref {
    flex: 1 1 auto;
    min-width: 0;
    font-family: 'Milonga', cursive;
    font-size: 0.85em;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: calc(22px * var(--s));
    height: calc(22px * var(--s));
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

  /* Round at the ends, so it sits in the round end of its row. */
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    height: calc(18px * var(--s));
    padding: 0 calc(5px * var(--s));
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 999px;
    font-size: 0.72em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .top .chip {
    margin-left: calc(4px * var(--s));
  }

  .chip:hover {
    border-color: rgba(127, 127, 127, 0.7);
  }

  .chip:has(select:focus-visible) {
    outline: 1px solid #e6b84a;
    outline-offset: 1px;
  }

  .chip select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    opacity: 0;
    appearance: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .chip.sleep {
    opacity: 0.75;
  }

  .chip.sleep.on {
    opacity: 1;
    color: #e6b84a;
    border-color: rgba(230, 184, 74, 0.55);
  }
</style>
