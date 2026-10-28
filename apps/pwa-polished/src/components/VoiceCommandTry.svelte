<script lang="ts">
  /**
   * Try a voice command, in Settings → Voice Control: hold to talk (release to
   * run, slide off to cancel), or type what you'd say. Either way the app
   * really does it, and the lines below say what was heard and what was done.
   *
   * The hold is the mic button's own (lib/voice/holdToTalk.ts), so it asks
   * for the mic the same way; this row shows the result in place of the
   * floating line.
   */
  import { onDestroy } from 'svelte';
  import { Microphone } from 'phosphor-svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import { typedCommand, voiceGesture, voiceLoadStage, type VoiceOutcome } from '../lib/voice/voiceControl';
  import { talk, voiceReady, pressToTalk, moveTalk, releaseTalk, cancelTalk } from '../lib/voice/holdToTalk';

  let typed = '';
  /** A typed command is running. */
  let typing = false;
  let typedStatus = '';
  let outcome: VoiceOutcome | null = null;

  $: mine = $talk.source === 'settings';
  $: holding = mine && ($talk.phase === 'starting' || $talk.phase === 'listening');
  $: ready = mine && $talk.phase === 'listening';
  $: off = holding && $talk.off;
  $: busy = typing || (mine && $talk.phase === 'working');
  // A spoken command's result shows here, like a typed one's.
  $: if (mine && $talk.phase === 'shown' && $talk.outcome) outcome = $talk.outcome;
  $: status = typedStatus || (mine && $talk.phase !== 'idle' && $talk.phase !== 'working' ? $talk.status : '');

  onDestroy(() => {
    if (holding) cancelTalk();
  });

  async function submit() {
    const text = typed.trim();
    if (!text || busy) return;
    voiceGesture();
    typing = true;
    typedStatus = 'Working…';
    try {
      outcome = await typedCommand(text);
      typedStatus = '';
    } catch (error) {
      outcome = null;
      typedStatus = error instanceof Error ? error.message : String(error);
    } finally {
      typing = false;
    }
  }
</script>

{#if $voiceReady.installed === false}
  <p class="vt-note">Download Voice Control above to try a command.</p>
{:else if $voiceReady.installed}
  <div class="vt">
    <div class="vt-row">
      <button
        type="button"
        class="vt-hold"
        class:live={ready && !off}
        class:cancel={off}
        disabled={busy}
        on:pointerdown={(e) => pressToTalk(e, 'settings')}
        on:pointermove={moveTalk}
        on:pointerup={releaseTalk}
        on:pointercancel={cancelTalk}
        on:contextmenu|preventDefault
        style={`--level: ${ready ? $talk.level : 0}`}
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
        {$voiceLoadStage ?? (busy && !typing ? 'Working…' : status)}
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
    padding-top: 8px;
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
