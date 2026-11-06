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
   *
   * Every phrase is kept as it goes. The end screen shows them as tiles, word by
   * word, and the finished run rides on the session so it survives unfolding.
   */
  import { onDestroy, onMount } from 'svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
  import {
    DRILL_CLOCK,
    canDrill,
    drillDateLabel,
    drillLine,
    drillPercent,
    drillPrompt,
    rankDrillScore,
    type DrillPrompt,
    type DrillResult,
  } from '../../lib/byHeart/drill';
  import { closeGame, gamePrefs, setDrillRun, setGamePrefs, type GameSession } from '../../lib/byHeart/game';
  import { createGameMic } from '../../lib/byHeart/gameMic';
  import { Recitation } from '../../lib/byHeart/recitation';
  import { scoreColor } from '../../lib/byHeart/scoring';
  import { upcomingWords } from '../../lib/byHeart/wordMatch';
  import { getBookColor, translationLabel } from '../../lib/bibleData';
  import { portal } from '../../lib/portal';
  import { localDateStr } from '../../stores/clockStore';
  import { pauseReading, readingState } from '../../lib/tts/readingEngine';
  import { gameTalk, micReadyToListen, setGameMic, voiceCard, watchVoiceReady } from '../../lib/voice/holdToTalk';
  import CloseX from '../CloseX.svelte';

  export let session: GameSession;

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
  let top = gamePrefs().drillTop;
  /** The phrases so far this run, in the order played. */
  let played: DrillResult[] = [];
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
      if (phase !== 'playing' || !rec) return;
      // While the answer is up, what is heard is still kept, so the next phrase starts after it.
      if (answered) {
        rec.keep(u);
        return;
      }
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

  /** Keeps the phrase on screen with how far the user got. Called before the answer is revealed. */
  function record(cutOff: boolean) {
    if (prompt) played = [...played, { ...prompt, said: rec?.cursor ?? 0, cutOff }];
  }

  function answer(how: 'right' | 'miss') {
    record(false);
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
    setDrillRun(undefined);
    played = [];
    right = 0;
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
    // A miss can take the last seconds, and that phrase is already kept.
    if (!answered) record(true);
    const percent = drillPercent(played);
    const before = gamePrefs().drillTop;
    const ranked = rankDrillScore(before, { right, percent: percent ?? undefined, date: localDateStr(new Date()) });
    if (ranked.place !== null) setGamePrefs({ drillTop: ranked.top });
    top = ranked.top;
    setDrillRun({
      results: played,
      right,
      percent,
      line: drillLine(before[0]?.right ?? 0, right, ranked.place),
      place: ranked.place,
    });
    phase = 'over';
  }

  const wordState = (result: DrillResult, i: number) =>
    i < result.said ? 'word-said' : result.cutOff ? 'word-unreached' : 'word-lost';

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
    phase = session.drillRun ? 'over' : canDrill(verses) ? 'ready' : 'none';
  });

  onDestroy(() => {
    stopClock();
    mic.dispose();
    setGameMic(null);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', mic.close);
  });

  $: run = session.drillRun ?? null;
</script>

<svelte:window on:keydown|capture={onKey} />

