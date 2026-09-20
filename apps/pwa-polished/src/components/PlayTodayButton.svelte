<script lang="ts">
  /**
   * "Play this reading" — one tap, every passage of the day in plan order,
   * then silence.
   *
   * Both plan cards use this: the Reading Plan modal's today-card and Profile →
   * Reading. Each card is already showing a particular day — often an overdue
   * one — so it hands that day in, and the button plays exactly what the card
   * lists. With no day given it falls back to working one out from storage.
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
  import { getTodayPlaylist, buildPlaylistForDay, type PlanPlaylist } from '../lib/tts/planPlaylist';
  import { beginPlanRun } from '../lib/tts/planTicker';
  import { navigationStore } from '../stores/navigationStore';
  import BrandSpinner from './BrandSpinner.svelte';

  /** Close the modal once playback is under way. */
  export let onStarted: (() => void) | null = null;
  /** The plan the card is showing, if it knows. */
  export let planId: string | null = null;
  /** The day the card is showing — played as-is, with no second guess. */
  export let day: any = null;
  export let label = 'Play this reading';

  type Local = 'idle' | 'voice-needed' | 'downloading' | 'error';
  let local: Local = 'idle';
  let errorMsg = '';
  let downloadPct = 0;
  let pressing = false;

  $: voiceId = getTtsSettings().voiceId;
  $: voiceSizeMB = getVoiceInfo(voiceId)?.approxSizeMB ?? 64;
  $: isLive = $readingState === 'playing' || $readingState === 'paused';

  /** True when the day runs straight through one book, as the plan links judge it. */
  function isConsecutiveDay(chapters: Array<{ book: string; chapter: number }>): boolean {
    if (chapters.length <= 1) return true;
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].book !== chapters[i - 1].book) return false;
      if (chapters[i].chapter !== chapters[i - 1].chapter + 1) return false;
    }
    return true;
  }

  /**
   * Hand the day to the engine.
   *
   * The playlist is read before this — building it is an await, and the engine
   * has to be called from inside the tap. `unlockTtsAudio` at the top of the
   * handler is what actually buys that: once the element is unlocked, every
   * later programmatic play is allowed, including handoffs with the screen off.
   */
  function play(playlist: PlanPlaylist): void {
    // Go to the first passage now, in the tap, rather than waiting for the
    // engine's first clock tick — synthesis takes a while, and until this the
    // page sat wherever the user happened to be while the audio loaded.
    // `false` because the plan paints its own green mark, the same reason the
    // plan's text links pass it.
    const first = playlist.passages[0];
    if (first) {
      navigationStore.setReadingPlanActiveTarget(
        first.book,
        first.chapter,
        first.startVerse ?? null,
        isConsecutiveDay(playlist.chapters)
      );
      navigationStore.navigateTo(
        $navigationStore.translation,
        first.book,
        first.chapter,
        first.startVerse ?? null,
        false
      );
    }

    beginPlanRun(playlist);
    void startReadingPlaylist($navigationStore.translation, playlist.passages);
    onStarted?.();
  }

  /** The card's own day where there is one, otherwise whatever storage says. */
  function resolvePlaylist(): Promise<PlanPlaylist | null> {
    if (planId && day) return buildPlaylistForDay(planId, day);
    return getTodayPlaylist();
  }

  async function handleClick(): Promise<void> {
    // Synchronously, before any await — this is the unlock that iOS counts.
    unlockTtsAudio();

    local = 'idle';
    errorMsg = '';
    pressing = true;

    try {
      const playlist = await resolvePlaylist();
      if (!playlist) {
        local = 'error';
        errorMsg = 'Nothing to read here.';
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
    const playlist = await resolvePlaylist();
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
    <button class="play-today-btn" on:click={handleClick} title="Read this whole reading aloud">
      🗣 {label}
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
