<script lang="ts">
  /**
   * One saved verse in the By Heart list: its small card, its reference in the
   * book's color, its score and when it comes back. The card is drawn the first
   * time the row scrolls into view. Tapping the row opens the verse's page.
   */
  import { onDestroy } from 'svelte';
  import { CaretRight, MicrophoneSlash } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { getBookColor } from '../../lib/bibleData';
  import { cardThumb } from '../../lib/byHeart/cardThumb';
  import { scoreColor } from '../../lib/byHeart/scoring';
  import { overallOf, progressOf, stageOf } from '../../lib/byHeart/schedule';
  import { nextDateLabel, referenceOf } from '../../lib/byHeart/verse';
  import { SILENT_MARK, STAGE_NAMES } from '../../lib/byHeart/ways';
  import TranslationTag from './TranslationTag.svelte';

  export let verse: DBByHeartVerse;
  export let onOpen: () => void;

  $: overall = overallOf(verse);
  $: back = nextDateLabel(verse);
  $: overallLabel = overall === null ? 'No Overall score yet' : `Overall ${overall}%`;

  let thumb: HTMLElement;
  let seen = false;
  let url: string | null = null;
  let observer: IntersectionObserver | null = null;

  $: if (thumb && !observer && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) seen = true;
    }, { rootMargin: '200px' });
    observer.observe(thumb);
  }

  $: if (seen) void load(verse);

  async function load(v: DBByHeartVerse) {
    const got = await cardThumb(v);
    if (v.id === verse.id && v.updatedAt === verse.updatedAt) url = got;
  }

  onDestroy(() => observer?.disconnect());
</script>

<div class="row">
  <button class="thumb" bind:this={thumb} aria-label="Open {referenceOf(verse)}" on:click={onOpen}>
    {#if url}<img src={url} alt="" />{/if}
  </button>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="text" on:click={onOpen}>
    <div class="ref">
      <span class="ref-name" style="color: {getBookColor(verse.book)}">{referenceOf(verse)}</span>
      <TranslationTag translation={verse.translation} />
    </div>
    <div class="preview">{verse.passage}</div>
    <div class="meta">
      <span class="stage">{STAGE_NAMES[stageOf(verse)]}</span>
      {#if verse.score !== null}
        <span class="score" style="--score: {scoreColor(verse.score)}">{verse.score}%</span>
        {#if progressOf(verse).silent}
          <span class="silent" title={SILENT_MARK} aria-label={SILENT_MARK}><MicrophoneSlash size="1em" weight="bold" /></span>
        {/if}
      {:else}
        <span>No score yet</span>
      {/if}
      {#if back}<span>{back}</span>{/if}
    </div>
    <div class="overall" role="img" aria-label={overallLabel} title={overallLabel}>
      {#if overall !== null}
        <div class="overall-fill" style="width: {overall}%; background: {scoreColor(overall)}"></div>
      {/if}
    </div>
  </div>
  <span class="go" aria-hidden="true"><CaretRight size="1em" weight="bold" /></span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px 8px 12px;
  }

  .thumb {
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.12);
    overflow: hidden;
    cursor: pointer;
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 100%;
  }

  /* The theme's invert would turn the card's colors into their opposites. */
  :global(body.light-theme .themed) img,
  :global(body.sepia-theme .themed) img {
    filter: invert(1) hue-rotate(180deg);
  }

  .text {
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .ref {
    font-size: 0.9em;
    font-weight: 600;
  }

  .preview {
    overflow: hidden;
    font-size: 0.8em;
    opacity: 0.7;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
    margin-top: 2px;
    font-size: 0.75em;
    opacity: 0.85;
  }

  .stage {
    font-weight: 600;
  }

  .overall {
    height: 3px;
    margin-top: 5px;
    border-radius: 2px;
    background: rgba(127, 127, 127, 0.2);
    overflow: hidden;
  }

  .overall-fill {
    height: 100%;
    border-radius: inherit;
  }

  .score {
    font-weight: 700;
    color: var(--score);
  }

  .silent {
    display: inline-flex;
    align-items: center;
    opacity: 0.8;
  }

  .go {
    flex-shrink: 0;
    display: inline-flex;
    padding-right: 8px;
    opacity: 0.45;
  }
</style>