{#snippet translationTag(translation: string)}
  {#if translation.toLowerCase() === 'net'}
    <a href="http://netbible.org" target="_blank" rel="noopener noreferrer">({translationLabel(translation)})</a>
  {:else}
    ({translationLabel(translation)})
  {/if}
{/snippet}

{#snippet topScores(mine: number | null)}
  <div class="top-scores">
    <p class="top-title">Top scores</p>
    <ol>
      {#each top as score, i}
        <li class:mine={i === mine}>
          <span class="place">{i + 1}</span>
          <span class="right">{score.right} right</span>
          <span class="percent" style:color={score.percent === undefined ? null : scoreColor(score.percent)}>
            {score.percent === undefined ? '' : `${score.percent}%`}
          </span>
          <span class="date">{score.date ? drillDateLabel(score.date) : ''}</span>
        </li>
      {/each}
    </ol>
  </div>
{/snippet}

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

  {#if phase === 'over' && run}
    <div class="head">
      <p class="total">
        {run.right} right
        {#if run.percent !== null}
          <span class="run-percent" style:color={scoreColor(run.percent)}>{run.percent}%</span>
        {/if}
      </p>
      {#if run.line}<p class="say small">{run.line}</p>{/if}
      <div class="row">
        <button class="go" on:click={start}>Again</button>
        <button class="skip" on:click={close}>Done</button>
      </div>
    </div>
    <div class="scorecard">
      <div class="tiles">
        {#each run.results as result}
          <div class="tile">
            <p class="tile-words">… {result.phrase}{#each result.answer as word, i}{' '}<span class={wordState(result, i)}>{word}</span>{/each}</p>
            <p class="tile-reference">
              <span class="tile-book" style:color={getBookColor(result.book)}>{result.reference}</span>
              <span class="tile-translation">{@render translationTag(result.translation)}</span>
            </p>
          </div>
        {/each}
      </div>
      {#if top.length}{@render topScores(run.place)}{/if}
    </div>
  {:else}
    <div class="middle">
      {#if phase === 'none'}
        <p class="say">Sword Drill needs a saved verse of at least 6 words in English.</p>
      {:else if phase === 'ready'}
        <p class="say">
          A phrase from one of your verses appears. Say the next 3 words. A right answer adds {DRILL_CLOCK.right} seconds
          and a miss takes away {DRILL_CLOCK.miss}.
        </p>
        {#if top.length}{@render topScores(null)}{/if}
        <button class="go" on:click={start}>Start</button>
      {:else if phase === 'playing' && prompt}
        <p class="phrase">… {prompt.phrase}</p>
        <p class="blanks" class:got={answered === 'right'} class:lost={answered === 'miss'}>
          {#each prompt.answer as word, i}
            <span class="blank">{i < cursor ? word : ' '}</span>
          {/each}
        </p>
        <p class="reference">
          {prompt.reference}
          {@render translationTag(prompt.translation)}
        </p>
        {#if !answered}
          <button class="skip" on:click={() => answer('miss')}>Skip</button>
        {/if}
        {#if !$gameTalk?.on}
          <p class="say small">The clock waits until the mic is on.</p>
        {/if}
      {/if}
    </div>
  {/if}
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
    --word-got: #4ade80;
    --word-lost: #f87171;
    --mine: #f472b6;
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
    gap: 14px;
    min-height: 0;
    padding: 16px 20px calc(env(safe-area-inset-bottom, 0px) + 72px);
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    text-align: center;
  }

  /* Centers what fits, and what doesn't can still scroll to its top. */
  .middle::before,
  .middle::after {
    content: '';
    flex: 1;
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
    color: var(--word-got);
  }

  .blanks.lost .blank {
    border-color: #ef4444;
    color: var(--word-lost);
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
    line-height: 1.2;
  }

  .run-percent {
    margin-left: 0.25em;
  }

  /* The end screen: the score stays put and everything under it scrolls. */
  .head {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 4px 16px 12px;
    text-align: center;
  }

  .scorecard {
    flex: 1;
    min-height: 0;
    padding: 0 12px calc(env(safe-area-inset-bottom, 0px) + 72px);
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* Two columns on a folded phone's cover screen, more as the screen widens. */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .tile {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: #1a1a1f;
    font-size: 0.85em;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .tile-words {
    margin: 0;
    color: #fff;
  }

  .word-said,
  .word-lost {
    font-weight: 600;
  }

  .word-said {
    color: var(--word-got);
  }

  .word-lost {
    color: var(--word-lost);
  }

  .word-unreached {
    color: #8e8e96;
  }

  .tile-reference {
    margin: 0;
    font-size: 0.85em;
  }

  .tile-book {
    font-weight: 600;
  }

  .tile-translation {
    opacity: 0.7;
  }

  .tile-translation a {
    color: inherit;
  }

  .top-scores {
    width: 100%;
    max-width: 22em;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .scorecard .top-scores {
    margin-top: 20px;
  }

  .top-title {
    margin: 0 0 6px;
    font-size: 0.85em;
    font-weight: 600;
    text-align: center;
    opacity: 0.8;
  }

  .top-scores ol {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }

  .top-scores li {
    display: grid;
    grid-template-columns: 1.6em 1fr 3em 6.5em;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    text-align: left;
  }

  .top-scores li.mine {
    background: rgba(244, 114, 182, 0.16);
    color: var(--mine);
    font-weight: 600;
  }

  .place {
    opacity: 0.6;
  }

  .top-scores .percent {
    font-weight: 700;
    text-align: right;
  }

  .date {
    opacity: 0.7;
    text-align: right;
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
