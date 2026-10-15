<script lang="ts">
  /**
   * The Read Aloud start button for plain text — a commentary chapter, a
   * devotional, a verse's commentary. The same talking head and the same voice
   * download as the chapter button (TtsPlayer); once reading starts, the
   * floating player carries the controls.
   *
   * `paragraphs` is asked for only on the tap, so a long chapter of commentary
   * is never turned into speech text just by being on screen.
   *
   * The button carries `.rat-btn`; hosts style it from outside with :global.
   */
  import { isTtsSupported, getVoiceInfo, unlockTtsAudio } from '../adapters/tts.js';
  import { voiceForTap, fetchVoice, useVoice } from '../lib/tts/voiceForTap.js';
  import {
    readingState,
    readingSource,
    isPreparing,
    startReadingText,
    togglePlayPause,
  } from '../lib/tts/readingEngine.js';
  import BrandSpinner from './BrandSpinner.svelte';
  import CloseX from './CloseX.svelte';
  import { SpeakerHigh, Pause } from 'phosphor-svelte';

  /** Short, for the player and the lock screen: "Spurgeon · John 3". */
  export let title: string;
  export let paragraphs: () => string[] | Promise<string[]>;
  export let size = 16;
  export let label = 'Read aloud';

  type LocalState = 'idle' | 'voice-needed' | 'downloading' | 'error';
  let local: LocalState = 'idle';
  let errorMsg = '';
  let downloadPct = 0;
  /** Pressed, and still getting to the point where the engine takes over. */
  let pressing = false;

  let voiceId = '';
  $: voiceSizeMB = getVoiceInfo(voiceId)?.approxSizeMB ?? 64;
  $: voiceLabel = getVoiceInfo(voiceId)?.label.replace(/ \(.*\)$/, '') ?? 'voice';

  // Is this button's text the one being read? Titles name the passage, so only
  // its own button lights up.
  $: isThis = $readingSource.kind === 'text' && $readingSource.title === title;
  $: isLive = isThis && ($readingState === 'playing' || $readingState === 'paused');

  async function handleClick(): Promise<void> {
    if (isLive) {
      togglePlayPause();
      return;
    }

    // Synchronously inside the tap, before any await, as TtsPlayer does.
    unlockTtsAudio();

    local = 'idle';
    errorMsg = '';
    pressing = true;
    try {
      const check = await voiceForTap();
      voiceId = check.voiceId;
      if (check.status === 'downloading') {
        await handleDownloadVoice();
        return;
      }
      if (check.status === 'needed') {
        local = 'voice-needed';
        return;
      }
      useVoice(voiceId);
      await start();
    } finally {
      pressing = false;
    }
  }

  async function handleDownloadVoice(): Promise<void> {
    local = 'downloading';
    downloadPct = 0;
    try {
      await fetchVoice(voiceId, (pct) => (downloadPct = pct));
    } catch (e: any) {
      local = 'error';
      errorMsg = e?.message ?? 'Voice download failed.';
      return;
    }
    local = 'idle';
    useVoice(voiceId);
    await start();
  }

  async function start(): Promise<void> {
    const paras = await paragraphs();
    await startReadingText({ title, paragraphs: paras });
  }
</script>

{#if isTtsSupported()}
  <span class="rat">
    {#if local === 'voice-needed'}
      <button class="rat-download" on:click={handleDownloadVoice}>
        Download {voiceLabel} (~{voiceSizeMB} MB)
      </button>
      <CloseX class="rat-close" label="Cancel" on:click={() => (local = 'idle')} />
    {:else if local === 'downloading'}
      <BrandSpinner size={size + 2} title="Downloading voice…" />
      <span class="rat-tip">{voiceLabel} {downloadPct}%</span>
    {:else if local === 'error'}
      <span class="rat-tip rat-error">{errorMsg}</span>
      <CloseX class="rat-close" label="Dismiss" on:click={() => (local = 'idle')} />
    {:else}
      <button
        class="rat-btn"
        class:live={isLive}
        on:click={handleClick}
        title={isLive ? ($readingState === 'playing' ? 'Pause reading' : 'Resume reading') : label}
        aria-label={isLive ? 'Pause or resume reading' : label}
      >
        {#if pressing || (isThis && $isPreparing)}
          <BrandSpinner size={size + 2} />
        {:else if isLive && $readingState === 'playing'}
          <Pause size={size} weight="bold" />
        {:else}
          <SpeakerHigh size={size} weight="bold" />
        {/if}
      </button>
    {/if}
  </span>
{/if}

<style>
  .rat {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .rat-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }
  .rat-btn.live {
    color: #9d7af5;
  }

  /* Its 40px tap area hangs above and below so the row stays its height. */
  .rat :global(.rat-close) {
    margin: -10px 0;
  }

  .rat-download {
    background: rgba(157, 122, 245, 0.12);
    border: 1px solid rgba(157, 122, 245, 0.4);
    border-radius: 999px;
    color: #b79df7;
    font-size: 0.7rem;
    padding: 3px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  .rat-download:hover {
    background: rgba(157, 122, 245, 0.2);
  }

  .rat-tip {
    font-size: 0.7rem;
    color: #777;
    font-style: italic;
    white-space: nowrap;
  }
  .rat-error {
    color: #f0a0a0;
    white-space: normal;
    max-width: 220px;
  }
</style>
