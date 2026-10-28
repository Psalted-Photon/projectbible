<script lang="ts">
  /**
   * The audio library in Notes: every recording on this device, to play,
   * rename, save as a file and delete, plus Record and bringing a file in.
   * Saving as a file and bringing it in is how a recording moves between a
   * phone and a computer; recordings don't sync by themselves.
   *
   * Transcribe turns one into words on a notebook page (lib/voice/transcribe.ts),
   * with its progress here while it runs.
   */
  import { onMount, onDestroy } from 'svelte';
  import { Record, FileArrowUp, FileArrowDown, PencilSimple, Trash, CaretRight, TextAlignLeft, Stop, ArrowSquareOut } from 'phosphor-svelte';
  import { transcribing, transcribeRecording, stopTranscribing, stopAndNoticeSaved } from '../lib/voice/transcribe';
  import { openNotesPage } from '../lib/openNotesPage';
  import {
    recordings,
    refreshRecordings,
    recordingBlob,
    renameRecording,
    deleteRecording,
    saveRecordingFile,
    importRecording,
    clock,
    sizeLabel,
    type Recording,
  } from '../lib/recorder/recordings';
  import { recorder, recordingLive, startRecording } from '../lib/recorder/recorder';
  import { askConfirm } from '../stores/confirmStore';
  import { showNotice, errorText } from '../stores/noticeStore';

  /** The one opened up, with its player. */
  let openId: string | null = null;
  let audioUrl: string | null = null;
  let renamingId: string | null = null;
  let renameText = '';
  let fileInput: HTMLInputElement;
  let importing = false;

  onMount(() => void refreshRecordings());
  onDestroy(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  $: live = recordingLive($recorder);
  $: txBusy = $transcribing.phase !== 'idle';

  /** How far along this one's transcript is, 0–100, while it runs. */
  function txPercent(rec: Recording, readSec: number): number {
    return rec.durationSec ? Math.min(100, Math.round((readSec / rec.durationSec) * 100)) : 0;
  }

  async function toggle(rec: Recording) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    renamingId = null;
    if (openId === rec.id) {
      openId = null;
      return;
    }
    openId = rec.id;
    if (rec.state === 'recording') return;
    try {
      const url = URL.createObjectURL(await recordingBlob(rec));
      if (openId === rec.id) audioUrl = url;
      else URL.revokeObjectURL(url);
    } catch (err) {
      showNotice(`That recording couldn’t be opened: ${errorText(err)}`, 'error');
    }
  }

  /**
   * A recording straight from the browser's recorder has no length written in
   * it, so the player can't seek until it has been sent to the far end once.
   */
  function seekable(audio: HTMLAudioElement) {
    const fix = () => {
      if (Number.isFinite(audio.duration)) return;
      const back = () => {
        if (!Number.isFinite(audio.duration)) return;
        audio.removeEventListener('durationchange', back);
        audio.currentTime = 0;
      };
      audio.addEventListener('durationchange', back);
      audio.currentTime = 1e101;
    };
    audio.addEventListener('loadedmetadata', fix);
    return { destroy: () => audio.removeEventListener('loadedmetadata', fix) };
  }

  function startRename(rec: Recording) {
    renamingId = rec.id;
    renameText = rec.name;
  }

  async function commitRename() {
    const id = renamingId;
    renamingId = null;
    if (id && renameText.trim()) await renameRecording(id, renameText);
  }

  async function remove(rec: Recording) {
    const ok = await askConfirm(`Delete “${rec.name}”? The recording is gone from this device for good.`, {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if ($transcribing.id === rec.id) stopTranscribing();
    if (openId === rec.id) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = null;
      openId = null;
    }
    await deleteRecording(rec.id);
  }

  async function pickedFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    importing = true;
    try {
      const rec = await importRecording(file);
      if (rec) showNotice(`Added “${rec.name}” (${clock(rec.durationSec)}).`);
      else showNotice('That file isn’t audio this browser can play.', 'error');
    } catch (err) {
      showNotice(`That file couldn’t be added: ${errorText(err)}`, 'error');
    } finally {
      importing = false;
    }
  }

  function dateLabel(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function guardPointer(e: Event) {
    e.stopPropagation();
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<section class="recs">
  <div class="head">
    <span class="label">Recordings</span>
    <span class="count">({$recordings.length})</span>
    {#if live}
      <button type="button" class="rec-btn" disabled={$recorder.phase === 'stopping'} on:click={stopAndNoticeSaved}>
        <Stop size={14} weight="fill" /> Stop
      </button>
    {:else}
      <button type="button" class="rec-btn" on:click={() => startRecording()}>
        <Record size={14} weight="fill" /> Record
      </button>
    {/if}
    <button type="button" class="icon" title="Add an audio file" aria-label="Add an audio file" disabled={importing} on:click={() => fileInput.click()}>
      <FileArrowUp size={17} weight="bold" />
    </button>
    <input bind:this={fileInput} type="file" accept="audio/*" hidden on:change={pickedFile} />
  </div>

  {#if $recordings.length === 0}
    <p class="muted">
      Record a voice note, a talk or a song. Recordings stay on this device; save one as a file to move it to
      another.
    </p>
  {/if}

  <ul class="list">
    {#each $recordings as rec (rec.id)}
      <li class="row" class:open={openId === rec.id}>
        {#if renamingId === rec.id}
          <input
            class="rename"
            aria-label="Recording name"
            bind:value={renameText}
            use:focusOnMount
            on:mousedown={guardPointer}
            on:touchstart={guardPointer}
            on:click={guardPointer}
            on:blur={commitRename}
            on:keydown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                e.preventDefault();
                renamingId = null;
              }
            }}
          />
        {:else}
          <button type="button" class="title" aria-expanded={openId === rec.id} on:click={() => toggle(rec)}>
            <span class="caret motion-caret" class:open={openId === rec.id}><CaretRight size={11} weight="bold" /></span>
            <span class="name">{rec.name}</span>
            <span class="sub">
              {#if rec.state === 'recording'}
                Recording now…
              {:else}
                {clock(rec.durationSec)} · {sizeLabel(rec.bytes)} · {dateLabel(rec.createdAt)}{rec.quality === 'music' ? ' · Music' : ''}{rec.imported ? ' · From a file' : ''}{$transcribing.id === rec.id
                  ? ` · Transcribing ${txPercent(rec, $transcribing.readSec)}%`
                  : rec.transcript?.state === 'done'
                    ? ' · Transcribed'
                    : ''}
              {/if}
            </span>
          </button>
        {/if}

        {#if openId === rec.id && rec.state !== 'recording'}
          <div class="body">
            {#if audioUrl}
              <!-- svelte-ignore a11y_media_has_caption -->
              <audio class="player" controls preload="metadata" src={audioUrl} use:seekable></audio>
            {/if}
            {#if rec.interrupted}
              <p class="note">The app closed while this was recording, so the last couple of seconds may be missing.</p>
            {/if}
            {#each rec.gaps as gap}
              <p class="note">
                {gap.screenOff ? 'The screen locked' : 'The mic went silent'} at {clock(gap.from)}. Nothing was recorded
                until {clock(gap.to)}.
              </p>
            {/each}
            {#if $transcribing.id === rec.id}
              <div class="tx">
                <span class="tx-line">
                  {$transcribing.stage ??
                    ($transcribing.phase === 'stopping'
                      ? 'Stopping…'
                      : `Transcribing… ${clock($transcribing.readSec)} of ${clock(rec.durationSec)}`)}
                </span>
                <span class="tx-bar"><i style="width: {txPercent(rec, $transcribing.readSec)}%"></i></span>
              </div>
            {:else if rec.transcript?.state === 'done'}
              <p class="tx-line">Transcribed into a page in Notes.</p>
            {:else if rec.transcript && rec.transcript.doneSec > 0}
              <p class="tx-line">Transcribed up to {clock(rec.transcript.doneSec)}.</p>
            {/if}
            {#if rec.transcript?.state === 'failed' && rec.transcript.error}
              <p class="note">Transcribing stopped: {rec.transcript.error}</p>
            {/if}
            <div class="actions">
              {#if $transcribing.id === rec.id}
                <button type="button" class="act" disabled={$transcribing.phase === 'stopping'} on:click={stopTranscribing}>
                  <Stop size={14} weight="fill" /> Stop transcribing
                </button>
              {:else if rec.transcript?.state !== 'done'}
                <button type="button" class="act tx-go" disabled={txBusy} on:click={() => transcribeRecording(rec.id)}>
                  <TextAlignLeft size={14} weight="bold" />
                  {rec.transcript && rec.transcript.doneSec > 0 ? 'Carry on transcribing' : 'Transcribe'}
                </button>
              {/if}
              {#if rec.page}
                <button type="button" class="act" on:click={() => rec.page && openNotesPage(rec.page)}>
                  <ArrowSquareOut size={14} weight="bold" /> Open the page
                </button>
              {/if}
              <button type="button" class="act" on:click={() => startRename(rec)}><PencilSimple size={14} weight="bold" /> Rename</button>
              <button type="button" class="act" on:click={() => saveRecordingFile(rec)}><FileArrowDown size={14} weight="bold" /> Save as a file</button>
              <button type="button" class="act danger" on:click={() => remove(rec)}><Trash size={14} weight="bold" /> Delete</button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .recs {
    margin-top: 6px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }

  .rec-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    background: transparent;
    border: 1px solid rgba(229, 72, 77, 0.6);
    border-radius: 5px;
    color: #ff6b6f;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .rec-btn:hover:not(:disabled) {
    background: rgba(229, 72, 77, 0.12);
  }

  .rec-btn:disabled,
  .icon:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #bbb;
    cursor: pointer;
  }

  .icon:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .muted {
    margin: 0;
    padding: 6px 10px;
    color: #888;
    font-size: 0.8rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    margin: 0 6px;
    border-radius: 6px;
  }

  .row.open {
    background: rgba(255, 255, 255, 0.04);
  }

  .title {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 6px;
    width: 100%;
    padding: 7px 6px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .title:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .caret {
    grid-row: span 2;
    color: #888;
  }

  .name {
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    color: #888;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .rename {
    width: calc(100% - 12px);
    margin: 4px 6px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid #667eea;
    border-radius: 5px;
    color: inherit;
    font-size: 0.85rem;
  }

  .body {
    padding: 0 8px 10px 24px;
  }

  .player {
    display: block;
    width: 100%;
    height: 36px;
    margin: 2px 0 6px;
  }

  .note {
    margin: 4px 0;
    color: #c9a227;
    font-size: 0.75rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .act {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 9px;
    background: transparent;
    border: 1px solid #444;
    border-radius: 5px;
    color: #ccc;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .act:hover:not(:disabled) {
    border-color: #667eea;
  }

  .act:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .act.tx-go {
    border-color: rgba(102, 126, 234, 0.6);
    color: #c7d0ff;
  }

  .tx {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
  }

  .tx-line {
    margin: 4px 0;
    color: #aaa;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .tx .tx-line {
    margin: 0;
  }

  .tx-bar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .tx-bar > i {
    display: block;
    height: 100%;
    background: #667eea;
    transition: width 0.3s;
  }

  .act.danger:hover {
    border-color: #e5484d;
    color: #ff6b6f;
  }

</style>
