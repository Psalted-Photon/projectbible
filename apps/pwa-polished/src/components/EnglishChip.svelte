<script lang="ts">
  /**
   * The "English" switch, shown wherever Greek or Hebrew previews are on
   * screen. One setting behind every copy, so flipping it in one window flips
   * it in all of them.
   */
  import { englishCompanion } from "../lib/englishCompanion";
  import { isOriginalLanguage } from "../lib/translationKind";

  /** The translation the previews are in; the chip hides unless it is Greek or Hebrew. */
  export let shown: string | null = null;
  /** On a row of its own above a list, at the right. */
  export let bar = false;

  $: visible = shown === null || isOriginalLanguage(shown);
</script>

{#if visible}
<div class:english-bar={bar} class:english-inline={!bar}>
<button
  class="english-chip"
  class:active={$englishCompanion}
  aria-pressed={$englishCompanion}
  title={$englishCompanion ? "Hide the English under each verse" : "Show the verse in English under each one"}
  on:click={() => englishCompanion.set(!$englishCompanion)}
>
  English
</button>
</div>
{/if}

<style>
  .english-inline {
    display: contents;
  }

  .english-bar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 4px 6px;
  }

  /* Drawn like the word study's source chips beside it. */
  .english-chip {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 4px;
    color: var(--text-muted, #9aa0aa);
    cursor: pointer;
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.03em;
    padding: 3px 9px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .english-chip:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-color, #dfe2e8);
  }

  .english-chip.active {
    background: color-mix(in srgb, var(--color-primary, #4a90e2) 18%, transparent);
    border-color: var(--color-primary, #4a90e2);
    color: var(--color-primary, #4a90e2);
  }
</style>
