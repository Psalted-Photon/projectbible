<script lang="ts">
  /**
   * Sword Drill, the one timed game: a phrase from any saved verse appears and the
   * user says the next 3 words. Right answers add seconds and misses take them
   * away (lib/byHeart/drill.ts). Same full-screen rules as a game: only the red X,
   * the VC button and its own controls show, Read Aloud waits, and it closes by X
   * or Escape.
   *
   * The clock only runs while the mic is listening, so holding the button down to
   * speak is as fair as leaving it on.
   */
  import { onDestroy, onMount } from 'svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
  import { DRILL_CLOCK, canDrill, drillPrompt, type DrillPrompt } from '../../lib/byHeart/drill';
  import { closeGame, gamePrefs, setGamePrefs } from '../../lib/byHeart/game';
  import { createGameMic } from '../../lib/byHeart/gameMic';
  import { Recitation } from '../../lib/byHeart/recitation';
  import { upcomingWords } from '../../lib/byHeart/wordMatch';
  import { translationLabel } from '../../lib/bibleData';
  import { portal } from '../../lib/portal';
  import { pauseReading, readingState } from '../../lib/tts/readingEngine';
  import { gameTalk, micReadyToListen, setGameMic, voiceCard, watchVoiceReady } from '../../lib/voice/holdToTalk';
  import CloseX from '../CloseX.svelte';

  /** How many spoken wrong words on one word make a miss. */
  const WRONG_WORDS = 2;
  /** How long the answer stays up before the next phrase. */
  const ANSWER_MS = 1100;
  const TICK_MS = 100;
  /** Under this the clock turns red. */
  const LOW_SECONDS = 10;

  let verses: DBByHeartVerse[] = [];
  let phase: 'loading' | 'none' | 'ready' | 'playing' | 'over' = 'loading';
  let prompt: DrillPrompt | null = null;
  let rec: Recitation | null = null;
  let cursor = 0;
  let clock = DRILL_CLOCK.start;
  let right = 0;
  let best = gamePrefs().drillBest;
  let newBest = false;
  /** The answer up between phrases, and whether it was got. */
  let answered: 'right' | 'miss' | null = null;
  let answerTimer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let lastTick = 0;

  // Audio stays paused for as long as the game is up, a timer or alarm starting
  // it in the meantime included.
  $: if ($readingState === 'playing') pauseReading();

  const mic = createGameMic({
    keywords: () => (rec ? upcomingWords(rec.words, rec.cursor, 3) : null),
    progress: () => rec?.mark ?? 0,
    onTake: () => rec?.newTake(),
    onUpdate: (u) => {
      if (phase !== 'playing' || answered || !rec) return;
      rec.update(u);
      cursor = rec.cursor;
      if (rec.done) answer('right');
      else if (rec.wrongNow.filter((w) => mic.wasSpoken(w)).length >= WRONG_WORDS) answer('miss');
    },
  });

  function nextPrompt() {
    answered = null;
    prompt = drillPrompt(verses, prompt?.verseId ?? null);
    // Carries on with the mic open, and what was heard before this phrase doesn't count.
    rec = prompt ? new Recitation(prompt.answer, {}, rec ?? undefined) : null;
    cursor = 0;
  }

  function answer(how: 'right' | 'miss') {
    answered = how;
    cursor = rec?.words.length ?? 0;
    if (how === 'right') {
      right += 1;
      clock += DRILL_CLOCK.right;
    } else {
      clock -= DRILL_CLOCK.miss;
    }
    if (clock <= 0) {
      finish();
      return;
    }
    answerTimer = setTimeout(() => {
      answerTimer = null;
      nextPrompt();
    }, ANSWER_MS);
  }

  function tick() {
    const now = performance.now();
    const passed = (now - lastTick) / 1000;
    lastTick = now;
    if (phase !== 'playing' || answered || !$gameTalk?.on || $gameTalk.starting) return;
    clock -= passed;
    if (clock <= 0) finish();
  }

  function start() {
    if (!micReadyToListen(start)) return;
    right = 0;
    newBest = false;
    clock = DRILL_CLOCK.start;
    rec = null;
    phase = 'playing';
    nextPrompt();
    mic.open();
    lastTick = performance.now();
    ticker ??= setInterval(tick, TICK_MS);
  }

  function stopClock() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (answerTimer) clearTimeout(answerTimer);
    answerTimer = null;
  }

  function finish() {
    clock = 0;
    stopClock();
    mic.close();
    phase = 'over';
    if (right > best) {
      best = right;
      newBest = true;
      setGamePrefs({ drillBest: right });
    }
  }

  function close() {
    closeGame();
  }

  function onKey(e: KeyboardEvent) {
    // The card a press opened closes first.
    if (e.key !== 'Escape' || e.defaultPrevented || $voiceCard) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') mic.close();
  }

  onMount(async () => {
    setGameMic(mic);
    watchVoiceReady();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', mic.close);
    verses = await syncedByHeartStore.list();
    phase = canDrill(verses) ? 'ready' : 'none';
  });

  onDestroy(() => {
    stopClock();
    mic.dispose();
    setGameMic(null);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', mic.close);
  });

  $: isNet = prompt?.translation.toLowerCase() === 'net';
