<script lang="ts">
  /**
   * One saved verse in the By Heart list: its small card, its reference in the
   * book's color, its score and when it comes back. The card is drawn the first
   * time the row scrolls into view. Tapping the row opens its game.
   */
  import { onDestroy } from 'svelte';
  import { DotsThree, MicrophoneSlash } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { getBookColor, translationLabel } from '../../lib/bibleData';
  import { cardThumb } from '../../lib/byHeart/cardThumb';
  import { scoreColor } from '../../lib/byHeart/scoring';
  import { openGame } from '../../lib/byHeart/game';
  import { progressOf, stageOf } from '../../lib/byHeart/schedule';
  import { nextDateLabel, referenceOf } from '../../lib/byHeart/verse';

  export let verse: DBByHeartVerse;
  export let expanded = false;
  export let onMore: () => void;

  $: label = translationLabel(verse.translation);
  $: isNet = verse.translation.toLowerCase() === 'net';

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
  <button class="thumb" bind:this={thumb} aria-label="Recite {referenceOf(verse)}" on:click={() => openGame(verse.id)}>
    {#if url}<img src={url} alt="" />{/if}
  </button>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="text" on:click={() => openGame(verse.id)}>
    <div class="ref">
      <span class="ref-name" style="color: {getBookColor(verse.book)}">{referenceOf(verse)}</span>
      {#if isNet}
        <a class="tr" href="http://netbible.org" target="_blank" rel="noopener noreferrer" on:click|stopPropagation>({label})</a>
      {:else}
        <span class="tr">({label})</span>
      {/if}
    </div>
    <div class="preview">{verse.passage}</div>
    <div class="meta">
      {#if verse.score !== null}
        <span class="score" style="--score: {scoreColor(verse.score)}">{verse.score}%</span>
        {#if progressOf(verse).silent}
          <span class="silent" title="Scored in silent study" aria-label="Scored in silent study"><MicrophoneSlash size="1em" weight="bold" /></span>
        {/if}
        {#if stageOf(verse) === 'known'}<span>Known</span>{/if}
      {/if}
      <span>{nextDateLabel(verse)}</span>
    </div>
  </div>
  <button class="more" aria-label="More for {referenceOf(verse)}" aria-expanded={expanded} on:click={onMore}>
    <DotsThree size="1.2em" weight="bold" />
  </button>
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

  .tr {
    font-weight: 400;
    opacity: 0.7;
    color: inherit;
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
    gap: 8px;
    margin-top: 2px;
    font-size: 0.75em;
    opacity: 0.85;
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

  .more {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
</style>
