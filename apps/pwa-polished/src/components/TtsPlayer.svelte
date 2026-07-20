<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { IndexedDBTextStore } from '../lib/adapters.js';
  import { extractSpeechText } from '../lib/verseRendering.js';
  import { continuousPlay, ttsAutoplayNext } from '../stores/audioStore.js';
  import { getTtsSettings } from '../adapters/settings.js';
  import {
    isTtsSupported,
    isVoiceInstalled,
    downloadVoice,
    synthesizeSpeech,
    getSharedTtsAudio,
    unlockTtsAudio,
    getVoiceInfo,
  } from '../adapters/tts.js';

  const dispatch = createEventDispatcher<{ nextchapter: { book: string; chapter: number } }>();

  export let translation: string;
  export let book: string;
  export let chapter: number;

  type PlayerState =
    | 'idle'
    | 'voice-needed'
    | 'downloading'
    | 'starting'
    | 'playing'
    | 'paused'
    | 'error';

  let state: PlayerState = 'idle';
  let errorMsg = '';
  let downloadPct = 0;
  let verseCount = 0;
  let currentIndex = 0;

  // Settings are re-read on every play so changes apply without a reload
  let ttsSettings = getTtsSettings();
  $: voiceId = ttsSettings.voiceId;
  $: voiceSizeMB = getVoiceInfo(voiceId)?.approxSizeMB ?? 64;

  // The shared audio element plays for whichever TtsPlayer instance spoke
  // last (multiple chapters can be mounted at once). Handlers check ownership
  // so a stale instance never advances another instance's playback.
  const instanceToken = Symbol('tts-player');
  let generation = 0;
  let verses: { verse: number; speech: string }[] = [];
  const blobCache = new Map<number, Blob>();
  const inFlight = new Map<number, Promise<Blob>>();
  let currentUrl: string | null = null;

  const textStore = new IndexedDBTextStore();

  onMount(() => {
    if (get(ttsAutoplayNext)) {
      ttsAutoplayNext.set(false);
      startReading();
    }
  });

  onDestroy(() => {
    stopReading();
  });

  function ownsAudio(): boolean {
    return (getSharedTtsAudio() as any).__ttsOwner === instanceToken;
  }

  async function loadVerses(): Promise<boolean> {
    const rows = await textStore.getChapter(translation, book, chapter);
    verses = rows
      .map((v) => {
        let speech = extractSpeechText(v.text);
        if (ttsSettings.readHeadings && v.heading && speech.length > 0) {
          speech = `${v.heading.trim().replace(/\.?$/, '.')} ${speech}`;
        }
        return { verse: v.verse, speech };
      })
      .filter((v) => v.speech.length > 0);
    verseCount = verses.length;
    return verses.length > 0;
  }

  function ensureSynth(index: number, gen: number): Promise<Blob> | null {
    if (gen !== generation || index >= verses.length) return null;
    const cached = blobCache.get(index);
    if (cached) return Promise.resolve(cached);
    let pending = inFlight.get(index);
    if (!pending) {
      pending = synthesizeSpeech(verses[index].speech, voiceId).then((blob) => {
        inFlight.delete(index);
        if (gen === generation) blobCache.set(index, blob);
        return blob;
      });
      inFlight.set(index, pending);
    }
    return pending;
  }

  async function playIndex(index: number, gen: number): Promise<void> {
    if (gen !== generation) return;
    const pending = ensureSynth(index, gen);
    if (!pending) return;

    let blob: Blob;
    try {
      blob = await pending;
    } catch (e: any) {
      if (gen !== generation) return;
      state = 'error';
      errorMsg = e?.message ?? 'Speech generation failed';
      return;
    }
    if (gen !== generation) return;

    const audio = getSharedTtsAudio();
    (audio as any).__ttsOwner = instanceToken;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    audio.src = currentUrl;
    audio.playbackRate = ttsSettings.rate;

    audio.onended = () => {
      if (!ownsAudio() || gen !== generation) return;
      if (index + 1 < verses.length) {
        playIndex(index + 1, gen);
      } else if (get(continuousPlay)) {
        ttsAutoplayNext.set(true);
        stopReading();
        dispatch('nextchapter', { book, chapter });
      } else {
        stopReading();
      }
    };
    audio.onerror = () => {
      if (!ownsAudio() || gen !== generation) return;
      state = 'error';
      errorMsg = 'Audio playback failed.';
    };

    try {
      await audio.play();
    } catch (e: any) {
      if (gen !== generation) return;
      state = 'error';
      errorMsg = e?.message ?? 'Playback blocked — tap play again.';
      return;
    }
    if (gen !== generation) return;

    currentIndex = index;
    state = 'playing';
    // Keep one verse ahead of playback
    ensureSynth(index + 1, gen);
  }

  async function startReading(): Promise<void> {
    unlockTtsAudio(); // must happen inside the tap, before any await
    ttsSettings = getTtsSettings();
    state = 'starting';
    errorMsg = '';

    try {
      if (!(await isVoiceInstalled(voiceId))) {
        state = 'voice-needed';
        return;
      }
      if (!(await loadVerses())) {
        state = 'error';
        errorMsg = 'No text available for this chapter.';
        return;
      }
    } catch (e: any) {
      state = 'error';
      errorMsg = e?.message ?? 'Could not start reading.';
      return;
    }

    const gen = ++generation;
    blobCache.clear();
    await playIndex(0, gen);
  }

  async function handleDownloadVoice(): Promise<void> {
    unlockTtsAudio();
    state = 'downloading';
    downloadPct = 0;
    try {
      await downloadVoice(voiceId, (p) => {
        downloadPct = p.total > 0 ? Math.round((100 * p.loaded) / p.total) : 0;
      });
    } catch (e: any) {
      state = 'error';
      errorMsg = e?.message ?? 'Voice download failed.';
      return;
    }
    await startReading();
  }

  function togglePlay(): void {
    if (state === 'playing') {
      if (ownsAudio()) getSharedTtsAudio().pause();
      state = 'paused';
      return;
    }
    if (state === 'paused' && ownsAudio()) {
      getSharedTtsAudio()
        .play()
        .then(() => (state = 'playing'))
        .catch(() => {
          state = 'error';
          errorMsg = 'Playback blocked — tap play again.';
        });
      return;
    }
    startReading();
  }

  function stopReading(): void {
    generation++;
    blobCache.clear();
    inFlight.clear();
    if (ownsAudio()) {
      const audio = getSharedTtsAudio();
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      delete (audio as any).__ttsOwner;
    }
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    currentIndex = 0;
    state = 'idle';
  }
