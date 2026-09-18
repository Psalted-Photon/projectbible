<script lang="ts">
  /**
   * The wrapper one harmony pane sits in.
   *
   * It carries the `data-parallel-pane` tag the sync engine resolves every
   * element through, and it owns the dim state. The reader inside it knows
   * nothing about either — this is what lets four readers be driven without a
   * single change to BibleReader.svelte beyond the master's own hook.
   *
   * Phase 6 puts one of these per grid cell with a <BibleReader> inside it.
   */
  import { parallelStore, type DimReason } from '../stores/parallelStore';

  export let paneId: string;

  $: pane = $parallelStore.panes.find((p) => p.paneId === paneId) ?? null;
  $: dim = pane?.dim ?? false;
  $: label = dimLabel(pane?.dimReason ?? null);

  /**
   * What the corner label says.
   *
   * The absence is the interesting fact, not an error, so it is phrased as an
   * observation about the text rather than as something that went wrong —
   * "No parallel in John" is the insight the harmony view exists to show.
   */
  function dimLabel(reason: DimReason | null): string {
    if (!reason) return '';
    switch (reason.kind) {
      case 'no-passage':
        return `No parallel in ${reason.book}`;
      case 'not-loaded':
        return `${reason.book} ${reason.chapter} unavailable`;
      case 'no-group':
        return 'No parallel here';
    }
  }
</script>

<div class="parallel-pane" class:dim data-parallel-pane={paneId}>
  <slot />
  {#if dim && label}
    <div class="dim-label">{label}</div>
  {/if}
</div>

<style>
  .parallel-pane {
    position: relative;
    overflow: hidden;
    min-height: 0;
    /* Dim is information, not a lock: the pane stays readable and every tap,
       highlight and word study in it keeps working while it is faded. */
    transition: opacity 0.4s ease;
  }

  .parallel-pane.dim {
    opacity: 0.45;
  }

  .dim-label {
    position: absolute;
    bottom: 8px;
    right: 10px;
    z-index: 5;
    padding: 3px 8px;
    border-radius: 10px;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--text-secondary, #888);
    background: var(--bg-secondary, rgba(0, 0, 0, 0.35));
    /* The pane underneath is still live, so the label must never be the thing
       the finger lands on. */
    pointer-events: none;
  }
</style>
