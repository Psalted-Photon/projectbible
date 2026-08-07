<script lang="ts">
  import { ArrowLeft, Swap } from "phosphor-svelte";

  /**
   * The two controls at the head of every library window.
   *
   * Back walks out one step at a time — a crumb off the trail, then the entry,
   * then the index — matching what the nav bar's arrow does elsewhere. Swap
   * switches between the index and the entry, in either direction.
   *
   * These replaced a ☰, which reads as "menu" everywhere else in software and
   * was being used as a toggle.
   */
  export let canGoBack = false;
  export let canFlip = false;
  /** True while the index is showing, which reverses what swap means. */
  export let onIndex = false;
  export let onBack: () => void;
  export let onFlip: () => void;
</script>

<div class="nav-buttons">
  {#if canGoBack}
    <button class="nav-btn" on:click={onBack} title="Back" aria-label="Back">
      <ArrowLeft size={16} weight="duotone" />
    </button>
  {/if}
  {#if canFlip}
    <button
      class="nav-btn"
      on:click={onFlip}
      title={onIndex ? "Back to what you were reading" : "Contents"}
      aria-label={onIndex ? "Back to what you were reading" : "Contents"}
    >
      <Swap size={16} weight="duotone" />
    </button>
  {/if}
</div>

<style>
  .nav-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    /* Holds its width even with both buttons hidden, so the title doesn't
       shuffle sideways as you move between the index and an entry. */
    min-width: 22px;
  }
  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    padding: 3px;
    flex-shrink: 0;
  }
  .nav-btn:hover {
    color: var(--color-primary, #4a90e2);
  }
</style>
