<script lang="ts">
  /**
   * What tapping a recording's pill in the writing opens (RecordingNode):
   * Play, Write it out and Delete for one kept on this device; Stop while it
   * records; how far it has got while it's being written out; a word when
   * it's locked with the journal or on another device.
   *
   * Placed and clamped like the reference menu (BibleRefPopover), and closed
   * the same ways: a tap elsewhere, or Escape.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Play, Stop, TextAlignLeft, Trash, X } from 'phosphor-svelte';
  import { fadeAway, grow } from '../lib/motion';
  import { portal } from '../lib/portal';
  import { recorder } from '../lib/recorder/recorder';
  import { recordings, recordingsLoaded, clock } from '../lib/recorder/recordings';
  import { seekable } from '../lib/recorder/seekable';
  import { chipStatus, writtenPercent } from '../lib/recorder/recordingChips';
  import {
    transcribing,
    transcribeQueue,
    transcribeRecording,
    stopTranscribing,
    stopAndAsk,
    forgetRecording,
  } from '../lib/voice/transcribe';
  import { journalLock } from '../lib/journalLock/lockState';
  import { openRecordingBlob } from '../lib/journalLock/recordingCrypto';
  import { askConfirm } from '../stores/confirmStore';
  import { showNotice, errorText } from '../stores/noticeStore';

  export let recId: string;
  export let x = 0;
  export let y = 0;

  const dispatch = createEventDispatcher<{ close: void; remove: void }>();

  const WIDTH = 240;
  let height = 96;

  // Follows everything the pill itself follows.
  const follow = (id: string, ..._changed: unknown[]) => chipStatus(id);
  $: status = follow(recId, $recorder, $recordings, $recordingsLoaded, $transcribing, $transcribeQueue, $journalLock);
  $: rec = status.rec;

  $: left = Math.min(Math.max(x - WIDTH / 2, 8), Math.max(8, window.innerWidth - WIDTH - 8));
  // Above the pill when there's room, else below it.
  $: top = y - height - 10 < 8 ? y + 26 : y - height - 10;

  let audioUrl: string | null = null;
  let opening = false;

  async function play() {
    if (!rec || opening) return;
    opening = true;
    try {
      const url = URL.createObjectURL(await openRecordingBlob(rec));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = url;
    } catch (err) {
      showNotice(`That recording couldn’t be opened: ${errorText(err)}`, 'error');
    } finally {
      opening = false;
    }
  }

  function writeOut() {
    void transcribeRecording(recId);
    dispatch('close');
  }

  function stop() {
    void stopAndAsk();
    dispatch('close');
  }

  async function remove() {
    if (!rec) return;
    const target = rec;
    const ok = await askConfirm(
      'Delete this recording? It’s gone from this device for good. Words already written out from it stay.',
      { confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    await forgetRecording(target);
    dispatch('remove');
    dispatch('close');
  }

  function takeOut() {
    dispatch('remove');
    dispatch('close');
  }

  onDestroy(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });
</script>

<svelte:window
  on:keydown={(e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    dispatch('close');
  }}
/>

<div
  class="rec-menu themed"
  use:portal
  use:grow={new DOMRect(x, y, 0, 20)}
  out:fadeAway
  bind:offsetHeight={height}
  style="left:{left}px; top:{top}px; width:{WIDTH}px;"
  role="menu"
  aria-label="Recording"
>
  {#if status.state === 'live' || status.state === 'paused' || status.state === 'saving'}
    <span class="rec-line">{status.state === 'paused' ? 'Recording, paused' : 'Recording now'}</span>
    <button class="rec-action" role="menuitem" disabled={status.state === 'saving'} on:click={stop}>
      <Stop size={14} weight="fill" /> Stop
    </button>
  {:else if status.state === 'writing'}
    <span class="rec-line">
      {$transcribing.phase === 'stopping'
        ? 'Stopping…'
        : $transcribing.stage ?? `Writing it out… ${writtenPercent($transcribing.readSec, rec?.durationSec ?? 0)}%`}
    </span>
    <button class="rec-action" role="menuitem" disabled={$transcribing.phase === 'stopping'} on:click={stopTranscribing}>
      <Stop size={14} weight="fill" /> Stop writing it out
    </button>
  {:else if status.state === 'missing'}
    <span class="rec-line">This recording is on another device.</span>
    <button class="rec-action" role="menuitem" on:click={takeOut}><X size={14} weight="bold" /> Take the chip out</button>
  {:else if status.state === 'locked'}
    <span class="rec-line">Locked with the journal. Unlock it to play this.</span>
  {:else if status.state === 'loading'}
    <span class="rec-line">Looking for the recording…</span>
  {:else if rec}
    {#if status.state === 'queued'}
      <span class="rec-line">Waiting its turn to be written out.</span>
    {:else if status.state === 'waiting'}
      <span class="rec-line">
        {rec.transcript?.forUnlock ? 'Written out once the journal is unlocked.' : 'Carries on being written out shortly.'}
      </span>
    {/if}
    {#if audioUrl}
      <!-- svelte-ignore a11y_media_has_caption -->
      <audio class="rec-player" controls autoplay preload="metadata" src={audioUrl} use:seekable></audio>
    {:else}
      <button class="rec-action" role="menuitem" disabled={opening} on:click={play}>
        <Play size={14} weight="fill" /> Play · {clock(rec.durationSec)}
      </button>
    {/if}
    {#if status.state === 'ready' && rec.transcript?.state !== 'done'}
      <button class="rec-action" role="menuitem" on:click={writeOut}>
        <TextAlignLeft size={14} weight="bold" />
        {rec.transcript && rec.transcript.doneSec > 0 ? 'Carry on writing it out' : 'Write it out'}
      </button>
    {/if}
    <button class="rec-action danger" role="menuitem" on:click={remove}><Trash size={14} weight="bold" /> Delete</button>
  {/if}
</div>

<style>
  .rec-menu {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid #e5484d;
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .rec-action {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #ddd;
    cursor: pointer;
    font-size: 0.82rem;
    padding: 9px 8px;
    text-align: left;
    white-space: nowrap;
  }

  .rec-action:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: #fff;
  }

  .rec-action:disabled {
    color: #888;
    cursor: default;
  }

  .rec-action.danger:hover {
    color: #ff6b6f;
  }

  .rec-line {
    padding: 7px 8px 5px;
    font-size: 0.78rem;
    color: #a8a8a8;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }

  .rec-player {
    display: block;
    width: 100%;
    height: 36px;
    margin: 2px 0 4px;
  }
</style>
