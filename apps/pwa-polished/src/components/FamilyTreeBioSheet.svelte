<script lang="ts">
  /**
   * The bio, in a sheet over the tree.
   *
   * Hosts the real People card, PersonContent, in its `hosted` mode — no
   * host has used that mode before this, so this sheet supplies everything
   * it removes: the background colour, the scrolling, and the padding
   * `hosted` clears from `.person-body` and `.person-footer`.
   *
   * The `{#key}` block is what gives a walk through the bio its own fresh
   * back trail each time the TREE moves the person under it — see
   * `bumpKey`'s own note below for why that has to be a decision the caller
   * makes, not something this component can infer from the id alone.
   */
  import PersonContent from './PersonContent.svelte';
  import type { PersonRecord } from '../adapters/lexicon-lookup.js';

  /** The person to show, and a counter the viewer bumps to force a fresh
   *  PersonContent instance. Both must be set together, in the same tick —
   *  see the viewer's own note on why a tree tap and a relative-walk treat
   *  this counter differently. */
  export let personId: string | null;
  export let instanceKey: number;
  /** The tree's own label for `personId`, so the header has a name to show
   *  before PersonContent's own load resolves — see personLabel below. */
  export let fallbackLabel: string;
  export let onOpenPerson: (id: string, name: string) => void;
  export let onShowOnTree: (id: string) => void;
  /** The verse exit — tapping a verse inside the bio. */
  export let onClose: () => void;
  export let onBackToTree: () => void;

  const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let shown: PersonRecord | null = null;

  /**
   * The header's name.
   *
   * Every `{#key}` remount fires PersonContent's onPersonChange(null) before
   * the new person has loaded, which would otherwise blank the header for a
   * beat on every tree tap. `fallbackLabel` — the label the TREE already
   * has for this id, no fetch required — covers that gap; `shown` (PersonContent's
   * own onPersonChange) takes over the moment it has better information,
   * such as a display title the plain tree label doesn't carry.
   */
  $: personLabel = shown?.displayTitle || shown?.name || fallbackLabel;

  function handlePersonChange(p: PersonRecord | null) {
    // A null here means "not loaded yet", not "nobody" — ignored rather than
    // clearing what's already shown, so the header never flashes empty.
    if (p) shown = p;
  }
</script>

<div class="sheet-root" class:reduced={REDUCED_MOTION}>
  <div class="sheet-head">
    <div class="handle" aria-hidden="true"></div>
    <div class="sheet-head-row">
      <span class="sheet-name">{personLabel}</span>
      <button class="back-btn" on:click={onBackToTree}>✕ Back to tree</button>
    </div>
  </div>
  <div class="sheet-body">
    {#if personId}
      {#key instanceKey}
        <PersonContent
          {personId}
          showHeader={false}
          showTurns={false}
          {onOpenPerson}
          {onShowOnTree}
          {onClose}
          onPersonChange={handlePersonChange}
        />
      {/key}
    {/if}
  </div>
</div>

<style>
  .sheet-root {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: var(--background-color, #1e1e1e);
    border-top: 1px solid var(--border-color, #333);
    box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.4);
    /* 62% of the screen tall on a phone — see the media query below for the
       760px+ override, which replaces this whole positioning block. */
    height: 62vh;
    border-radius: 14px 14px 0 0;
    animation: slide-up 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .sheet-root.reduced {
    animation: none;
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .sheet-head {
    flex-shrink: 0;
    padding: 8px 18px 10px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .handle {
    width: 34px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-color, #444);
    margin: 0 auto 8px;
  }
  .sheet-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .sheet-name {
    font-family: Milonga, serif;
    font-size: 17px;
    color: var(--text-color, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .back-btn {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--border-color, #444);
    border-radius: 14px;
    color: var(--text-muted, #999);
    font-family: inherit;
    font-size: 12px;
    padding: 5px 11px;
    cursor: pointer;
  }
  .back-btn:hover {
    color: var(--text-color, #fff);
    border-color: var(--color-primary, #4a90e2);
  }

  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* hosted mode clears PersonContent's own .person-body padding entirely
       (it neither scrolls nor pads there), so the sheet supplies both. */
    padding: 12px 18px;
  }

  /* At 760px and wider: a 420px panel on the right, below the top buttons,
     so the tree's Close stays visible above it. Every positioning rule from
     the phone layout is undone here, not just overridden in part, or the
     sheet stays pinned to the bottom of a screen wide enough for the panel. */
  @media (min-width: 760px) {
    .sheet-root {
      left: auto;
      right: calc(env(safe-area-inset-right, 0px) + 12px);
      top: calc(env(safe-area-inset-top, 0px) + 58px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
      width: 420px;
      height: auto;
      border-radius: 10px;
      border-top: 1px solid var(--border-color, #333);
      animation: slide-in-right 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .sheet-root.reduced {
      animation: none;
    }
  }
  @keyframes slide-in-right {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>
