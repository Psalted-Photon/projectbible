<script lang="ts">
  /**
   * Where words become readable. Words the reader can't know come in very
   * blurred and sharpen slowly, and a tap says when they can be read. Done at
   * two text sizes, to see if one number relative to text size holds for both.
   */
  import { onDestroy } from 'svelte';
  import LabCard from './LabCard.svelte';
  import { restoreLastStyle } from '../../../lib/shareCard';
  import { randomWords } from '../../../lib/byHeart/lab/labPassages';
  import { blurLine, labResults, patchResults, type BlurRound, type CoverKind } from '../../../lib/byHeart/lab/labResults';

  /** Three of each size. */
  const ROUNDS: BlurRound['size'][] = ['small', 'large', 'small', 'large', 'small', 'large'];
  const TARGET_PX = { small: 16, large: 32 };
  /** Where it starts, and how fast it sharpens, in blur per second. */
  const START = 0.5;
  const PER_SECOND = 0.03;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const look = restoreLastStyle();

  let cover: CoverKind = 'pill';
  let round = 0;
  let phase: 'idle' | 'sharpening' | 'asking' = 'idle';
  let words = '';
  let blur = START;
  let raf = 0;
  let fontScreen = 0;
  let textSize = 96;
  let revealed = 0;
  let readAt = 0;

  $: size = ROUNDS[round % ROUNDS.length];
  $: style = { ...look, size: 'square' as const, background: 'solid' as const, texture: 'none' as const, textSize };
  $: line = blurLine($labResults.blur);

  async function next() {
    // Covered again before the new words come in, so they can't be seen sharp.
    phase = 'sharpening';
    cancelAnimationFrame(raf);
    revealed = 0;
    blur = START;
    await wait(220);
    words = await randomWords(5);
    // A square card, the way LabCard fits it to the screen.
    const scale = Math.min(window.innerWidth - 32, window.innerHeight * 0.6) / 1080;
    textSize = TARGET_PX[ROUNDS[round % ROUNDS.length]] / scale;
    const began = performance.now();
    cancelAnimationFrame(raf);
    const tick = (now: number) => {
      blur = Math.max(0, START - ((now - began) / 1000) * PER_SECOND);
      if (phase === 'sharpening' && blur > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function canRead() {
    cancelAnimationFrame(raf);
    readAt = blur;
    revealed = 999;
    phase = 'asking';
  }

  function answer(right: boolean) {
    patchResults({ blur: [...$labResults.blur, { size, fontPx: fontScreen, ratio: readAt, right, cover }] });
    round++;
    if (round >= ROUNDS.length) {
      round = 0;
      phase = 'idle';
    } else {
      void next();
    }
  }

  onDestroy(() => cancelAnimationFrame(raf));
</script>

<p class="lab-hint">
  Words come in blurred and slowly sharpen. Tap <b>I can read it</b> the moment you can read all five, then say if you read them right. Six rounds, three at each text size. Hold the phone where you normally do.
</p>

<div class="lab-row">
  <label>Cover
    <select bind:value={cover} disabled={phase !== 'idle'}>
      <option value="pill">Blur pills</option>
      <option value="wordblur">Word blur</option>
    </select>
  </label>
  {#if phase !== 'idle'}
    <span>Round {round + 1} of {ROUNDS.length}, {size} text</span>
  {/if}
</div>

{#if words}
  <LabCard
    passage={words}
    reference="Blur test"
    translationLabel="Lab"
    {style}
    {cover}
    {blur}
    {revealed}
    onDrawn={(d) => (fontScreen = d.fontScreenPx)}
  />
{/if}

<div class="lab-row">
  {#if phase === 'idle'}
    <button class="lab-btn" on:click={next}>{$labResults.blur.length ? 'Run again' : 'Start'}</button>
  {:else if phase === 'sharpening'}
    <button class="lab-btn big" on:click={canRead}>I can read it</button>
  {:else}
    <span>Did you read them right?</span>
    <button class="lab-btn" on:click={() => answer(true)}>Yes</button>
    <button class="lab-btn" on:click={() => answer(false)}>No</button>
  {/if}
</div>

{#if $labResults.blur.length}
  <div class="lab-stats">
    <div>Small text: {line.small?.toFixed(3) ?? '–'} · Large text: {line.large?.toFixed(3) ?? '–'}</div>
    <div><b>The line: {line.line?.toFixed(3) ?? '–'}</b> of the text size ({$labResults.blur.length} rounds)</div>
  </div>
{/if}
