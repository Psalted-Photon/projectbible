<script lang="ts">
  /**
   * What every Stop opens (lib/voice/transcribe.ts stopAndAsk): the page's
   * or the day's Stop, the recording pill's, the pocket screen's and
   * Recordings'. Three choices:
   *
   *   Write it out (keep the recording)
   *   Write it out, then delete the recording
   *   Recording only
   *
   * Asked every time. Looks like the app's other cards (VoiceCard.svelte);
   * a tap outside, × or Escape keeps the recording only, which loses nothing.
   */
  import { onMount } from 'svelte';
  import { fade, fly } from '../lib/motion';
  import { Stop, TextAlignLeft, Trash, Waveform } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import CloseX from './CloseX.svelte';
  import { clock } from '../lib/recorder/recordings';
  import { stoppedRecording, afterStop } from '../lib/voice/transcribe';

  $: rec = $stoppedRecording;
  $: where = rec?.journal ? 'into the day’s journal entry' : rec?.page ? 'into the page, where the pill is' : 'into a new page in Quick Notes';

  function keep() {
    afterStop('keep');
  }

  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (!$stoppedRecording || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      keep();
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  });
</script>

{#if rec}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="stop-backdrop" use:portal transition:fade={{ duration: 150 }} on:click={keep}>
    <div
      class="stop-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-card-title"
      tabindex="-1"
      in:fly={{ y: -16, duration: 250 }}
      on:click|stopPropagation
    >
      <CloseX class="stop-close" label="Keep the recording only" on:click={keep} />
      <h3 id="stop-card-title"><Stop size={20} weight="fill" /> Recording stopped · {clock(rec.durationSec)}</h3>
      <p class="quiet">The words go {where}. The recording stays on this device.</p>

      <div class="choices">
        <button type="button" class="choice main" on:click={() => afterStop('write')}>
          <TextAlignLeft size={18} weight="bold" />
          <span>
            <strong>Write it out</strong>
            <small>and keep the recording</small>
          </span>
        </button>
        <button type="button" class="choice" on:click={() => afterStop('write-delete')}>
          <Trash size={18} weight="bold" />
          <span>
            <strong>Write it out, then delete the recording</strong>
            <small>once the words are safely in</small>
          </span>
        </button>
        <button type="button" class="choice" on:click={keep}>
          <Waveform size={18} weight="bold" />
          <span>
            <strong>Recording only</strong>
            <small>write it out later from its chip</small>
          </span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .stop-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
    /* Over the mic button and the players, under notices. */
    z-index: 10058;
  }

  .stop-card {
    position: relative;
    width: min(100%, 420px);
    max-height: calc(100% - 32px);
    overflow-y: auto;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 16px 18px 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.92);
  }

  .stop-card :global(.stop-close) {
    position: absolute;
    top: 4px;
    right: 4px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 32px 6px 0;
    font-size: 1.05rem;
    color: #e6b84a;
    font-variant-numeric: tabular-nums;
  }

  p {
    margin: 0 0 12px;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .quiet {
    color: #999;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    color: rgba(255, 255, 255, 0.88);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .choice:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .choice span {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .choice strong {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .choice small {
    font-size: 0.78rem;
    color: #999;
  }

  .choice.main {
    border-color: transparent;
    background: #e6b84a;
    color: #1c1c1e;
  }

  .choice.main small {
    color: rgba(28, 28, 30, 0.7);
  }

  .choice.main:hover {
    background: #f0c75e;
  }
</style>
