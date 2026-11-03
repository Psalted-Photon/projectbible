<script lang="ts">
  /**
   * Whether a word made green on the card still shows green through its cover.
   * It should, since that's the point of letting people personalize a card.
   */
  import { onMount } from 'svelte';
  import LabCard from './LabCard.svelte';
  import { restoreLastStyle, type Emphasis } from '../../../lib/shareCard';
  import { readPassage, type LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { COVER_NAMES, labResults, patchResults, type CoverKind } from '../../../lib/byHeart/lab/labResults';

  const KINDS: CoverKind[] = ['pill', 'wordblur'];

  let passage: LabPassage | null = null;
  let emphasis: Record<number, Emphasis> = {};
  let cover: CoverKind = 'pill';
  let blur = 1;

  const style = { ...restoreLastStyle(), accentColor: '#22c55e' };

  onMount(async () => {
    passage = await readPassage('John', 3, 16);
    if (!passage) return;
    // Three words, spread out.
    const third = Math.floor(passage.words.length / 3);
    emphasis = { [Math.floor(third / 2)]: 'accent', [third + Math.floor(third / 2)]: 'accent', [third * 2 + Math.floor(third / 2)]: 'accent' };
  });

  function answer(seen: boolean) {
    patchResults({ color: { ...$labResults.color, [cover]: { seen, blur } } });
  }
</script>

<p class="lab-hint">
  Three words on this card are green. The slider starts at full blur. For each cover, can you see where the green is?
</p>

{#if passage}
  <LabCard passage={passage.passage} reference={passage.reference} translationLabel={passage.label} {style} {emphasis} {cover} {blur} />
{/if}

<div class="lab-row">
  <label>Cover
    <select bind:value={cover}>
      {#each KINDS as kind}<option value={kind}>{COVER_NAMES[kind]}</option>{/each}
    </select>
  </label>
  <label class="grow">Blur
    <input type="range" min="0.05" max="1" step="0.01" bind:value={blur} />
  </label>
</div>

<div class="lab-row">
  <span>Green shows?</span>
  <button class="lab-btn" class:on={$labResults.color[cover]?.seen === true} on:click={() => answer(true)}>Yes</button>
  <button class="lab-btn" class:on={$labResults.color[cover]?.seen === false} on:click={() => answer(false)}>No</button>
</div>

{#each KINDS as kind}
  {@const c = $labResults.color[kind]}
  {#if c}<div class="lab-stats">{COVER_NAMES[kind]} at {c.blur.toFixed(2)}: green {c.seen ? 'shows' : "doesn't show"}</div>{/if}
{/each}
