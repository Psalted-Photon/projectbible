<script lang="ts">
  /**
   * The recording's controls while it runs (lib/recorder/recorder.ts): how
   * long, Pause or Resume, Stop, and the pocket screen. It floats over the
   * whole app, so a sermon can be recorded while reading along, and it stays
   * when the Notes window closes.
   *
   * Dragged by its grip like the mic button (lib/floatDrag.ts), and the spot
   * it is left in is remembered per device. Follows Bar size.
   */
  import { onDestroy } from 'svelte';
  import { DotsSixVertical, Pause, Play, Stop, Moon } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import { floatDrag } from '../lib/floatDrag';
  import { getRecorderPos, setRecorderPos } from '../adapters/settings';
  import { recorder, recordingLive, pauseRecording, resumeRecording, stopRecording, setPocket } from '../lib/recorder/recorder';
  import { clock } from '../lib/recorder/recordings';
  import { noticeSaved } from '../lib/voice/transcribe';

  let el: HTMLDivElement | null = null;
  const drag = floatDrag({
    // Top right, under the navbar, clamped back onto the screen.
    load: () => getRecorderPos() ?? { x: 1e5, y: 72 },
    save: setRecorderPos,
  });

  $: visible = recordingLive($recorder);
  $: if (visible && el) void drag.place(el);
  $: if (!visible) drag.teardown();

  onDestroy(() => drag.teardown());

  $: paused = $recorder.phase === 'paused';
  $: stopping = $recorder.phase === 'stopping';
  $: starting = $recorder.phase === 'starting';

  async function stop() {
    const rec = await stopRecording();
    if (rec) noticeSaved(rec);
  }
</script>

{#if visible}
  <div
    bind:this={el}
    use:portal
    class="recpill themed no-edge-gesture"
    class:dragging={$drag.dragging}
    style="left: {$drag.left}px; top: {$drag.top}px; visibility: {$drag.ready ? 'visible' : 'hidden'}; --level: {paused ? 0 : $recorder.level};"
    role="region"
    aria-label="Recording"
    on:pointerdown={drag.start}
  >
    <span class="grip" aria-hidden="true"><DotsSixVertical size="1em" weight="bold" /></span>
    <span class="dot" class:paused class:starting aria-hidden="true"></span>
    <span class="time" aria-live="off">{starting ? 'Starting…' : clock($recorder.elapsed)}</span>
    {#if paused}
      <button type="button" class="ctl" title="Resume" aria-label="Resume" disabled={stopping} on:click={resumeRecording}>
        <Play size="1.05em" weight="fill" />
      </button>
    {:else}
      <button type="button" class="ctl" title="Pause" aria-label="Pause" disabled={stopping || starting} on:click={pauseRecording}>
        <Pause size="1.05em" weight="fill" />
      </button>
    {/if}
    <button type="button" class="ctl stop" title="Stop and save" aria-label="Stop and save" disabled={stopping || starting} on:click={stop}>
      <Stop size="1.05em" weight="fill" />
    </button>
    <button
      type="button"
      class="ctl"
      title="Pocket screen: black, so the screen costs little and pocket taps do nothing"
      aria-label="Pocket screen"
      disabled={stopping || starting}
      on:click={() => setPocket(true)}
    >
      <Moon size="1.05em" weight="bold" />
    </button>
  </div>
{/if}

<style>
  .recpill {
    --s: var(--bar-scale, 1);
    position: fixed;
    /* Level with the mic button: over popovers, under notices. */
    z-index: 10055;
    display: flex;
    align-items: center;
    gap: calc(2px * var(--s));
    padding: calc(3px * var(--s)) calc(4px * var(--s)) calc(3px * var(--s)) calc(2px * var(--s));
    background: var(--reader-bg, #1c1c1e);
    color: var(--reader-text, rgba(255, 255, 255, 0.92));
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    font-size: calc(16px * var(--s));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: grab;
  }

  .recpill.dragging {
    cursor: grabbing;
  }

  .grip {
    display: flex;
    flex-shrink: 0;
    padding: calc(10px * var(--s)) calc(4px * var(--s));
    font-size: 0.85em;
    opacity: 0.4;
  }

  /* Grows with the loudness, so it's plain the mic is hearing. */
  .dot {
    flex-shrink: 0;
    width: calc(10px * var(--s));
    height: calc(10px * var(--s));
    margin: 0 calc(4px * var(--s));
    border-radius: 50%;
    background: #e5484d;
    box-shadow: 0 0 0 calc(var(--level, 0) * 7px * var(--s)) rgba(229, 72, 77, 0.3);
    transition: box-shadow 0.1s;
  }

  .dot.paused {
    background: #8e8e93;
    box-shadow: none;
  }

  .dot.starting {
    opacity: 0.5;
  }

  .time {
    min-width: 3.4em;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    text-align: left;
  }

  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: calc(36px * var(--s));
    height: calc(36px * var(--s));
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font-size: 1em;
    cursor: pointer;
    transition: background 0.15s;
  }

  .ctl:hover:not(:disabled) {
    background: rgba(127, 127, 127, 0.18);
  }

  .ctl:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ctl.stop {
    color: #e5484d;
  }
</style>
