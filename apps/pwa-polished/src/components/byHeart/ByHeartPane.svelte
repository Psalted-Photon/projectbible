<script lang="ts">
  /**
   * The By Heart window: a Today button over the saved verses, each with its
   * small card, score and next date.
   */
  import { onDestroy, onMount } from 'svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { subscribeToByHeartChanges, syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
  import { keepThumbs } from '../../lib/byHeart/cardThumb';
  import { isDue, referenceOf } from '../../lib/byHeart/verse';
  import { askConfirm } from '../../stores/confirmStore';
  import ByHeartRow from './ByHeartRow.svelte';

  let verses: DBByHeartVerse[] = [];
  let loaded = false;
  let expanded: string | null = null;

  $: dueCount = verses.filter((v) => isDue(v)).length;

  async function load() {
    verses = await syncedByHeartStore.list();
    keepThumbs(new Set(verses.map((v) => v.id)));
    loaded = true;
  }

  async function remove(verse: DBByHeartVerse) {
    const ok = await askConfirm(`Remove ${referenceOf(verse)} from By Heart? Its score and schedule go with it.`, {
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    expanded = null;
    await syncedByHeartStore.remove(verse.id);
  }

  let unsubscribe = () => {};
  onMount(() => {
    unsubscribe = subscribeToByHeartChanges(() => void load());
    void load();
  });
  onDestroy(() => unsubscribe());
</script>

<div class="bh-pane">
  <div class="bar">
    <button class="today" disabled>
      <span>Today</span>
      <span class="today-count">{dueCount === 1 ? '1 verse due' : `${dueCount} verses due`}</span>
    </button>
  </div>

  <div class="list">
    {#each verses as verse (verse.id)}
      <ByHeartRow
        {verse}
        expanded={expanded === verse.id}
        onMore={() => (expanded = expanded === verse.id ? null : verse.id)}
      />
      {#if expanded === verse.id}
        <div class="actions">
          <button class="action danger" on:click={() => remove(verse)}>Remove</button>
        </div>
      {/if}
    {:else}
      {#if loaded}
        <p class="empty">The verses you are memorizing live here.</p>
      {/if}
    {/each}
  </div>
</div>

<style>
  .bh-pane {
    --bh-accent: #f472b6;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: 15px;
  }

  .bar {
    display: flex;
    gap: calc(8px * var(--bar-scale, 1));
    flex-shrink: 0;
    padding: calc(8px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
  }

  .today {
    flex: 1;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    padding: calc(9px * var(--bar-scale, 1)) calc(14px * var(--bar-scale, 1));
    border: 1px solid var(--bh-accent);
    border-radius: 8px;
    background: rgba(244, 114, 182, 0.14);
    color: inherit;
    font: inherit;
    font-size: calc(15px * var(--bar-scale, 1));
    font-weight: 600;
    cursor: pointer;
  }

  .today:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .today-count {
    font-size: 0.8em;
    font-weight: 400;
    opacity: 0.8;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .empty {
    margin: 0;
    padding: 28px 20px;
    text-align: center;
    line-height: 1.5;
    opacity: 0.75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 12px 10px 78px;
  }

  .action {
    padding: 6px 12px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
  }

  .action.danger {
    border-color: #ef4444;
    color: #ef4444;
  }
</style>
