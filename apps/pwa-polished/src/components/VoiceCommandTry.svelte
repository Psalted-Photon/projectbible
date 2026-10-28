<script lang="ts">
  /**
   * Try a voice command, here in Dev Options until the floating mic button
   * comes: hold to talk (release to run, slide off to cancel), or type what
   * you'd say. Either way the app really does it, and the lines below say
   * what was heard and what was done.
   */
  import { onMount } from 'svelte';
  import { Microphone } from 'phosphor-svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import { VOICE_DOWNLOADS_EVENT, voiceDownloadState } from '../lib/voice/voicePack';
  import { VoiceTake, micTrouble } from '../lib/voice/mic';
  import {
    hearCommand,
    typedCommand,
    voiceGesture,
    voiceLoadStage,
    type VoiceOutcome,
  } from '../lib/voice/voiceControl';

  let installed: boolean | null = null;
  let typed = '';
  let busy = false;
  let holding = false;
  let off = false;
  /** The mic is open and hearing; until then, speaking would be lost. */
  let ready = false;
  let level = 0;
  let status = '';
  let outcome: VoiceOutcome | null = null;
  let take: VoiceTake | null = null;
  let button: HTMLButtonElement;

  async function check() {
    installed = (await voiceDownloadState('voice-control').catch(() => null))?.installed ?? false;
  }

  onMount(() => {
    void check();
    const again = () => void check();
    window.addEventListener(VOICE_DOWNLOADS_EVENT, again);
    return () => {
      window.removeEventListener(VOICE_DOWNLOADS_EVENT, again);
      take?.cancel();
    };
  });

  async function run(go: () => Promise<VoiceOutcome>) {
    busy = true;
    status = 'Working…';
    try {
      outcome = await go();
      status = '';
    } catch (error) {
      outcome = null;
      status = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  function submit() {
    const text = typed.trim();
    if (!text || busy) return;
    voiceGesture();
    void run(() => typedCommand(text));
  }

  async function press(e: PointerEvent) {
    if (busy || holding || e.button > 0) return;
    e.preventDefault();
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Fine without it.
    }
    voiceGesture();
    holding = true;
    off = false;
    ready = false;
    status = 'Starting the mic…';
    const t = new VoiceTake();
    take = t;
    try {
      await t.start({ onLevel: (l) => (level = l), onFull: () => void release() });
      if (take !== t) return;
      ready = true;
      if (!off) status = 'Listening… slide off to cancel';
    } catch (error) {
      if (take && take !== t) return;
      holding = false;
      take = null;
      status = micTrouble(error);
    }
  }

  function move(e: PointerEvent) {
    if (!holding) return;
    const r = button.getBoundingClientRect();
    const m = 28;
    const out = e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m;
    if (out !== off) {
      off = out;
      status = off ? 'Let go to cancel' : ready ? 'Listening… slide off to cancel' : 'Starting the mic…';
    }
  }

  async function release() {
    if (!holding || !take) return;
    const t = take;
    take = null;
    holding = false;
    level = 0;
    if (off) {
      t.cancel();
      status = 'Cancelled.';
      return;
    }
    const pcm = await t.finish();
    if (!pcm) {
      status = 'Too short. Hold the button the whole time you speak.';
      return;
    }
    await run(() => hearCommand(pcm));
  }

  function cancel() {
    if (!holding) return;
    take?.cancel();
    take = null;
    holding = false;
    level = 0;
    status = 'Cancelled.';
  }
</script>

{#if installed === false}
  <p class="vt-note">Download Voice Control above to try a command.</p>
{:else if installed}
  <div class="vt">
    <div class="vt-row">
      <button
        type="button"
        class="vt-hold"
        class:live={holding && ready && !off}
        class:cancel={holding && off}
        disabled={busy}
        bind:this={button}
        on:pointerdown={press}
        on:pointermove={move}
        on:pointerup={release}
        on:pointercancel={cancel}
        on:contextmenu|preventDefault
        style={`--level: ${level}`}
      >
        <Microphone size={18} weight="bold" />
        <span>{holding ? (ready ? 'Listening' : 'Wait…') : 'Hold to talk'}</span>
      </button>
      <form class="vt-typed" on:submit|preventDefault={submit}>
        <input
          type="text"
          bind:value={typed}
          placeholder="Or type a command"
          enterkeyhint="go"
          disabled={busy}
          aria-label="Type a command"
        />
        <button type="submit" disabled={busy || !typed.trim()}>Run</button>
      </form>
    </div>

    {#if $voiceLoadStage || busy || status}
      <p class="vt-status">
        {#if $voiceLoadStage || busy}<BrandSpinner size={16} />{/if}
        {$voiceLoadStage ?? status}
      </p>
    {/if}

    {#if outcome && !busy}
      <div class="vt-out">
        <p class="vt-heard">“{outcome.heard || '…'}”</p>
        {#if outcome.plan.kind === 'act'}
          {#each outcome.done as line}<p class="vt-did">{line}</p>{/each}
        {:else if outcome.plan.kind === 'ask'}
          <p class="vt-ask">Asked: {outcome.plan.question}</p>
        {:else}
          <p class="vt-reply">{outcome.plan.text ? `Replied: ${outcome.plan.text}` : 'Nothing to do.'}</p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .vt {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .vt-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .vt-hold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 14px;
    border: none;
    border-radius: 20px;
    background: #e6b84a;
    color: #1c1c1e;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .vt-hold.live {
    background: #f0c75e;
    box-shadow: 0 0 0 calc(3px + var(--level, 0) * 9px) rgba(230, 184, 74, 0.35);
  }

  .vt-hold.cancel {
    background: #555;
    color: #eee;
  }

  .vt-hold:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .vt-typed {
    display: flex;
    flex: 1;
    min-width: 200px;
    gap: 6px;
  }

  .vt-typed input {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font: inherit;
    font-size: 0.88rem;
  }

  .vt-typed button {
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .vt-typed button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .vt-status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 0.8rem;
    color: #e6b84a;
  }

  .vt-out p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .vt-heard {
    color: #ddd;
  }

  .vt-did {
    color: #8bc34a;
  }

  .vt-ask {
    color: #e6b84a;
  }

  .vt-reply,
  .vt-note {
    color: #999;
  }

  .vt-note {
    margin: 8px 0 0;
    font-size: 0.8rem;
  }
</style>
