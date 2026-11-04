<script lang="ts">
  /**
   * A By Heart game: full screen over everything, mounted only while open. Only
   * the red X, the VC button and the game's own controls show. Read Aloud's pills
   * are hidden and its audio paused for as long as it is up.
   *
   * The words are said out loud with the VC button's mic open, and only the word
   * the user is on is checked (lib/byHeart/recitation.ts). A word it won't take
   * can be tapped: Show me is a brief peek and counts as a hint, and I said it
   * counts as right and teaches the verse that mishearing.
   *
   * Closes by X or Escape only. Never `themed`: the theme's invert would turn the
   * card's colors into their opposites.
   *
   * The place is saved after every word (lib/byHeart/game.ts), so Back to Android
   * or a fold's relaunch loses nothing.
   */
  import { onDestroy, onMount } from 'svelte';
  import { SlidersHorizontal } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
  import { cardImageOf, qrUrlOf } from '../../lib/byHeart/cardThumb';
  import {
    BLUR_LINE,
    BLUR_RANGE,
    byHeartGame,
    clearRun,
    closeGame,
    gamePrefs,
    readRun,
    saveRun,
    setGamePrefs,
    type GameCover,
    type GameSession,
    type SpokenRefMode,
  } from '../../lib/byHeart/game';
  import { createGameMic } from '../../lib/byHeart/gameMic';
  import { Recitation } from '../../lib/byHeart/recitation';
  import { roundsFor, type Round } from '../../lib/byHeart/rounds';
  import { scoreColor, scoreOf } from '../../lib/byHeart/scoring';
  import type { RefTarget } from '../../lib/byHeart/spokenRef';
  import { cardContentOf, drawableStyle, referenceOf, savedCardOf, type SavedCard } from '../../lib/byHeart/verse';
  import { plainWord, upcomingWords } from '../../lib/byHeart/wordMatch';
  import { portal } from '../../lib/portal';
  import { cardWords, type CardImage, type CardStyle } from '../../lib/shareCard';
  import { pauseReading, readingState } from '../../lib/tts/readingEngine';
  import { gameTalk, setGameMic, voiceCard, watchVoiceReady } from '../../lib/voice/holdToTalk';
  import CloseX from '../CloseX.svelte';
  import ByHeartCard from './ByHeartCard.svelte';

  export let session: GameSession;

  /** How many upcoming words the recognizer is told to favor. */
  const FAVOR = 3;
  /** How long a wrong word has to stand before it is shown, as a guess changing can flash one. */
  const STUCK_BEAT_MS = 1200;
  /** How long Show me leaves a word clear. */
  const PEEK_MS = 1500;

  const steps = session.steps;
  let at = session.at;
  $: step = steps[at];

  let verse: DBByHeartVerse | null = null;
  let card: SavedCard | null = null;
  let style: CardStyle | null = null;
  let image: CardImage | null = null;
  let words: string[] = [];

  let phase: 'loading' | 'playing' | 'results' = 'loading';
  let round: Round | null = null;
  let rec: Recitation | null = null;

  // What the screen shows of the recitation, copied out of it after every reply.
  let cursor = 0;
  let refStart = false;
  let refEnd = false;
  $: onReference = refStart || (refEnd && round !== null && round.from + cursor >= round.to);
  $: revealed = !round || phase === 'results' ? words.length : round.from + cursor;
  $: shown = new Set(round?.shown ?? []);
  $: coverReference = phase === 'playing' && (refStart || refEnd);

  /** What took a hint, as positions in the verse, the two references after the words. */
  let hints = new Set<number>();
  /** Which of those were asked for with Show me. */
  let shownMe = new Set<number>();
  let score: number | null = null;

  const prefs = gamePrefs();
  let blur = prefs.blur;
  let cover: GameCover = prefs.cover;
  let reference: SpokenRefMode = prefs.reference;
  let controlsOpen = false;

  $: readable = cover === 'wordblur' && blur < BLUR_LINE;

  // Audio stays paused for as long as the game is up, a timer or alarm starting
  // it in the meantime included.
  $: if ($readingState === 'playing') pauseReading();

  // ── Hearing ────────────────────────────────────────────────────────────────

  const mic = createGameMic({
    keywords: () => {
      if (!rec) return null;
      return rec.onReference ? (verse?.book ?? null) : upcomingWords(rec.words, rec.cursor, FAVOR);
    },
    progress: () => rec?.mark ?? 0,
    onTake: () => rec?.newTake(),
    onUpdate: (u) => {
      if (phase !== 'playing' || !rec) return;
      rec.update(u);
      sync();
    },
  });

  const refStartAt = () => words.length;
  const refEndAt = () => words.length + 1;

  /** Bring the screen up to where the recitation is. */
  function sync() {
    const r = rec;
    if (!r || !round) return;
    const moved = r.cursor !== cursor || r.refStart !== refStart || r.refEnd !== refEnd;
    if (moved) {
      // A word said while it could be read is a hint, whichever word it is.
      if (readable) {
        for (let i = cursor; i < r.cursor; i++) hints.add(round.from + i);
        if (refStart && !r.refStart) hints.add(refStartAt());
        if (refEnd && !r.refEnd) hints.add(refEndAt());
      }
      cursor = r.cursor;
      refStart = r.refStart;
      refEnd = r.refEnd;
      clearStuck();
      helpOpen = false;
      savePlace();
    }
    watchStuck(r);
    if (r.done) finishRound();
  }

  function savePlace() {
    if (!verse) return;
    saveRun({
      verseId: verse.id,
      mode: step.mode,
      cursor,
      refStart,
      refEnd,
      hints: [...hints],
      shownMe: [...shownMe],
    });
  }

  // ── A word it won't take ───────────────────────────────────────────────────

  /** What it heard instead, once that has stood for a beat and someone really said it. */
  let stuck = '';
  let stuckWord = '';
  let stuckTimer: ReturnType<typeof setTimeout> | null = null;
  let helpOpen = false;
  let peek: number | 'reference' | null = null;
  let peekTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStuck() {
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = null;
    stuck = '';
    stuckWord = '';
  }

  function watchStuck(r: Recitation) {
    const spoken = r.wrongNow.filter((w) => mic.wasSpoken(w));
    if (!spoken.length) return;
    const text = r.onReference
      ? spoken.slice(-4).map((w) => w.word.trim()).join(' ')
      : spoken[spoken.length - 1].word.trim();
    if (text === stuckWord) return;
    stuckWord = text;
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      stuckTimer = null;
      stuck = text;
    }, STUCK_BEAT_MS);
  }

  function tapWord(i: number) {
    if (phase !== 'playing' || !round || onReference) return;
    if (i === round.from + cursor) helpOpen = !helpOpen;
  }

  function tapReference() {
    if (phase === 'playing' && onReference) helpOpen = !helpOpen;
  }

  function showMe() {
    if (!round) return;
    const item = refStart ? refStartAt() : onReference ? refEndAt() : round.from + cursor;
    hints.add(item);
    shownMe.add(item);
    helpOpen = false;
    savePlace();
    peek = onReference ? 'reference' : item;
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      peekTimer = null;
      peek = null;
    }, PEEK_MS);
  }

  function iSaidIt() {
    const r = rec;
    if (!r || !round) return;
    helpOpen = false;
    if (!r.onReference && stuck) remember(r.words[r.cursor], stuck);
    r.tap();
    sync();
  }

  /** The verse accepts this from now on, here and on any device. */
  function remember(word: string, heard: string) {
    const v = verse;
    const on = plainWord(word);
    const as = plainWord(heard);
    if (!v || !on || !as || !rec) return;
    rec.alsoAccept(word, heard);
    const progress = v.progress as { heardAs?: Record<string, string[]> };
    const heardAs = { ...progress.heardAs, [on]: [...(progress.heardAs?.[on] ?? []), as] };
    verse = { ...v, progress: { ...v.progress, heardAs } };
    void syncedByHeartStore.update(v.id, { progress: verse.progress });
  }

  // ── The round ──────────────────────────────────────────────────────────────

  function refTargetOf(v: DBByHeartVerse): RefTarget {
    return { book: v.book, chapter: v.chapter, startVerse: v.startVerse, several: v.endVerse > v.startVerse };
  }

  function startRound(r: Round, place: { cursor: number; refStart: boolean; refEnd: boolean } | null) {
    round = r;
    const v = verse!;
    rec = new Recitation(
      words.slice(r.from, r.to),
      {
        cursor: place?.cursor ?? 0,
        ref: refTargetOf(v),
        refStart: place ? place.refStart : r.refStart,
        refEnd: place ? place.refEnd : r.refEnd,
        alsoAs: { ...(v.progress as { heardAs?: Record<string, string[]> }).heardAs },
      },
      place ? undefined : rec ?? undefined,
    );
    cursor = rec.cursor;
    refStart = rec.refStart;
    refEnd = rec.refEnd;
    clearStuck();
    helpOpen = false;
    phase = 'playing';
    // Nothing left to say: a saved place at the very end, or a card with no words.
    if (rec.done) finishRound();
  }

  function finishRound() {
    if (phase !== 'playing') return;
    phase = 'results';
    mic.close();
    clearRun();
    void finishStep();
  }

  /** What there was to say in this game, for the score. */
  function itemsToSay(): number {
    if (!round) return 0;
    const said = words.slice(round.from, round.to).filter((w) => plainWord(w)).length;
    return said + (round.refStart ? 1 : 0) + (round.refEnd ? 1 : 0);
  }

  async function finishStep() {
    const v = verse;
    if (!v) return;
    score = scoreOf(itemsToSay(), hints.size);
    await syncedByHeartStore.update(v.id, { score });
  }

  function startOver() {
    hints = new Set();
    shownMe = new Set();
    score = null;
    controlsOpen = false;
    clearRun();
    rec = null;
    loadRounds(false);
  }

  function loadRounds(pickUp: boolean) {
    const saved = pickUp && verse ? readRun(verse.id, step.mode) : null;
    const list = roundsFor({ mode: step.mode, count: words.length, reference });
    if (saved) {
      hints = new Set(saved.hints);
      shownMe = new Set(saved.shownMe);
    }
    startRound(
      list[0],
      saved && {
        cursor: Math.min(saved.cursor, list[0].to - list[0].from),
        refStart: saved.refStart,
        refEnd: saved.refEnd,
      },
    );
  }

  async function loadStep() {
    phase = 'loading';
    const got = await syncedByHeartStore.get(step.verseId);
    if (!got) {
      // Removed since it was opened, on another device or before a relaunch.
      clearRun();
      close();
      return;
    }
    const saved = savedCardOf(got);
    const picture = await cardImageOf(got);
    words = cardWords(got.passage);
    card = saved;
    image = picture;
    style = drawableStyle(saved, !!picture);
    verse = got;
    loadRounds(true);
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  function setCover(next: GameCover) {
    cover = next;
    setGamePrefs({ cover });
  }

  function keepBlur() {
    setGamePrefs({ blur });
  }

  function setReference(next: SpokenRefMode) {
    if (next === reference) return;
    reference = next;
    setGamePrefs({ reference });
    // It changes what there is to say, so it starts from the top.
    if (phase === 'playing') startOver();
  }

  const REFERENCE_CHOICES: { value: SpokenRefMode; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'start', label: 'Start' },
    { value: 'end', label: 'End' },
    { value: 'both', label: 'Both' },
  ];

  // ── Leaving ────────────────────────────────────────────────────────────────

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

  onMount(() => {
    setGameMic(mic);
    watchVoiceReady();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', mic.close);
    void loadStep();
  });

  onDestroy(() => {
    mic.dispose();
    setGameMic(null);
    clearStuck();
    if (peekTimer) clearTimeout(peekTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', mic.close);
  });

  // The session on screen is what a relaunch brings back.
  $: byHeartGame.update((s) => (s && s.at !== at ? { ...s, at } : s));
</script>

<svelte:window on:keydown|capture={onKey} />

<div class="bh-game no-edge-gesture" use:portal>
  {#if verse && card && style}
    {#key verse.id}
      <ByHeartCard
        content={cardContentOf(verse)}
        {style}
        emphasis={card.emphasis}
        {image}
        qrUrl={qrUrlOf(verse)}
        {cover}
        {blur}
        {revealed}
        {shown}
        {peek}
        {coverReference}
        onTapWord={tapWord}
        onTapReference={tapReference}
      />
    {/key}
  {/if}

  <div class="top">
    <button
      class="tool"
      aria-label="Game settings"
      aria-expanded={controlsOpen}
      on:click={() => (controlsOpen = !controlsOpen)}
    >
      <SlidersHorizontal size="1.2em" weight="bold" />
    </button>
    <CloseX label={verse ? `Close ${referenceOf(verse)}` : 'Close'} on:click={close} />
  </div>

  {#if controlsOpen}
    <div class="controls">
      <label class="slider">
        <span>Blur</span>
        <input
          type="range"
          min={BLUR_RANGE.min}
          max={BLUR_RANGE.max}
          step="0.01"
          bind:value={blur}
          disabled={cover !== 'wordblur'}
          on:change={keepBlur}
        />
      </label>
      {#if readable}
        <p class="note">Words can be read at this blur, so saying them counts as a hint.</p>
      {/if}
      <div class="chips">
        <button class="chip" class:on={cover === 'wordblur'} on:click={() => setCover('wordblur')}>Word blur</button>
        <button class="chip" class:on={cover === 'box'} on:click={() => setCover('box')}>Black box</button>
      </div>
      <div class="chips">
        <span class="chips-label">Say the reference</span>
        {#each REFERENCE_CHOICES as choice (choice.value)}
          <button class="chip" class:on={reference === choice.value} on:click={() => setReference(choice.value)}>{choice.label}</button>
        {/each}
      </div>
      {#if phase === 'playing' && (cursor > 0 || hints.size > 0)}
        <div class="chips">
          <button class="chip" on:click={startOver}>Start over</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if phase === 'playing'}
    <div class="status" aria-live="polite">
      {#if helpOpen}
        <div class="help">
          {#if stuck}<div class="help-heard">Heard “{stuck}”</div>{/if}
          <button class="end-btn" on:click={showMe}>Show me</button>
          <button class="end-btn" on:click={iSaidIt}>I said it</button>
        </div>
      {:else if stuck}
        <button class="line" on:click={() => (helpOpen = true)}>Heard “{stuck}”</button>
      {:else if onReference}
        <span class="line">Say the reference</span>
      {:else if !$gameTalk?.on && cursor === 0}
        <span class="line">Tap the mic and say it from memory</span>
      {/if}
    </div>
  {/if}

  {#if phase === 'results' && score !== null}
    <div class="end">
      <div class="end-score">
        <span class="score" style="color: {scoreColor(score)}">{score}%</span>
        <span class="score-word">score</span>
      </div>
      <div class="end-row">
        <button class="end-btn" on:click={startOver}>Again</button>
        <button class="end-btn main" on:click={close}>Done</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bh-game {
    position: fixed;
    inset: 0;
    /* Over every window, pane and popup. The VC button, notices and the cards a
       press opens stay above it. */
    z-index: 10045;
    background: #000;
    color: #f0f0f0;
    font-size: calc(15px * var(--bar-scale, 1));
    overscroll-behavior: contain;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .top {
    position: absolute;
    top: env(safe-area-inset-top, 0px);
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(4px * var(--bar-scale, 1)) calc(6px * var(--bar-scale, 1));
    pointer-events: none;
  }

  .top > :global(*) {
    pointer-events: auto;
  }

  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(40px * var(--bar-scale, 1));
    height: calc(40px * var(--bar-scale, 1));
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    color: inherit;
    cursor: pointer;
  }

  .controls {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 48px * var(--bar-scale, 1));
    left: calc(6px * var(--bar-scale, 1));
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(320px, calc(100vw - 12px));
    box-sizing: border-box;
    padding: 12px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.72);
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9em;
  }

  .slider input {
    flex: 1;
    min-width: 0;
    accent-color: #f472b6;
  }

  .note {
    margin: 0;
    font-size: 0.8em;
    line-height: 1.4;
    opacity: 0.85;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .chips-label {
    width: 100%;
    font-size: 0.85em;
    opacity: 0.85;
  }

  .chip {
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
  }

  .chip.on {
    border-color: #f472b6;
    color: #f9a8d4;
  }

  .status {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: calc(100vw - 24px);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .status > * {
    pointer-events: auto;
  }

  .line {
    display: block;
    max-width: 100%;
    overflow: hidden;
    padding: 7px 14px;
    border: none;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.72);
    color: inherit;
    font: inherit;
    font-size: 0.9em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  button.line {
    cursor: pointer;
  }

  .help {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.82);
  }

  .help-heard {
    width: 100%;
    text-align: center;
    font-size: 0.9em;
  }

  .end {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 24px);
    box-sizing: border-box;
    padding: 12px 16px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.82);
    transform: translateX(-50%);
  }

  .end-score {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .score {
    font-size: 1.8em;
    font-weight: 700;
  }

  .score-word {
    font-size: 0.85em;
    opacity: 0.8;
  }

  .end-row {
    display: flex;
    gap: 10px;
  }

  .end-btn {
    padding: 10px 22px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.72);
    color: inherit;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .end-btn.main {
    border-color: #f472b6;
    background: #f472b6;
    color: #111;
  }
</style>
