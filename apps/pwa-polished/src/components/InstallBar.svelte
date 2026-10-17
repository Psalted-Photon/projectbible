<script lang="ts">
  /**
   * The thin bar under an install's progress line. Shown only while the step
   * running has a real percent; words-only steps (checking, opening, removing)
   * hide it rather than guess.
   *
   * Drawn in the color of the text around it, so it follows the reader's theme
   * and whatever button it sits in, and its height follows Bar size.
   */
  import { installPercent } from '../lib/packInstaller';
</script>

{#if $installPercent !== null}
  <span class="install-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={$installPercent}>
    <span class="fill" style="width:{$installPercent}%"></span>
  </span>
{/if}

<style>
  .install-bar {
    display: block;
    width: 100%;
    height: calc(3px * var(--bar-scale, 1));
    margin-top: calc(4px * var(--bar-scale, 1));
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 22%, transparent);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: currentColor;
    transition: width 0.3s ease;
  }
</style>
