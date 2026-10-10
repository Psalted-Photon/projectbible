<script lang="ts">
  import type { PackGlyph } from '../../lib/packInstaller';

  /** A pack's icon — one Phosphor glyph, or two side by side (Lexical). */
  export let icons: PackGlyph[];
  export let size = 18;
</script>

<span class="pack-icon" aria-hidden="true">
  {#each icons as glyph}
    <svelte:component this={glyph} {size} weight="bold" />
  {/each}
</span>

<style>
  .pack-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex-shrink: 0;
    min-width: 1.5rem;
  }
</style>
