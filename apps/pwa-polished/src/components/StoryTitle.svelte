<script lang="ts">
  /**
   * Story Mode's pinned title: "Bigger story (chapters) › smaller story
   * (chapters)", held at the top of the reader while you scroll, just under
   * the nav bar and riding up with it when the bar tucks away.
   *
   * It lies over the text the way the nav bar does and takes no room in the
   * page, so nothing about where a verse sits, and so nothing saved, changes
   * when it shows. Plain theme text on the reader's own background: no new
   * colors and nothing on the verses. On a narrow screen the names are cut
   * short first, so the chapters in brackets always show.
   *
   * Tapping it opens the Bible dropdown at the story you are in.
   */
  import { createEventDispatcher } from 'svelte';
  import { chapterSpan, type StoryPlace } from '../lib/stories';
  import { fadeIn } from '../lib/motion';

  /** The story at the top of the screen. */
  export let place: StoryPlace;
  /** How far down from the reader's top edge it sits: the visible height of the nav bar. */
  export let top = 0;
  /** Its own height, for the reader to land verses clear of it. */
  export let height = 0;

  const dispatch = createEventDispatcher<{ open: void }>();

  let bar: HTMLButtonElement;

  // A new story swaps in with the app's short fade, which the Motion setting
  // shortens or turns off. Not on the first draw: it rides in with the bar.
  let shown = '';
  $: key = `${place.bigger.t}|${place.smaller.t}`;
  $: if (key !== shown) {
    if (shown && bar) fadeIn(bar.querySelector('.story-title-text') as HTMLElement | null);
    shown = key;
  }
</script>

<div class="story-title-dock">
  <button
    class="story-title-bar"
    style="transform: translateY({top}px);"
    bind:this={bar}
    bind:offsetHeight={height}
    title="Stories in this book"
    on:click|stopPropagation={() => dispatch('open')}
  >
    <span class="story-title-text">
      <span class="part part-bigger">
        <span class="name">{place.bigger.t}</span>
        <span class="chapters">({chapterSpan(place.bigger)})</span>
      </span>
      <span class="sep" aria-hidden="true">›</span>
      <span class="part part-smaller">
        <span class="name">{place.smaller.t}</span>
        <span class="chapters">({chapterSpan(place.smaller)})</span>
      </span>
    </span>
  </button>
</div>

<style>
  /* Takes no height in the page and sticks at the reader's top edge; the bar
     inside hangs from it, moved down to sit under the nav bar. */
  .story-title-dock {
    position: sticky;
    top: 0;
    height: 0;
    flex: none;
    /* Under the nav bar (1000), so the bar's dropdowns and shadow fall over
       it, and over the text (1). */
    z-index: 999;
  }

  .story-title-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(26px * var(--bar-scale, 1));
    padding: 0 calc(12px * var(--bar-scale, 1));
    margin: 0;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    /* The reader's own colors. Light and Sepia come from the filter on the
       whole reader, Custom from these variables, as for the text itself. */
    background: var(--reader-bg, #1a1a1a);
    color: var(--reader-text, #e0e0e0);
    font: inherit;
    font-size: calc(0.78rem * var(--bar-scale, 1));
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    /* Moves with the nav bar, which slides on the same timing. */
    transition: transform 0.25s ease;
  }

  .story-title-text {
    display: flex;
    align-items: baseline;
    gap: 0.45em;
    min-width: 0;
    max-width: 100%;
    white-space: nowrap;
  }

  .part {
    display: flex;
    align-items: baseline;
    gap: 0.3em;
    min-width: 0;
  }

  /* The bigger story's name gives way first, the smaller one's after it. */
  .part-bigger {
    flex: 0 3 auto;
  }

  .part-smaller {
    flex: 0 1 auto;
    font-weight: 600;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapters {
    flex: none;
    font-weight: 400;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .sep {
    flex: none;
    opacity: 0.6;
  }
</style>
