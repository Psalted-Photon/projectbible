<script lang="ts">
  /**
   * How many words one saved item can hold. The card shrinks the words to fit,
   * so the question is how small is too small on this screen, as big as they
   * can go at each card shape, and whether the pills keep up that many times over.
   */
  import { onMount } from 'svelte';
  import LabCard from './LabCard.svelte';
  import CloseX from '../../CloseX.svelte';
  import { CARD_SIZES, TEXT_SIZE_RANGE, restoreLastStyle, type CardSize } from '../../../lib/shareCard';
  import { firstWords, readPassage, type LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { watchFrames } from '../../../lib/byHeart/lab/frames';
  import { labResults, patchResults, type LimitResult } from '../../../lib/byHeart/lab/labResults';

  const COUNTS = [50, 100, 150, 200];
  /** Fast enough to count, slow enough to see. */
  const WORD_MS = 60;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let count: number | 'psalm23' = 150;
  let size: CardSize = 'square';
  let passage: LabPassage | null = null;
  let full = false;
  let revealed = 0;
  let running = false;
  let drawn: { fontCardPx: number; fontScreenPx: number; fullScale: number; drawMs: number; words: number } | null = null;

  $: style = { ...restoreLastStyle(), size, textSize: TEXT_SIZE_RANGE.max };
  $: screenPx = drawn ? drawn.fontCardPx * drawn.fullScale : 0;
  $: current = $labResults.limit.find((l) => l.words === passage?.words.length && l.size === size);

  async function load() {
    revealed = 0;
    drawn = null;
    // The longest psalm has words to spare for any count.
    passage = count === 'psalm23' ? await readPassage('Psalm', 23) : await firstWords('Psalm', 119, count);
  }

  onMount(load);

  function record(patch: Partial<LimitResult>) {
    if (!passage || !drawn) return;
    const row: LimitResult = current ?? {
      words: passage.words.length,
      size,
      fontCardPx: drawn.fontCardPx,
      fontScreenPx: screenPx,
      drawMs: drawn.drawMs,
      readable: null,
      frames: null,
    };
    const next = { ...row, fontCardPx: drawn.fontCardPx, fontScreenPx: screenPx, ...patch };
    patchResults({
      limit: [...$labResults.limit.filter((l) => !(l.words === next.words && l.size === next.size)), next].sort(
        (a, b) => a.words - b.words || a.size.localeCompare(b.size),
      ),
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !full) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    full = false;
  }

  async function runPills() {
    if (!passage || running) return;
    running = true;
    revealed = 0;
    await wait(300);
    const stop = watchFrames();
    for (let i = 1; i <= passage.words.length; i++) {
      revealed = i;
      await wait(WORD_MS);
    }
    record({ frames: stop() });
    await wait(300);
    revealed = 0;
    running = false;
  }
</script>

<svelte:window on:keydown|capture={onKey} />

<p class="lab-hint">
  Pick a length and a card shape. The words are drawn as big as they fit. Tap <b>See it full screen</b> to judge it the way a game will show it, then say if you could recite from it. Psalm 23 is the target.
</p>

<div class="lab-chips">
  {#each COUNTS as c}
    <button class="lab-chip" class:on={count === c} disabled={running} on:click={() => { count = c; void load(); }}>{c} words</button>
  {/each}
  <button class="lab-chip" class:on={count === 'psalm23'} disabled={running} on:click={() => { count = 'psalm23'; void load(); }}>Psalm 23</button>
</div>
<div class="lab-chips">
  {#each Object.entries(CARD_SIZES) as [id, s]}
    <button class="lab-chip" class:on={size === id} disabled={running} on:click={() => { size = id as CardSize; revealed = 0; }}>{s.label}</button>
  {/each}
</div>

{#if passage}
  <LabCard
    passage={passage.passage}
    reference={passage.reference}
    translationLabel={passage.label}
    {style}
    cover={full ? null : 'pill'}
    blur={0.4}
    {revealed}
    {full}
    onDrawn={(d) => (drawn = d)}
  />
{/if}

{#if full}
  <div class="limit-close"><CloseX label="Close full screen" on:click={() => (full = false)} /></div>
{/if}

{#if drawn && passage}
  <div class="lab-stats">
    {passage.words.length} words: {Math.round(drawn.fontCardPx)}px on the card, <b>{screenPx.toFixed(1)}px on this screen</b>, drawn in {Math.round(drawn.drawMs)} ms
  </div>
{/if}

<div class="lab-row">
  <button class="lab-btn" on:click={() => (full = true)}>See it full screen</button>
  <button class="lab-btn" disabled={running} on:click={runPills}>Test the pills</button>
</div>
<div class="lab-row">
  <span>Could you recite from it?</span>
  <button class="lab-btn" class:on={current?.readable === true} on:click={() => record({ readable: true })}>Yes</button>
  <button class="lab-btn" class:on={current?.readable === false} on:click={() => record({ readable: false })}>Too small</button>
</div>

{#each $labResults.limit as l (`${l.words}-${l.size}`)}
  <div class="lab-stats">
    {l.words} words, {l.size}: {l.fontScreenPx.toFixed(1)}px · {l.readable == null ? 'not answered' : l.readable ? 'readable' : 'too small'}{l.frames ? ` · pills ${l.frames.fps} fps` : ''}
  </div>
{/each}

<style>
  .limit-close {
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 7;
  }
</style>