</script>

<svelte:window on:keydown|capture={onKey} />

<div class="bh-drill no-edge-gesture" use:portal>
  <div class="top">
    {#if phase === 'playing'}
      <span class="clock" class:low={clock < LOW_SECONDS}>{Math.ceil(clock)}</span>
      <span class="count">{right} right</span>
    {:else}
      <span class="title">Sword Drill</span>
    {/if}
    <CloseX label="Close Sword Drill" on:click={close} />
  </div>

  <div class="middle">
    {#if phase === 'none'}
      <p class="say">Sword Drill needs a saved verse of at least 6 words in English.</p>
    {:else if phase === 'ready'}
      <p class="say">
        A phrase from one of your verses appears. Say the next 3 words. A right answer adds {DRILL_CLOCK.right} seconds
        and a miss takes away {DRILL_CLOCK.miss}.
      </p>
      {#if best}<p class="say small">Your best is {best} right.</p>{/if}
      <button class="go" on:click={start}>Start</button>
    {:else if phase === 'playing' && prompt}
      <p class="phrase">… {prompt.phrase}</p>
      <p class="blanks" class:got={answered === 'right'} class:lost={answered === 'miss'}>
        {#each prompt.answer as word, i}
          <span class="blank">{i < cursor ? word : ' '}</span>
        {/each}
      </p>
      <p class="reference">
        {prompt.reference}
        {#if isNet}
          <a href="http://netbible.org" target="_blank" rel="noopener noreferrer">({translationLabel(prompt.translation)})</a>
        {:else}
          ({translationLabel(prompt.translation)})
        {/if}
      </p>
      {#if !answered}
        <button class="skip" on:click={() => answer('miss')}>Skip</button>
      {/if}
      {#if !$gameTalk?.on}
        <p class="say small">The clock waits until the mic is on.</p>
      {/if}
    {:else if phase === 'over'}
      <p class="total">{right} right</p>
      <p class="say small">{newBest ? 'That is your new best.' : `Your best is ${best} right.`}</p>
      <div class="row">
        <button class="go" on:click={start}>Again</button>
        <button class="skip" on:click={close}>Done</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .bh-drill {
    position: fixed;
    inset: 0;
    /* The same place as a game: the VC button, notices and its cards stay above. */
    z-index: 10045;
    display: flex;
    flex-direction: column;
    background: #0c0c0e;
    color: #f0f0f0;
    font-size: calc(15px * var(--bar-scale, 1));
    overscroll-behavior: contain;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    padding: calc(env(safe-area-inset-top, 0px) + 4px * var(--bar-scale, 1)) calc(6px * var(--bar-scale, 1)) calc(4px * var(--bar-scale, 1)) calc(14px * var(--bar-scale, 1));
  }

  .top :global(button:last-child) {
    margin-left: auto;
  }

  .title {
    font-weight: 600;
  }

  .clock {
    min-width: 2ch;
    font-size: 1.8em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .clock.low {
    color: #ef4444;
  }

  .count {
    opacity: 0.85;
  }

  .middle {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    min-height: 0;
    padding: 16px 20px calc(env(safe-area-inset-bottom, 0px) + 72px);
    box-sizing: border-box;
    text-align: center;
  }

  .say {
    max-width: 30em;
    margin: 0;
    line-height: 1.5;
  }

  .say.small {
    font-size: 0.85em;
    opacity: 0.8;
  }

  .phrase {
    max-width: 24em;
    margin: 0;
    font-size: 1.5em;
    line-height: 1.4;
  }

  .blanks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: 0;
    font-size: 1.5em;
  }

  .blank {
    min-width: 4em;
    padding-bottom: 2px;
    border-bottom: 2px solid rgba(255, 255, 255, 0.5);
    font-weight: 600;
  }

  .blanks.got .blank {
    border-color: #22c55e;
    color: #4ade80;
  }

  .blanks.lost .blank {
    border-color: #ef4444;
    color: #fca5a5;
  }

  .reference {
    margin: 0;
    font-size: 0.85em;
    opacity: 0.75;
  }

  .reference a {
    color: inherit;
  }

  .total {
    margin: 0;
    font-size: 2.4em;
    font-weight: 700;
  }

  .row {
    display: flex;
    gap: 10px;
  }

  .go,
  .skip {
    padding: 10px 26px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .go {
    border-color: #f472b6;
    background: #f472b6;
    color: #111;
  }
</style>
