<script lang="ts">
  /**
   * "irisBible" in Milonga, each letter with its own earth-colored shadow and
   * the iris standing in as the dot of the "i" in Bible.
   *
   * Drawn with live text, not an image, so it is sharp at any size: set
   * `font-size` on the element or a parent and everything follows (the shadows
   * and the dot are all in em). Which look it shows comes from the clock unless
   * a `code` is passed — see lib/wordmark.ts.
   */
  import { WORDMARKS, WORDMARK_LETTERS, irisShadow, letterShadows, wordmarkAt, type WordmarkCode } from '../lib/wordmark';

  export let code: WordmarkCode = wordmarkAt();

  $: look = WORDMARKS[code];
  $: shadows = letterShadows(look);
  $: dotShadow = irisShadow(look);
</script>

<span class="wordmark" role="img" aria-label="irisBible" style="color: {look.ink};">
  {#each WORDMARK_LETTERS as letter, n}
    {#if letter === 'ı'}
      <span class="letter dotted" style="text-shadow: {shadows[n]};" aria-hidden="true">ı<img
          class="iris"
          src="/pb-gem.png"
          alt=""
          draggable="false"
          style="box-shadow: {dotShadow};"
        /></span>
    {:else}
      <span class="letter" style="text-shadow: {shadows[n]};" aria-hidden="true">{letter}</span>
    {/if}
  {/each}
</span>

<style>
  /* Milonga is SIL OFL 1.1 (Google Fonts), used unmodified. */
  @font-face {
    font-family: 'Milonga';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url('/fonts/milonga-400.woff2') format('woff2');
  }

  .wordmark {
    display: inline-flex;
    align-items: baseline;
    font-family: 'Milonga', Georgia, serif;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0.04em;
    white-space: nowrap;
    user-select: none;
  }

  .letter {
    display: block;
  }

  .dotted {
    position: relative;
    display: inline-block;
  }

  /* Sized and placed on the artboard's numbers (200px type): a 40px iris
     centered 29.5px in, its bottom where Milonga's own dot would end. */
  .iris {
    position: absolute;
    left: 0.1475em;
    top: 0.11em;
    width: 0.2em;
    height: 0.2em;
    transform: translateX(-50%);
    border-radius: 50%;
    pointer-events: none;
  }
</style>
