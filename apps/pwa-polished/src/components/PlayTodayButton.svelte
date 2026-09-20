<script lang="ts">
  /**
   * "Play today's reading" — one tap, every passage of today's reading in plan
   * order, then silence.
   *
   * Both plan cards use this: the Reading Plan modal's today-card and Profile →
   * Reading. Neither knows what today's reading is; `getTodayPlaylist` works
   * that out from storage so the two always agree.
   *
   * Voice download lives here for the same reason it lives in TtsPlayer: the
   * card you tapped is the one that should show the prompt.
   */
  import {
    isTtsSupported,
    isVoiceInstalled,
    downloadVoice,
    getVoiceInfo,
    unlockTtsAudio,
  } from '../adapters/tts.js';
  import { getTtsSettings } from '../adapters/settings.js';
  import { startReadingPlaylist, readingState, isPreparing } from '../lib/tts/readingEngine';
  import { getTodayPlaylist, type PlanPlaylist } from '../lib/tts/planPlaylist';
  import { beginPlanRun } from '../lib/tts/planTicker';
  import { navigationStore } from '../stores/navigationStore';
  import BrandSpinner from './BrandSpinner.svelte';

  /** Close the modal once playback is under way. */
  export let onStarted: (() => void) | null = null;

  type Local = 'idle' | 'voice-needed' | 'downloading' | 'error';
  let local: Local = 'idle';
  let errorMsg = '';
  let downloadPct = 0;
  let pressing = false;

  $: voiceId = getTtsSettings().voiceId;
  $: voiceSizeMB = getVoiceInfo(voiceId)?.approxSizeMB ?? 64;
  $: isLive = $readingState === 'playing' || $readingState === 'paused';

  /**
   * Hand the day to the engine.
   *
   * The playlist is read before this — building it is an await, and the engine
   * has to be called from inside the tap. `unlockTtsAudio` at the top of the
   * handler is what actually buys that: once the element is unlocked, every
   * later programmatic play is allowed, including handoffs with the screen off.
   */
  function play(playlist: PlanPlaylist): void {
    beginPlanRun(playlist);
    void startReadingPlaylist($navigationStore.translation, playlist.passages);
    onStarted?.();
  }

  async function handleClick(): Promise<void> {
    // Synchronously, before any await — this is the unlock that iOS counts.
    unlockTtsAudio();

    local = 'idle';
    errorMsg = '';
    pressing = true;

    try {
      const playlist = await getTodayPlaylist();
      if (!playlist) {
        local = 'error';
        errorMsg = 'Nothing to read today.';
        return;
      }
      if (!(await isVoiceInstalled(voiceId))) {
        local = 'voice-needed';
        return;
      }
      play(playlist);
    } catch (e: any) {
      local = 'error';
      errorMsg = e?.message ?? 'Could not start reading.';
    } finally {
      pressing = false;
    }
  }

  async function handleDownloadVoice(): Promise<void> {
    local = 'downloading';
    downloadPct = 0;
    try {
      await downloadVoice(voiceId, (p) => {
        downloadPct = p.total > 0 ? Math.round((100 * p.loaded) / p.total) : 0;
      });
    } catch (e: any) {
      local = 'error';
      errorMsg = e?.message ?? 'Voice download failed.';
      return;
    }
    local = 'idle';
    const playlist = await getTodayPlaylist();
    if (playlist) play(playlist);
  }
</script>

{#if isTtsSupported()}
  {#if local === 'voice-needed'}
    <button class="play-today-btn" on:click={handleDownloadVoice}>
      Download voice (~{voiceSizeMB} MB)
    </button>
  {:else if local === 'downloading'}
    <span class="play-today-note"><BrandSpinner size={14} /> Downloading voice… {downloadPct}%</span>
  {:else if local === 'error'}
    <button class="play-today-btn is-error" on:click={() => (local = 'idle')} title={errorMsg}>
      {errorMsg} — dismiss
    </button>
  {:else if pressing || (isLive && $isPreparing)}
    <span class="play-today-note"><BrandSpinner size={14} /> Starting…</span>
  {:else}
    <button class="play-today-btn" on:click={handleClick} title="Read today's whole reading aloud">
      🗣 Play today's reading
    </button>
  {/if}
{/if}

<style>
  .play-today-btn {
    background: rgba(157, 122, 245, 0.14);
    border: 1px solid rgba(157, 122, 245, 0.45);
    color: #cbb8ff;
    border-radius: 8px;
    padding: 7px 13px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .play-today-btn:hover {
    background: rgba(157, 122, 245, 0.24);
    border-color: rgba(157, 122, 245, 0.7);
  }
  .play-today-btn.is-error {
    background: rgba(245, 122, 122, 0.14);
    border-color: rgba(245, 122, 122, 0.45);
    color: #ffc2c2;
  }

  .play-today-note {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: #9a90b5;
    font-style: italic;
  }
</style>
