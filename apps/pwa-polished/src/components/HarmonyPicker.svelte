<script lang="ts">
  /**
   * The modal behind the Harmonies tile: choose what to lay side by side.
   *
   * Two ways in, on two tabs, because they answer different questions. "Sets"
   * answers "show me these books together" and opens at a sensible place. The
   * "Harmony" contents answers "show me this event" — Robertson's 185 titled
   * sections, in his order, under his own part titles — and opens exactly there
   * with only the Gospels that carry it.
   *
   * Nothing is created until the user picks. The modal dispatches the choice and
   * the view does the rest, so backing out of here costs nothing.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import {
    HARMONY_PARTS,
    PARALLEL_SETS,
    panesForSection,
    type HarmonyEntry,
    type ParallelSet,
  } from '../lib/parallelSets';

  const dispatch = createEventDispatcher<{
    close: void;
    choose: { panes: Array<{ book: string; chapter: number }>; label: string };
  }>();

  let tab: 'sets' | 'harmony' = 'sets';

  /**
   * Which parts are open. All shut to begin with — 185 sections is a long list
   * to land in, and the fourteen part titles alone are a readable contents page.
   */
  let openParts: Record<string, boolean> = {};

  function chooseSet(set: ParallelSet) {
    dispatch('choose', {
      // Only the master opens at the set's chapter. The followers open at
      // chapter 1 and are moved by the engine on the master's first tick, which
      // is the same path they take for every later move — opening them at a
      // guessed chapter would be a second way to position a follower that could
      // disagree with the first.
      panes: set.books.map((book) => ({
        book,
        chapter: book === set.start.book ? set.start.chapter : 1,
      })),
      label: set.label,
    });
  }

  function chooseSection(entry: HarmonyEntry) {
    dispatch('choose', { panes: panesForSection(entry.group), label: entry.title });
  }

  // Captured, so Escape closes the picker rather than reaching the view behind
  // it — which would close the whole harmony instead of this modal.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dispatch('close');
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('hp-backdrop')) dispatch('close');
  }

  onMount(() => window.addEventListener('keydown', handleKeydown, true));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown, true));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="hp-backdrop" on:click={handleBackdropClick}>
  <div class="hp-modal" role="dialog" aria-modal="true" aria-label="Open a harmony">

    <div class="hp-header">
      <span class="hp-title">Harmonies</span>
      <button class="hp-close" on:click={() => dispatch('close')} aria-label="Close">✕</button>
    </div>

    <div class="hp-tabs">
      <button class="hp-tab" class:active={tab === 'sets'} on:click={() => (tab = 'sets')}>Sets</button>
      <button class="hp-tab" class:active={tab === 'harmony'} on:click={() => (tab = 'harmony')}>The Harmony</button>
    </div>

    <div class="hp-body">
      {#if tab === 'sets'}
        <p class="hp-hint">Books that tell the same events, opened together.</p>
        {#each PARALLEL_SETS as set (set.id)}
          <button class="hp-set" on:click={() => chooseSet(set)}>
            <span class="hp-set-label">{set.label}</span>
            <span class="hp-set-blurb">{set.blurb}</span>
            <span class="hp-books">
              {#each set.books as book (book)}<span class="hp-book">{book}</span>{/each}
            </span>
          </button>
        {/each}
      {:else}
        <p class="hp-hint">Robertson &amp; Broadus, <em>A Harmony of the Gospels</em> — 185 sections in order.</p>
        {#each HARMONY_PARTS as part (part.title)}
          <button
            class="hp-part"
            on:click={() => (openParts = { ...openParts, [part.title]: !openParts[part.title] })}
            aria-expanded={!!openParts[part.title]}
          >
            <span class="hp-caret" class:open={openParts[part.title]}>›</span>
            <span class="hp-part-title">{part.title}</span>
            <span class="hp-part-count">{part.entries.length}</span>
          </button>
          {#if openParts[part.title]}
            {#each part.entries as entry (entry.group.id)}
              <button class="hp-entry" on:click={() => chooseSection(entry)}>
                <span class="hp-section">§{entry.section}</span>
                <span class="hp-entry-title">{entry.title}</span>
                <!-- The chips are the "only in Luke" marking: a section showing
                     one chip is material that one Gospel alone carries. -->
                <span class="hp-books">
                  {#each entry.books as book (book)}<span class="hp-book">{book.slice(0, 4)}</span>{/each}
                </span>
              </button>
            {/each}
          {/if}
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .hp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9200;
    padding: 16px;
    box-sizing: border-box;
  }

  .hp-modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 460px;
    max-height: min(80vh, 640px);
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .hp-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .hp-title {
    font-size: 15px;
    font-weight: 600;
    color: #e0e0e0;
    flex: 1;
  }

  .hp-close {
    background: none;
    border: none;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }

  .hp-close:hover {
    color: #e0e0e0;
  }

  .hp-tabs {
    display: flex;
    gap: 4px;
    padding: 10px 12px 0;
    flex-shrink: 0;
  }

  .hp-tab {
    flex: 1;
    padding: 8px 10px;
    background: #232323;
    border: 1px solid #3a3a3a;
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    color: #999;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .hp-tab.active {
    background: #2b2b2b;
    color: #e0e0e0;
    border-color: #4a7c9e;
  }

  .hp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    -webkit-overflow-scrolling: touch;
  }

  .hp-hint {
    margin: 0 0 4px;
    color: #888;
    font-size: 11px;
    line-height: 1.4;
  }

  .hp-set,
  .hp-entry,
  .hp-part {
    display: flex;
    background: #262626;
    border: 1px solid #383838;
    border-radius: 9px;
    color: #e0e0e0;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .hp-set:hover,
  .hp-entry:hover,
  .hp-part:hover {
    background: #2e2e2e;
    border-color: #4a7c9e;
  }

  .hp-set {
    flex-direction: column;
    gap: 4px;
    padding: 11px 12px;
  }

  .hp-set-label {
    font-size: 14px;
    font-weight: 600;
  }

  .hp-set-blurb {
    font-size: 11px;
    color: #999;
    line-height: 1.35;
  }

  .hp-books {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }

  .hp-book {
    padding: 2px 6px;
    background: #333;
    border-radius: 4px;
    font-size: 10px;
    color: #bbb;
    white-space: nowrap;
  }

  /* Parts are the contents page; sections indent under them so a long open part
     still reads as belonging to its heading while you scroll past it. */
  .hp-part {
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: #222;
    font-size: 12px;
    font-weight: 600;
    margin-top: 4px;
  }

  .hp-caret {
    display: inline-block;
    color: #777;
    transition: transform 0.15s;
    font-size: 14px;
    line-height: 1;
  }

  .hp-caret.open {
    transform: rotate(90deg);
  }

  .hp-part-title {
    flex: 1;
  }

  .hp-part-count {
    color: #777;
    font-weight: 400;
    font-size: 11px;
  }

  .hp-entry {
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin-left: 14px;
    background: #242424;
    font-size: 12px;
  }

  .hp-section {
    color: #4a9ec9;
    font-size: 11px;
    min-width: 34px;
    flex-shrink: 0;
  }

  .hp-entry-title {
    flex: 1;
    line-height: 1.3;
  }

  .hp-entry .hp-books {
    margin-top: 0;
    flex-shrink: 0;
    flex-wrap: nowrap;
  }
</style>