</script>

{#if isTtsSupported()}
  <div class="tts-player" class:active={state === 'playing' || state === 'paused'}>
    {#if state === 'voice-needed'}
      <button class="tts-download-btn" on:click={handleDownloadVoice}>
        Download voice (~{voiceSizeMB} MB)
      </button>
      <button class="tts-btn" on:click={() => (state = 'idle')} title="Cancel">✕</button>
    {:else if state === 'downloading'}
      <span class="tts-tip">Downloading voice… {downloadPct}%</span>
    {:else if state === 'error'}
      <span class="tts-tip tts-error">{errorMsg}</span>
      <button class="tts-btn" on:click={stopReading} title="Dismiss">✕</button>
    {:else if state === 'starting'}
      <span class="tts-spinner" title="Preparing speech…">⏳</span>
    {:else}
      <button
        class="tts-btn tts-play-btn"
        on:click={togglePlay}
        title={state === 'playing' ? 'Pause reading' : 'Read this chapter aloud (AI voice)'}
        aria-label={state === 'playing' ? 'Pause reading' : 'Read aloud'}
      >
        {state === 'playing' ? '⏸' : '🗣'}
      </button>

      {#if state === 'playing' || state === 'paused'}
        <span class="tts-progress">v. {verses[currentIndex]?.verse ?? '–'} / {verses[verseCount - 1]?.verse ?? verseCount}</span>
        <button class="tts-btn" on:click={stopReading} title="Stop reading">■</button>
        <button
          class="tts-btn tts-continuous-btn"
          class:tts-continuous-active={$continuousPlay}
          on:click={() => continuousPlay.update((v) => !v)}
          title={$continuousPlay ? 'Auto-advance: on (click to turn off)' : 'Auto-advance to next chapter'}
          aria-label="Toggle continuous play"
        >↠</button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .tts-player {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    vertical-align: middle;
  }

  .tts-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    color: #aaa;
    transition: color 0.15s, background 0.15s;
  }

  .tts-play-btn {
    color: #9d7af5;
    font-size: 0.9rem;
  }

  .tts-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .tts-download-btn {
    background: rgba(157, 122, 245, 0.15);
    border: 1px solid rgba(157, 122, 245, 0.4);
    border-radius: 4px;
    color: #b79df7;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 3px 8px;
    transition: background 0.15s;
  }

  .tts-download-btn:hover {
    background: rgba(157, 122, 245, 0.3);
  }

  .tts-progress {
    font-size: 0.7rem;
    color: #888;
    font-variant-numeric: tabular-nums;
  }

  .tts-spinner {
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .tts-tip {
    font-size: 0.7rem;
    color: #777;
    font-style: italic;
  }

  .tts-error {
    color: #e06c75;
  }

  .tts-continuous-btn {
    font-size: 0.85rem;
    opacity: 0.5;
  }

  .tts-continuous-active {
    color: #9d7af5;
    opacity: 1;
  }

  @media (max-width: 480px) {
    .tts-player {
      height: 40px;
      gap: 8px;
    }
    .tts-btn {
      font-size: 1.4rem;
      padding: 4px 10px;
    }
    .tts-play-btn {
      font-size: 1.4rem;
    }
    .tts-continuous-btn {
      font-size: 1.4rem;
    }
    .tts-progress {
      font-size: 0.85rem;
    }
  }
</style>
