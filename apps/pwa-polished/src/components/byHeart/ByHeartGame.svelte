<script lang="ts">
  /**
   * A By Heart game: full screen over everything, mounted only while open. Only
   * the red X, the VC button and the game's own controls show. Read Aloud's pills
   * are hidden and its audio paused for as long as it is up.
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
  import { BLUR_RANGE, clearRun, closeGame, gamePrefs, readRun, saveRun, setGamePrefs, type GameCover } from '../../lib/byHeart/game';
  import { createGameMic } from '../../lib/byHeart/gameMic';
  import { cardContentOf, drawableStyle, referenceOf, savedCardOf, type SavedCard } from '../../lib/byHeart/verse';
  import { portal } from '../../lib/portal';
  import { cardWords, type CardImage, type CardStyle } from '../../lib/shareCard';
  import { pauseReading, readingState } from '../../lib/tts/readingEngine';
  import { setGameMic, voiceCard, watchVoiceReady } from '../../lib/voice/holdToTalk';
  import CloseX from '../CloseX.svelte';
  import ByHeartCard from './ByHeartCard.svelte';

  export let verseId: string;

  let verse: DBByHeartVerse | null = null;
  let card: SavedCard | null = null;
  let style: CardStyle | null = null;
  let image: CardImage | null = null;

  /** How many words are done. */
  let cursor = 0;
  let total = 0;
  $: finished = total > 0 && cursor >= total;

  const prefs = gamePrefs();
  let blur = prefs.blur;
  let cover: GameCover = prefs.cover;
  let controlsOpen = false;

  const mic = createGameMic();

  // Audio stays paused for as long as the game is up, a timer or alarm starting
  // it in the meantime included.
  $: if ($readingState === 'playing') pauseReading();

  // ── Words ──────────────────────────────────────────────────────────────────

  /** One more word done. For now a tap on the word you're on is what passes it. */
  function advance() {
    if (finished) return;
    cursor += 1;
    saveRun({ verseId, cursor });
    if (cursor >= total) {
      mic.close();
      clearRun();
    }
  }

  function startOver() {
    cursor = 0;
    controlsOpen = false;
    clearRun();
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  function setCover(next: GameCover) {
    cover = next;
    setGamePrefs({ blur, cover });
  }

  function keepBlur() {
    setGamePrefs({ blur, cover });
  }

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

  onMount(async () => {
    setGameMic(mic);
    watchVoiceReady();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', mic.close);

    const got = await syncedByHeartStore.get(verseId);
    if (!got) {
      // Removed since it was opened, on another device or before a relaunch.
      clearRun();
      close();
      return;
    }
    const saved = savedCardOf(got);
    const picture = await cardImageOf(got);
    total = cardWords(got.passage).length;
    const place = readRun(verseId)?.cursor ?? 0;
    cursor = place < total ? place : 0;
    card = saved;
    image = picture;
    style = drawableStyle(saved, !!picture);
    verse = got;
  });

  onDestroy(() => {
    mic.close();
    setGameMic(null);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', mic.close);
  });
</script>

<svelte:window on:keydown|capture={onKey} />

<div class="bh-game no-edge-gesture" use:portal>
  {#if verse && card && style}
    <ByHeartCard
      content={cardContentOf(verse)}
      {style}
      emphasis={card.emphasis}
      {image}
      qrUrl={qrUrlOf(verse)}
      {cover}
      {blur}
      revealed={cursor}
      onTapWord={(i) => {
        if (i === cursor) advance();
      }}
    />
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
      <div class="chips">
        <button class="chip" class:on={cover === 'wordblur'} on:click={() => setCover('wordblur')}>Word blur</button>
        <button class="chip" class:on={cover === 'box'} on:click={() => setCover('box')}>Black box</button>
        {#if cursor > 0}
          <button class="chip" on:click={startOver}>Start over</button>
        {/if}
      </div>
    </div>
  {/if}

  {#if finished}
    <div class="end">
      <button class="end-btn" on:click={startOver}>Again</button>
      <button class="end-btn main" on:click={close}>Done</button>
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

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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

  .end {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
    display: flex;
    gap: 10px;
    transform: translateX(-50%);
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
