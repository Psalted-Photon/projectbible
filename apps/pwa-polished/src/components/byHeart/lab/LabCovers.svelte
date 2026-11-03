<script lang="ts">
  /**
   * The covers on the longest verse in the Bible: how they look and whether a
   * phone keeps up. The test drags the blur up and down, then uncovers every
   * word at a fast talker's pace, with each kind of cover in turn, and counts
   * frames.
   */
  import { onMount } from 'svelte';
  import LabCard from './LabCard.svelte';
  import { restoreLastStyle } from '../../../lib/shareCard';
  import { readPassage, type LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { watchFrames } from '../../../lib/byHeart/lab/frames';
  import { COVER_NAMES, labResults, patchResults, type CoverKind, type CoverSpeed } from '../../../lib/byHeart/lab/labResults';

  const KINDS: CoverKind[] = ['pill', 'wordblur', 'box'];
  const LOOKS: CoverKind[] = ['pill', 'wordblur'];
  const SWEEP_MS = 3000;
  /** A fast talker. */
  const WORD_MS = 110;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const style = restoreLastStyle();

  let passage: LabPassage | null = null;
  let cover: CoverKind = 'pill';
  let blur = 0.5;
  let revealed = 0;
  let running = false;
  let progress = '';
  let buildMs: number | null = null;
  let trouble = '';

  onMount(async () => {
    passage = await readPassage('Esther', 8, 9);
    if (!passage) trouble = "Esther 8:9 isn't in this translation.";
  });

  async function runAll() {
    if (!passage || running) return;
    running = true;
    const speed: Partial<Record<CoverKind, CoverSpeed>> = {};
    for (const kind of KINDS) {
      cover = kind;
      revealed = 0;
      blur = 0.5;
      progress = `${COVER_NAMES[kind]}: the slider…`;
      await wait(400);
      const stopSweep = watchFrames();
      const began = performance.now();
      await new Promise<void>((done) => {
        const tick = (now: number) => {
          const t = (now - began) / SWEEP_MS;
          if (t >= 1) return done();
          blur = 0.1 + 0.5 * Math.abs(1 - 2 * t);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const sweep = stopSweep();
      blur = 0.5;
      progress = `${COVER_NAMES[kind]}: uncovering ${passage.words.length} words…`;
      await wait(300);
      const stopReveal = watchFrames();
      for (let i = 1; i <= passage.words.length; i++) {
        revealed = i;
        await wait(WORD_MS);
      }
      const reveal = stopReveal();
      speed[kind] = { words: passage.words.length, sweep, reveal, buildMs: kind === 'wordblur' ? buildMs : null };
      await wait(300);
    }
    patchResults({ speed, speedPassage: `${passage.reference} (${passage.label})` });
    cover = 'pill';
    revealed = 0;
    progress = '';
    running = false;
  }
</script>

<p class="lab-hint">
  Esther 8:9 is the longest verse there is. Tap <b>Run the speed test</b> and watch: it takes about 45 seconds and tries each cover in turn. Then try the covers and the slider yourself and answer below.
</p>

{#if passage}
  <LabCard
    passage={passage.passage}
    reference={passage.reference}
    translationLabel={passage.label}
    {style}
    {cover}
    {blur}
    {revealed}
    bind:buildMs
  />
{/if}

{#if trouble}<p class="lab-trouble">{trouble}</p>{/if}

<div class="lab-row">
  <label>Cover
    <select bind:value={cover} disabled={running}>
      {#each KINDS as kind}<option value={kind}>{COVER_NAMES[kind]}</option>{/each}
    </select>
  </label>
  <label class="grow">Blur
    <input type="range" min="0.05" max="1" step="0.01" bind:value={blur} disabled={running} />
  </label>
</div>

<div class="lab-row">
  <button class="lab-btn" disabled={running || !passage} on:click={runAll}>Run the speed test</button>
  <button class="lab-btn" disabled={running} on:click={() => (revealed = revealed ? 0 : 999)}>{revealed ? 'Cover all' : 'Uncover all'}</button>
  {#if progress}<span>{progress}</span>{/if}
</div>

{#each KINDS as kind}
  {@const s = $labResults.speed[kind]}
  {#if s}
    <div class="lab-stats">
      <b>{COVER_NAMES[kind]}</b>, {s.words} words: slider {s.sweep.fps} fps (worst {s.sweep.worst} ms) · uncovering {s.reveal.fps} fps (worst {s.reveal.worst} ms)
    </div>
  {/if}
{/each}

<div class="lab-row">
  <span>Best look:</span>
  {#each LOOKS as kind}
    <button class="lab-btn" class:on={$labResults.bestCover === kind} on:click={() => patchResults({ bestCover: kind })}>{COVER_NAMES[kind]}</button>
  {/each}
</div>
<div class="lab-row">
  <span>Did it look smooth?</span>
  <button class="lab-btn" class:on={$labResults.smooth === true} on:click={() => patchResults({ smooth: true })}>Yes</button>
  <button class="lab-btn" class:on={$labResults.smooth === false} on:click={() => patchResults({ smooth: false })}>No</button>
</div>
