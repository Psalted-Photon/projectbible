<script lang="ts">
  /**
   * The Read Aloud start button, under each chapter heading.
   *
   * This used to be the whole player. It is now only the way in: playback itself
   * lives in lib/tts/readingEngine, which owns the position and keeps reading
   * across chapters whether or not any of this is on screen. Once reading
   * starts, the operating controls appear in the navbar — you should not have to
   * scroll back to a chapter heading to press pause.
   *
   * Voice download stays here, on purpose: it is the chapter you tapped that
   * should show the prompt, not every chapter at once.
   */
  import {
    isTtsSupported,
    isVoiceInstalled,
    downloadVoice,
    getVoiceInfo,
    unlockTtsAudio,
    greekSpeechRoute,
  } from '../adapters/tts.js';
  import { getTtsSettings } from '../adapters/settings.js';
  import { canSpeakOriginal } from '../lib/tts/originalText.js';
  import {
    readingState,
    readingPosition,
    isPreparing,
    startReading,
    togglePlayPause,
  } from '../lib/tts/readingEngine.js';
  import BrandSpinner from './BrandSpinner.svelte';

  export let translation: string;
  export let book: string;
  export let chapter: number;

  type LocalState = 'idle' | 'voice-needed' | 'downloading' | 'error';
  let local: LocalState = 'idle';
  let errorMsg = '';
  let downloadPct = 0;
  /** Pressed, and still getting to the point where the engine takes over. */
  let pressing = false;

  // Greek chapters are voiced by whichever model the pronunciation setting
  // picks, which may not be the voice the user reads English with.
  $: isGreek =
    /^(byz|tr|sblgnt|lxx)$/i.test(translation) && canSpeakOriginal(translation);
  $: voiceId = isGreek ? greekSpeechRoute().voiceId : getTtsSettings().voiceId;
  $: voiceSizeMB = getVoiceInfo(voiceId)?.approxSizeMB ?? 64;

  // Is the engine reading *this* chapter right now? Only that chapter's button
  // lights up, so chapter 1 never looks active while chapter 5 is being read.
  $: isThisChapter =
    $readingPosition?.book === book && $readingPosition?.chapter === chapter;
  $: isLive = isThisChapter && ($readingState === 'playing' || $readingState === 'paused');

  async function handleClick(): Promise<void> {
    if (isLive) {
      togglePlayPause();
      return;
    }

    // Must run synchronously inside the tap, before any await: this is what
    // unlocks the audio element on iOS so every later chapter handoff — hours
    // later, screen off — is allowed to play without a fresh gesture.
    unlockTtsAudio();

    local = 'idle';
    errorMsg = '';
    // Spin from the press itself. The engine's own "preparing" signal only
    // begins once it has been called, and the voice check before that is an
    // await — without this the button would sit dead for that moment.
    pressing = true;

    try {
      // Check before handing off, so only this chapter shows the download prompt.
      if (!(await isVoiceInstalled(voiceId))) {
        local = 'voice-needed';
        return;
      }
      await startReading(translation, book, chapter);
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
    await startReading(translation, book, chapter);
  }
</script>

{#if isTtsSupported()}
  <div class="tts-player" class:active={isLive}>
    {#if local === 'voice-needed'}
      <button class="tts-download-btn" on:click={handleDownloadVoice}>
        Download voice (~{voiceSizeMB} MB)
      </button>
      <button class="tts-btn" on:click={() => (local = 'idle')} title="Cancel">✕</button>
    {:else if local === 'downloading'}
      <BrandSpinner size={18} title="Downloading voice…" />
      <span class="tts-tip">Downloading voice… {downloadPct}%</span>
    {:else if local === 'error'}
      <span class="tts-tip tts-error">{errorMsg}</span>
      <button class="tts-btn" on:click={() => (local = 'idle')} title="Dismiss">✕</button>
    {:else if pressing || (isThisChapter && $isPreparing)}
      <!-- Only this chapter spins; the rest keep their plain talking head. -->
      <BrandSpinner size={22} />
    {:else}
      <button
        class="tts-btn tts-play-btn"
        class:tts-live={isLive}
        on:click={handleClick}
        title={isLive
          ? ($readingState === 'playing' ? 'Pause reading' : 'Resume reading')
          : 'Read this chapter aloud (AI voice)'}
        aria-label={isLive ? 'Pause or resume reading' : 'Read aloud'}
      >
        {isLive && $readingState === 'playing' ? '⏸' : '🗣'}
      </button>
      {#if isLive}
        <span class="tts-hint">Controls are in the bar at the top</span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .tts-player {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    vertical-align: middle;
  }

  .tts-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 1.15rem;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    transition: color 0.15s, transform 0.15s;
  }
  .tts-btn:hover {
    color: #b79df7;
    transform: scale(1.08);
  }

  .tts-play-btn {
    font-size: 1.25rem;
  }

  /* The chapter currently being read — the only lit one. */
  .tts-live {
    color: #9d7af5;
  }

  .tts-hint {
    font-size: 0.65rem;
    color: #6a6a7a;
    font-style: italic;
  }

  .tts-download-btn {
    background: rgba(157, 122, 245, 0.12);
    border: 1px solid rgba(157, 122, 245, 0.4);
    border-radius: 999px;
    color: #b79df7;
    font-size: 0.7rem;
    padding: 3px 10px;
    cursor: pointer;
  }
  .tts-download-btn:hover {
    background: rgba(157, 122, 245, 0.2);
  }

  .tts-tip {
    font-size: 0.7rem;
    color: #777;
    font-style: italic;
  }
  .tts-error {
    color: #f0a0a0;
  }

  @media (max-width: 480px) {
    .tts-player {
      height: 40px;
    }
    .tts-btn {
      font-size: 1.4rem;
      padding: 4px 10px;
    }
    .tts-play-btn {
      font-size: 1.5rem;
    }
    .tts-hint {
      display: none;
    }
  }
</style>
