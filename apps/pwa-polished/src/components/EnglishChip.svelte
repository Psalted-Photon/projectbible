<script lang="ts">
  /**
   * The "English" switch, shown wherever Greek or Hebrew previews are on
   * screen. One setting behind every copy, so flipping it in one window flips
   * it in all of them.
   */
  import { englishCompanion } from "../lib/englishCompanion";
</script>

<button
  class="english-chip"
  class:active={$englishCompanion}
  aria-pressed={$englishCompanion}
  title={$englishCompanion ? "Hide the English under each verse" : "Show the verse in English under each one"}
  on:click={() => englishCompanion.set(!$englishCompanion)}
>
  English
</button>

<style>
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
