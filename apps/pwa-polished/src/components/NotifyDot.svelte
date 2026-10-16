<script lang="ts">
  /**
   * The notification dot: something here is waiting for you. Today that is the
   * packs check-up (lib/packCheckup.ts), shown on the gear, on the Storage &
   * updates header and on the check-up button, so it leads from one to the
   * next.
   *
   * Size and color come from Settings → Appearance through --notify-dot-size
   * and --notify-dot-color on :root (lib/notifyDot.ts). The dark ring keeps it
   * readable on the gear's gradient, the pane and the blue button alike.
   *
   * Pinned to the corner of its parent, which must be positioned, or set in the
   * line of text with `inline`.
   */
  export let show = false;
  export let inline = false;
  /** Offsets from the parent's top-right corner, when not inline. */
  export let top = '-3px';
  export let right = '-3px';
</script>

{#if show}
  <span
    class="notify-dot"
    class:inline
    style:top={inline ? null : top}
    style:right={inline ? null : right}
    aria-hidden="true"
  ></span>
{/if}

<style>
  .notify-dot {
    position: absolute;
    z-index: 1;
    width: var(--notify-dot-size, 8px);
    height: var(--notify-dot-size, 8px);
    border-radius: 50%;
    background: var(--notify-dot-color, #667eea);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }

  .notify-dot.inline {
    position: relative;
    display: inline-block;
    flex-shrink: 0;
    margin-left: 0.15rem;
  }
</style>
