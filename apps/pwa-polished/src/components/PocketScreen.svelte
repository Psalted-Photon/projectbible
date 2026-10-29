<script lang="ts">
  /**
   * The pocket screen: black over everything while a recording runs, so the
   * screen kept awake costs little and taps in a pocket do nothing. Both of
   * its buttons have to be held for a second: one stops, and asks what next
   * like every Stop, the other goes back to the app with the recording still
   * running.
   *
   * Comes up from the recording pill's moon, or by itself on a phone after two
   * minutes without a touch (lib/recorder/recorder.ts).
   */
  import { onDestroy } from 'svelte';
  import { portal } from '../lib/portal';
  import { recorder, setPocket } from '../lib/recorder/recorder';
  import { clock } from '../lib/recorder/recordings';
  import { stopAndAsk } from '../lib/voice/transcribe';

  const HOLD_MS = 1000;

  /** Which button is being held, and how far along, 0–1. */
  let holding: 'stop' | 'back' | null = null;
  let progress = 0;
  let startedAt = 0;
  let frame = 0;

  function press(which: 'stop' | 'back', e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    holding = which;
    startedAt = performance.now();
    progress = 0;
    cancelAnimationFrame(frame);
    const step = () => {
      if (!holding) return;
      progress = Math.min(1, (performance.now() - startedAt) / HOLD_MS);
      if (progress >= 1) {
        const done = holding;
        holding = null;
        progress = 0;
        void finish(done);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function letGo() {
    holding = null;
    progress = 0;
    cancelAnimationFrame(frame);
  }

  async function finish(which: 'stop' | 'back') {
    if (which === 'back') {
      setPocket(false);
      return;
    }
    await stopAndAsk();
  }

  onDestroy(() => cancelAnimationFrame(frame));

  $: paused = $recorder.phase === 'paused';
</script>

{#if $recorder.pocket && $recorder.phase !== 'idle'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pocket no-edge-gesture"
    use:portal
    role="dialog"
    aria-modal="true"
    aria-label="Pocket screen"
    tabindex="-1"
    on:pointerdown|preventDefault
    on:contextmenu|preventDefault
  >
    <p class="state">
      <span class="dot" class:paused aria-hidden="true"></span>
      {paused ? 'Paused' : 'Recording'} · {clock($recorder.elapsed)}
    </p>

    <button
      type="button"
      class="hold big"
      style="--p: {holding === 'stop' ? progress : 0}"
      on:pointerdown|stopPropagation={(e) => press('stop', e)}
      on:pointerup={letGo}
      on:pointercancel={letGo}
      on:pointerleave={letGo}
      on:contextmenu|preventDefault
    >
      <span class="label">Hold to stop</span>
    </button>

    <button
      type="button"
      class="hold small"
      style="--p: {holding === 'back' ? progress : 0}"
      on:pointerdown|stopPropagation={(e) => press('back', e)}
      on:pointerup={letGo}
      on:pointercancel={letGo}
      on:pointerleave={letGo}
      on:contextmenu|preventDefault
    >
      <span class="label">Hold to go back</span>
    </button>
  </div>
{/if}

<style>
  .pocket {
    position: fixed;
    inset: 0;
    /* Over everything, notices too: nothing on it should light up. */
    z-index: 10080;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 48px;
    padding: 24px 16px;
    background: #000;
    color: rgba(255, 255, 255, 0.45);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(229, 72, 77, 0.6);
  }

  .dot.paused {
    background: rgba(255, 255, 255, 0.3);
  }

  /* The ring fills while it's held. */
  .hold {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-radius: 50%;
    background:
      conic-gradient(rgba(229, 72, 77, 0.55) calc(var(--p, 0) * 360deg), transparent 0) border-box;
    color: rgba(255, 255, 255, 0.6);
    font: inherit;
    cursor: pointer;
    touch-action: none;
    -webkit-touch-callout: none;
  }

  .hold::before {
    content: '';
    position: absolute;
    inset: 6px;
    border-radius: 50%;
    background: #000;
  }

  .label {
    position: relative;
  }

  .big {
    width: min(62vw, 240px);
    height: min(62vw, 240px);
    font-size: 20px;
  }

  .small {
    width: 120px;
    height: 120px;
    font-size: 13px;
    background:
      conic-gradient(rgba(255, 255, 255, 0.35) calc(var(--p, 0) * 360deg), transparent 0) border-box;
  }
</style>
