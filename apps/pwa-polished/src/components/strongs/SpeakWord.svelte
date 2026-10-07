<script lang="ts" context="module">
  /** What the line under the header has to say, if anything. */
  export type SpeakStatus =
    | { kind: "voice-needed"; sizeMB: number }
    | { kind: "downloading"; percent: number }
    | { kind: "failed"; text: string }
    | null;
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import { SpeakerHigh } from "phosphor-svelte";
  import {
    readyWordAudio,
    greekVoiceInstalled,
    greekVoiceSizeMB,
    downloadGreekVoice,
    speakGreekWord,
  } from "../../lib/tts/speakWord";

  /**
   * A speaker beside a Greek headword. Says it in the voice and pronunciation
   * chosen in Settings. The voice is a download of its own, so the first tap on
   * a device without it offers it right there rather than sending you off to
   * find it.
   *
   * The host draws `status` as a line under its header, since a word's heading
   * has no room for a sentence, and calls download() from that line.
   */
  export let word: string;
  export let status: SpeakStatus = null;

  let busy = false;
  let failTimer: ReturnType<typeof setTimeout> | null = null;

  async function speak() {
    if (busy || status?.kind === "downloading") return;
    readyWordAudio();
    // A second tap while the offer is up puts it away.
    if (status?.kind === "voice-needed") {
      status = null;
      return;
    }
    busy = true;
    try {
      if (!(await greekVoiceInstalled())) {
        status = { kind: "voice-needed", sizeMB: greekVoiceSizeMB() };
        return;
      }
      await say();
    } finally {
      busy = false;
    }
  }

  async function say() {
    try {
      status = null;
      await speakGreekWord(word);
    } catch (err) {
      console.warn(`🔊 could not speak "${word}":`, err);
      fail(`Couldn’t say ${word} cleanly — nothing played.`);
    }
  }

  /** Fetch the voice, then say the word it was fetched for. */
  export async function download() {
    readyWordAudio();
    status = { kind: "downloading", percent: 0 };
    try {
      await downloadGreekVoice((percent) => (status = { kind: "downloading", percent }));
    } catch (err) {
      console.warn("🔊 Greek voice download failed:", err);
      fail("The Greek voice didn’t download. Tap the speaker to try again.");
      return;
    }
    busy = true;
    await say();
    busy = false;
  }

  function fail(text: string) {
    status = { kind: "failed", text };
    if (failTimer) clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      if (status?.kind === "failed") status = null;
    }, 3000);
  }

  onDestroy(() => {
    if (failTimer) clearTimeout(failTimer);
  });
</script>

<button
  class="speak-btn"
  class:busy
  on:click={speak}
  title="Say it aloud"
  aria-label="Say {word} aloud"
>
  <SpeakerHigh size={18} weight="duotone" />
</button>

<style>
  .speak-btn {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-left: calc(6px * var(--bar-scale, 1));
    padding: calc(3px * var(--bar-scale, 1));
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-muted, #999);
    cursor: pointer;
  }
  .speak-btn:hover {
    color: #34d399;
  }
  /* Saying a word takes a moment; the speaker glows while it works. */
  .speak-btn.busy {
    color: #34d399;
    opacity: 0.6;
  }
  .speak-btn :global(svg) {
    width: calc(18px * var(--bar-scale, 1));
    height: calc(18px * var(--bar-scale, 1));
  }
</style>
