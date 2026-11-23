<script lang="ts">
  /**
   * The screen you meet after tapping a wake alarm.
   *
   * Reading never begins on its own — you press start. That is a deliberate
   * choice, not a limitation: waking to a voice you did not trigger is worse
   * than pressing one button, and a real tap is also the one thing every
   * browser accepts as permission to play audio.
   *
   * The press speaks at once because the first stretch of the reading is
   * already made: saved ahead of time (lib/alarm/alarmOpening.ts), or made
   * here while the screen waits when nothing fitting was saved. "Ready" shows
   * only once that opening really exists. The voice starts loading the moment
   * the screen opens, so the part after the opening is ready sooner.
   */
  import { onDestroy } from "svelte";
  import { SpeakerHigh } from "phosphor-svelte";
  import { fade } from "../lib/motion";
  import { navigationStore } from "../stores/navigationStore";
  import { wakeAlarmStartOpen } from "../stores/wakeAlarmStore";
  import { continuousPlay } from "../stores/audioStore";
  import { startReading, makeOpening, openingReady } from "../lib/tts/readingEngine";
  import { resolveAlarmPassage, type AlarmPassage } from "../lib/alarm/resolvePassage";
  import { synthesizeSpeech, isVoiceInstalled, isTtsSupported } from "../adapters/tts";
  import { getTtsSettings } from "../adapters/settings";

  /**
   * How much is made live when nothing fitting was saved. Less than the saved
   * minute, so "Ready" comes sooner; the voice is warm by then, so the engine
   * keeps ahead of it.
   */
  const LIVE_OPENING_SECONDS = 20;

  let passage: AlarmPassage | null = null;
  let greeting = "Good morning";
  let warm: "idle" | "warming" | "ready" | "no-voice" = "idle";
  let clock = "";
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  /** Bumped on every open and close, so an earlier open's slow work can't change this one. */
  let openCount = 0;

  function timeGreeting(hour: number): string {
    if (hour < 5) return "Still up";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function updateClock() {
    const now = new Date();
    clock = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    greeting = timeGreeting(now.getHours());
  }

  // Only when the screen opens. It is mounted on every launch, and warming up
  // in onMount loaded the 310 MB voice on every launch, alarm or not.
  $: if ($wakeAlarmStartOpen) opened();
  else closed();

  function opened() {
    const id = ++openCount;
    passage = resolveAlarmPassage();
    updateClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 20_000);
    warm = "idle";
    void prepare(id);
  }

  function closed() {
    openCount++;
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  onDestroy(closed);

  /** Have an opening ready for the press: the saved one, or one made now. */
  async function prepare(id: number) {
    if (!passage || !isTtsSupported()) return;
    const { book, chapter } = passage;
    const translation = $navigationStore.translation;
    const voiceId = getTtsSettings().voiceId;
    const current = () => id === openCount;

    try {
      if (!(await isVoiceInstalled(voiceId))) {
        if (current()) warm = "no-voice";
        return;
      }
      // Load the voice now, so what comes after the opening is made sooner.
      // The audio is thrown away; loading the model is the point.
      void synthesizeSpeech("Good morning.", voiceId).catch(() => {});

      if (await openingReady(translation, book, chapter)) {
        if (current()) warm = "ready";
        return;
      }
      if (!current()) return;
      warm = "warming";
      const made = await makeOpening(translation, book, chapter, LIVE_OPENING_SECONDS);
      if (current()) warm = made ? "ready" : "idle";
    } catch {
      // Pressing still works; it just starts the ordinary way.
      if (current()) warm = "idle";
    }
  }

  function start() {
    if (!passage) return;

    // Keep rolling into the next chapter rather than stopping after one.
    continuousPlay.set(true);

    // Straight to the engine — it owns the position and does not care whether
    // the chapter is on screen. Called synchronously inside the tap so the
    // audio element is unlocked for every later chapter handoff.
    void startReading($navigationStore.translation, passage.book, passage.chapter);

    close();
  }

  function openWithoutReading() {
    if (passage) {
      navigationStore.navigateTo($navigationStore.translation, passage.book, passage.chapter);
      navigationStore.setLinkHighlight(passage.book, passage.chapter, 1);
    }
    close();
  }

  function close() {
    wakeAlarmStartOpen.set(false);
  }
</script>

{#if $wakeAlarmStartOpen}
  <div class="alarm-screen" transition:fade={{ duration: 200 }}>
    <div class="alarm-inner">
      <div class="clock">{clock}</div>
      <h1>{greeting}</h1>

      {#if passage}
        <p class="passage">{passage.label}</p>
        <p class="because">{passage.because}</p>

        <button class="start-btn" on:click={start}>
          <span class="start-icon"><SpeakerHigh size="1em" weight="bold" /></span>
          Start reading
        </button>

        {#if warm === "no-voice"}
          <p class="warm-note">
            The Read Aloud voice isn't downloaded on this device, so it will open
            for reading instead of speaking.
          </p>
        {:else if warm === "warming"}
          <p class="warm-note">Getting the reading ready…</p>
        {:else if warm === "ready"}
          <p class="warm-note warm-ready">Ready — starts the moment you press.</p>
        {/if}

        <button class="secondary-btn" on:click={openWithoutReading}>
          Just open it, don't read
        </button>
      {:else}
        <p class="passage">…</p>
      {/if}

      <button class="dismiss-btn" on:click={close}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .alarm-screen {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: radial-gradient(circle at 50% 30%, #1c1c28 0%, #0d0d12 70%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    /* Sits above everything, including panes and modals. */
  }

  .alarm-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 420px;
    width: 100%;
  }

  .clock {
    font-size: 1.1rem;
    color: #6d6d80;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 300;
    color: #f0f0f5;
    margin: 0 0 2rem;
    letter-spacing: -0.01em;
  }

  .passage {
    font-size: 2.6rem;
    font-weight: 700;
    color: #fff;
    margin: 0;
    line-height: 1.1;
    text-wrap: balance;
  }

  .because {
    font-size: 0.9rem;
    color: #7a7a90;
    margin: 0.6rem 0 2.5rem;
  }

  .start-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.7rem;
    width: 100%;
    padding: 1.35rem 2rem;
    font-size: 1.25rem;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 6px 24px rgba(102, 126, 234, 0.35);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .start-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 32px rgba(102, 126, 234, 0.45);
  }
  .start-btn:active { transform: translateY(0); }

  .start-icon { font-size: 1.4rem; line-height: 1; display: flex; }

  .warm-note {
    font-size: 0.78rem;
    color: #6d6d80;
    margin: 0.9rem 0 0;
    line-height: 1.5;
    min-height: 1.2em;
  }
  .warm-ready { color: #5f9d78; }

  .secondary-btn {
    margin-top: 2rem;
    padding: 0.7rem 1.4rem;
    font-size: 0.9rem;
    color: #9a9ab0;
    background: transparent;
    border: 1px solid #33334a;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .secondary-btn:hover {
    color: #d0d0e0;
    border-color: #4a4a68;
  }

  .dismiss-btn {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
    font-size: 0.82rem;
    color: #5a5a70;
    background: none;
    border: none;
    cursor: pointer;
  }
  .dismiss-btn:hover { color: #8a8aa0; }

  @media (max-height: 560px) {
    h1 { font-size: 1.5rem; margin-bottom: 1.2rem; }
    .passage { font-size: 2rem; }
    .because { margin-bottom: 1.5rem; }
    .start-btn { padding: 1.1rem 1.6rem; }
  }
</style>
