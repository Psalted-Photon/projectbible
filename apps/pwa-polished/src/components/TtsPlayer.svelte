<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { IndexedDBTextStore } from '../lib/adapters.js';
  import { extractSpeechText } from '../lib/verseRendering.js';
  import { continuousPlay, ttsAutoplayNext, ttsCurrentVerse, ttsStartRequest } from '../stores/audioStore.js';
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
  import {
    sleepRemaining,
    stopAtChapterEnd,
    sleepStopNonce,
    startSleepTimer,
    setStopAtChapterEnd,
    cancelSleepTimer,
    remainingMinutes,
  } from '../lib/tts/sleepTimer.js';

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

  // The wake alarm asks for a chapter by name rather than relying on a fresh
  // mount, because "continue where you left off" is usually the chapter already
  // on screen. Subscribing fires immediately with the current value, so this
  // covers both an already-mounted player and one that has just appeared.
  const unsubscribeStartRequest = ttsStartRequest.subscribe((request) => {
    if (!request || request.book !== book || request.chapter !== chapter) return;
    ttsStartRequest.set(null);
    startReading();
  });

  // The sleep timer runs the clock; only the player can tear down its queue and
  // caches, so it asks us to stop rather than doing it itself. Skip the value
  // present at subscribe time — that is history, not a fresh request.
  let lastStopNonce = get(sleepStopNonce);
  const unsubscribeSleepStop = sleepStopNonce.subscribe((nonce) => {
    if (nonce === lastStopNonce) return;
    lastStopNonce = nonce;
    if (ownsAudio()) stopReading();
  });

  onDestroy(() => {
    unsubscribeStartRequest();
    unsubscribeSleepStop();
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
      } else if (get(stopAtChapterEnd)) {
        // "End of chapter" beats auto-advance — that is the whole point of it.
        cancelSleepTimer();
        stopReading();
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
    ttsCurrentVerse.set({ book, chapter, verse: verses[index].verse });
    // Keep one verse ahead of playback
    ensureSynth(index + 1, gen);
  }

  // ── sleep timer ───────────────────────────────────────────────────────────

  $: sleepArmed = $sleepRemaining !== null || $stopAtChapterEnd;
  $: sleepLabel = $stopAtChapterEnd
    ? '⏱ chapter'
    : $sleepRemaining !== null
      ? `⏱ ${remainingMinutes($sleepRemaining)}m`
      : '⏱';
  // The select shows the armed state as its value, so it reads as a status too.
  $: sleepChoice = sleepArmed ? 'keep' : '0';

  function applySleepChoice(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value === 'keep') return;
    if (value === '0') cancelSleepTimer();
    else if (value === 'chapter') setStopAtChapterEnd();
    else startSleepTimer(parseInt(value, 10));
  }

  /** Pressing stop is a decision to be done — it disarms the timer too. */
  function handleUserStop(): void {
    cancelSleepTimer();
    stopReading();
  }

  /**
   * Jump to another verse in the chapter without restarting the queue.
   * Bumping the generation cancels in-flight work for the old position;
   * already-synthesized verses stay cached, so jumping back is instant.
   */
  async function jumpToVerse(index: number): Promise<void> {
    if (index < 0 || index >= verses.length) return;
    if (ownsAudio()) {
      const audio = getSharedTtsAudio();
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    const gen = ++generation;
    await playIndex(index, gen);
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
    const wasOwner = ownsAudio();
    if (wasOwner) {
      const audio = getSharedTtsAudio();
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      delete (audio as any).__ttsOwner;
    }
    // Only the instance that was actually speaking clears the shared marker —
    // other mounted chapters tearing down must not blank a live read.
    if (wasOwner) ttsCurrentVerse.set(null);
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
        <select
          class="tts-verse-picker"
          bind:value={currentIndex}
          on:change={() => jumpToVerse(currentIndex)}
          title="Jump to a verse"
          aria-label="Jump to a verse"
        >
          {#each verses as v, i}
            <option value={i}>v. {v.verse}</option>
          {/each}
        </select>
        <span class="tts-progress">/ {verses[verseCount - 1]?.verse ?? verseCount}</span>
        <button class="tts-btn" on:click={handleUserStop} title="Stop reading">■</button>
        <button
          class="tts-btn tts-continuous-btn"
          class:tts-continuous-active={$continuousPlay}
          on:click={() => continuousPlay.update((v) => !v)}
          title={$continuousPlay ? 'Auto-advance: on (click to turn off)' : 'Auto-advance to next chapter'}
          aria-label="Toggle continuous play"
        >↠</button>
        <select
          class="tts-sleep-picker"
          class:tts-sleep-armed={sleepArmed}
          bind:value={sleepChoice}
          on:change={applySleepChoice}
          title={sleepArmed ? 'Sleep timer running — fades out and stops' : 'Sleep timer'}
          aria-label="Sleep timer"
        >
          {#if sleepArmed}
            <option value="keep">{sleepLabel}</option>
          {/if}
          <option value="0">{sleepArmed ? 'Off' : '⏱'}</option>
          <option value="10">10 min</option>
          <option value="20">20 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
          <option value="chapter">End of chapter</option>
        </select>
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

  /* Styled to read like the old text readout, but it's a real picker. */
  .tts-verse-picker {
    background: transparent;
    border: 1px solid rgba(157, 122, 245, 0.35);
    border-radius: 4px;
    color: #b79df7;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    padding: 1px 4px;
    cursor: pointer;
    max-width: 8ch;
  }

  .tts-verse-picker:hover {
    border-color: rgba(157, 122, 245, 0.7);
  }

  /* Same picker treatment as the verse jump, but muted until it is armed —
     an unset timer should not compete with the playback controls. */
  .tts-sleep-picker {
    background: transparent;
    border: 1px solid rgba(157, 122, 245, 0.2);
    border-radius: 4px;
    color: #7a7a8a;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    padding: 1px 4px;
    cursor: pointer;
    max-width: 10ch;
  }
  .tts-sleep-picker:hover {
    border-color: rgba(157, 122, 245, 0.6);
    color: #b79df7;
  }
  .tts-sleep-armed {
    border-color: rgba(157, 122, 245, 0.55);
    color: #b79df7;
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
    .tts-verse-picker {
      font-size: 0.85rem;
      padding: 3px 6px;
    }
    .tts-sleep-picker {
      font-size: 0.85rem;
      padding: 3px 6px;
    }
  }
</style>
