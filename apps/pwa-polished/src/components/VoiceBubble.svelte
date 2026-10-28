<script lang="ts">
  /**
   * How a voice command is going, beside the mic button that was held: the mic
   * starting, listening (with a level dot), working, then what was heard and
   * done for a few seconds. "Did you mean…?" and replies come as notices, so
   * then it shows only what was heard. A tap puts it away.
   *
   * Above the button when there is room, below it otherwise. The try row in
   * Settings shows its own lines, so it gets none.
   */
  import { tick } from 'svelte';
  import { portal } from '../lib/portal';
  import BrandSpinner from './BrandSpinner.svelte';
  import { talk, dismissTalk } from '../lib/voice/holdToTalk';
  import { voiceLoadStage } from '../lib/voice/voiceControl';

  const GAP = 10;
  const EDGE = 8;

  let el: HTMLDivElement | null = null;
  let left = 0;
  let top = 0;
  let ready = false;

  $: visible = $talk.phase !== 'idle' && $talk.source !== 'settings' && !!$talk.anchor;
  $: listening = $talk.phase === 'listening' && !$talk.off;
  $: outcome = $talk.phase === 'shown' ? $talk.outcome : null;

  /** `_watch`: what it says, passed only so Svelte places it again when that changes. */
  async function place(..._watch: unknown[]) {
    await tick();
    const a = $talk.anchor;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), Math.max(EDGE, window.innerWidth - w - EDGE));
    top = r.top - h - GAP >= EDGE ? r.top - h - GAP : Math.min(r.bottom + GAP, window.innerHeight - h - EDGE);
    ready = true;
  }

  // Placed again whenever what it says changes, as its size does.
  $: if (visible) void place($talk.phase, $talk.status, $talk.outcome, $voiceLoadStage);
  $: if (!visible) ready = false;
</script>

<svelte:window on:resize={() => visible && void place()} />

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={el}
    use:portal
    class="vbub"
    class:off={$talk.off}
    class:shown={$talk.phase === 'shown'}
    style="left: {left}px; top: {top}px; visibility: {ready ? 'visible' : 'hidden'};"
    role="status"
    aria-live="polite"
    on:click={dismissTalk}
  >
    {#if $talk.phase === 'working'}
      <span class="line"><BrandSpinner size={16} /> {$voiceLoadStage ?? $talk.status}</span>
    {:else if outcome}
      <span class="heard">“{outcome.heard || '…'}”</span>
      {#if outcome.plan.kind === 'act'}
        {#each outcome.done as line}<span class="did">{line}</span>{/each}
      {/if}
    {:else}
      <span class="line">
        {#if listening}<span class="dot" style="--level: {$talk.level}" aria-hidden="true"></span>{/if}
        {$talk.status}
      </span>
    {/if}
  </div>
{/if}

<style>
  .vbub {
    --s: var(--bar-scale, 1);
    position: fixed;
    /* Over the mic button, under notices. */
    z-index: 10056;
    display: flex;
    flex-direction: column;
    gap: calc(2px * var(--s));
    max-width: min(calc(100vw - 16px), calc(300px * var(--s)));
    padding: calc(7px * var(--s)) calc(12px * var(--s));
    background: #1c1c1e;
    color: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(230, 184, 74, 0.35);
    border-radius: calc(12px * var(--s));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    font-size: calc(13px * var(--s));
    line-height: 1.35;
    overflow-wrap: anywhere;
    /* The finger is on the button while it talks; only a finished one takes a tap. */
    pointer-events: none;
  }

  .vbub.shown {
    pointer-events: auto;
    cursor: pointer;
  }

  .vbub.off {
    border-color: rgba(255, 255, 255, 0.2);
    color: #bbb;
  }

  .line {
    display: flex;
    align-items: center;
    gap: calc(6px * var(--s));
  }

  .dot {
    flex-shrink: 0;
    width: calc(8px * var(--s));
    height: calc(8px * var(--s));
    border-radius: 50%;
    background: #e6b84a;
    box-shadow: 0 0 0 calc(var(--level, 0) * 6px) rgba(230, 184, 74, 0.35);
  }

  .heard {
    color: #ddd;
  }

  .did {
    color: #8bc34a;
  }
</style>
