<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { getChapterAudio, isAudioAvailable } from '../adapters/audio.js';
  import { continuousPlay, autoplayNext } from '../stores/audioStore.js';

  const dispatch = createEventDispatcher<{ nextchapter: { book: string; chapter: number } }>();

  export let book: string;
  export let chapter: number;

  type PlayerState = 'idle' | 'checking' | 'unavailable' | 'loading' | 'playing' | 'paused' | 'error';

  let state: PlayerState = 'idle';
  let audio: HTMLAudioElement | null = null;
  let currentTime = 0;
  let duration = 0;
  let blobUrl: string | null = null;
  let errorMsg = '';

  // Auto-play if previous chapter ended in continuous mode
  onMount(() => {
    if (get(autoplayNext)) {
      autoplayNext.set(false);
      togglePlay();
    }
  });

  // Clean up on component destroy
  onDestroy(() => {
    _cleanup();
  });

  function _cleanup() {
    if (audio) {
      audio.onerror = null;
      audio.ontimeupdate = null;
      audio.onloadedmetadata = null;
      audio.onended = null;
      audio.pause();
      audio.src = '';
      audio = null;
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    currentTime = 0;
    duration = 0;
  }

  async function togglePlay() {
    if (state === 'playing') {
      audio?.pause();
      state = 'paused';
      return;
    }

    if (state === 'paused' && audio) {
      await audio.play();
      state = 'playing';
      return;
    }

    // Check availability first
    state = 'checking';
    const available = await isAudioAvailable(book, chapter);
    if (!available) {
      state = 'unavailable';
      return;
    }

    // Load the audio
    state = 'loading';
    try {
      _cleanup();
      blobUrl = await getChapterAudio(book, chapter);
      if (!blobUrl) {
        state = 'unavailable';
        return;
      }

      audio = new Audio(blobUrl);
      audio.ontimeupdate = () => { currentTime = audio!.currentTime; };
      audio.onloadedmetadata = () => { duration = audio!.duration; };
      audio.onended = () => {
        if (get(continuousPlay)) {
          autoplayNext.set(true);
          dispatch('nextchapter', { book, chapter });
        } else {
          state = 'idle';
          currentTime = 0;
        }
      };
      audio.onerror = () => { state = 'error'; errorMsg = 'Audio playback failed.'; };

      await audio.play();
      state = 'playing';
    } catch (e: any) {
      state = 'error';
      errorMsg = e?.message ?? 'Unknown error';
    }
  }

  function stop() {
    _cleanup();
    state = 'idle';
  }

  function seek(e: Event) {
    const input = e.target as HTMLInputElement;
    if (audio) {
      audio.currentTime = parseFloat(input.value);
    }
  }

  function formatTime(secs: number): string {
    if (!isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
</script>

<div class="audio-player" class:active={state === 'playing' || state === 'paused'}>
  {#if state === 'unavailable'}
    <span class="audio-tip">Install BSB Audio from Packs to enable audio</span>
  {:else if state === 'error'}
    <span class="audio-tip audio-error">{errorMsg}</span>
    <button class="audio-btn" on:click={stop} title="Dismiss">✕</button>
  {:else if state === 'loading' || state === 'checking'}
    <span class="audio-spinner" title="Loading audio…">⏳</span>
  {:else}
    <button
      class="audio-btn play-btn"
      on:click={togglePlay}
      title={state === 'playing' ? 'Pause' : 'Play chapter audio'}
      aria-label={state === 'playing' ? 'Pause' : 'Play'}
    >
      {state === 'playing' ? '⏸' : '▶'}
    </button>

    {#if state === 'playing' || state === 'paused'}
      <span class="audio-time">{formatTime(currentTime)}</span>
      <input
        class="audio-seek"
        type="range"
        min="0"
        max={duration || 0}
        step="1"
        value={currentTime}
        on:input={seek}
        aria-label="Seek"
      />
      <span class="audio-time">{formatTime(duration)}</span>
      <button class="audio-btn stop-btn" on:click={stop} title="Stop">■</button>
      <button
        class="audio-btn continuous-btn"
        class:continuous-active={$continuousPlay}
        on:click={() => continuousPlay.update(v => !v)}
        title={$continuousPlay ? 'Auto-advance: on (click to turn off)' : 'Auto-advance to next chapter'}
        aria-label="Toggle continuous play"
      >↠</button>
    {/if}
  {/if}
</div>

<style>
  .audio-player {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    vertical-align: middle;
  }

  .audio-btn {
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

  .play-btn {
    color: #7ab8f5;
    font-size: 0.9rem;
  }

  .audio-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .audio-seek {
    width: 120px;
    cursor: pointer;
    accent-color: #7ab8f5;
    height: 4px;
  }

  .audio-time {
    font-size: 0.7rem;
    color: #888;
    font-variant-numeric: tabular-nums;
    min-width: 2.8ch;
  }

  .audio-spinner {
    font-size: 0.85rem;
    opacity: 0.7;
  }

  .audio-tip {
    font-size: 0.7rem;
    color: #777;
    font-style: italic;
  }

  .audio-error {
    color: #e06c75;
  }

  .continuous-btn {
    font-size: 0.85rem;
    opacity: 0.5;
  }

  .continuous-active {
    color: #7ab8f5;
    opacity: 1;
  }

  @media (max-width: 480px) {
    .audio-player {
      height: 40px;
      gap: 8px;
    }
    .audio-btn {
      font-size: 1.4rem;
      padding: 4px 10px;
    }
    .play-btn {
      font-size: 1.4rem;
    }
    .continuous-btn {
      font-size: 1.4rem;
    }
    .audio-time {
      font-size: 0.85rem;
    }
    .audio-seek {
      width: 100px;
      height: 6px;
    }
  }
</style>
