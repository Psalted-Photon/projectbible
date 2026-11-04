<script lang="ts">
  /**
   * Choosing a passage for By Heart: the simple reader, or the Verse of the Day
   * list starting from today.
   *
   * The reader is a real one with its pick-only switch on, registered the way a
   * harmony pane is, so it leaves no window behind and keeps no trail. The
   * window that holds it is ByHeartPane's, which keeps it between the tabs and
   * the card step so Back lands where the reader was left.
   */
  import { onDestroy, onMount } from 'svelte';
  import BibleReader from '../BibleReader.svelte';
  import VerseRefRow from '../VerseRefRow.svelte';
  import { windowStore } from '../../lib/stores/windowStore';
  import { readVotdVerse, votdDaysFrom, type VotdDay } from '../../lib/verseOfTheDay';
  import type { PickedPassage } from '../../lib/shareText';
  import { localDateStr } from '../../stores/clockStore';
  import { navigationStore } from '../../stores/navigationStore';
  import { showNotice } from '../../stores/noticeStore';

  export let windowId: string;
  export let tab: 'read' | 'votd' = 'read';
  export let onPick: (picked: PickedPassage) => void;

  /** The reader's translation, which the list follows too. */
  $: translation =
    ($windowStore.find((w) => w.id === windowId)?.contentState?.translation as string | undefined) || $navigationStore.translation;

  // ── The list ───────────────────────────────────────────────────────────────

  /** Rows come in as the list scrolls, as each one reads its verse. */
  const PAGE = 30;
  const days = votdDaysFrom(localDateStr(new Date()));
  let shown = PAGE;
  let sentinel: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;

  $: if (sentinel && observer) {
    observer.disconnect();
    observer.observe(sentinel);
  }

  onMount(() => {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) shown = Math.min(days.length, shown + PAGE);
    }, { rootMargin: '300px' });
  });
  onDestroy(() => observer?.disconnect());

  async function pickDay(day: VotdDay) {
    const verse = await readVotdVerse(day.ref, translation);
    if ('unavailable' in verse) {
      showNotice(verse.unavailable, 'info');
      return;
    }
    onPick({
      passage: verse.plain,
      ref: { book: day.ref.book, chapter: verse.at.chapter, startVerse: verse.at.startVerse, endVerse: verse.at.endVerse },
      translation,
    });
  }
</script>

<div class="picker">
  <div class="tabs" role="tablist" aria-label="Choose a passage from">
    <button class="tab" class:active={tab === 'read'} role="tab" aria-selected={tab === 'read'} on:click={() => (tab = 'read')}>Bible</button>
    <button class="tab" class:active={tab === 'votd'} role="tab" aria-selected={tab === 'votd'} on:click={() => (tab = 'votd')}>Verse of the Day</button>
  </div>

  {#if tab === 'read'}
    <p class="hint">Tap a word or a verse number, then Select. Drag across words to take just those words.</p>
    <div class="reader">
      <BibleReader {windowId} {onPick} />
    </div>
  {:else}
    <div class="days">
      {#each days.slice(0, shown) as day (day.key)}
        <VerseRefRow
          book={day.ref.book}
          chapter={day.ref.chapter}
          verse={day.ref.startVerse}
          label="{day.label} · {day.refText}"
          {translation}
          onOpen={() => pickDay(day)}
        />
      {/each}
      {#if shown < days.length}
        <div class="more" bind:this={sentinel}></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tabs {
    display: flex;
    flex-shrink: 0;
    gap: calc(4px * var(--bar-scale, 1));
    padding: calc(3px * var(--bar-scale, 1));
    margin: calc(6px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 10px;
  }

  .tab {
    flex: 1;
    padding: calc(6px * var(--bar-scale, 1)) 0;
    border: none;
    border-radius: 7px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: calc(13px * var(--bar-scale, 1));
    font-weight: 600;
    opacity: 0.7;
    cursor: pointer;
  }

  .tab.active {
    background: rgba(127, 127, 127, 0.2);
    opacity: 1;
  }

  .hint {
    flex-shrink: 0;
    margin: 0 12px 6px;
    font-size: 0.8em;
    line-height: 1.4;
    opacity: 0.75;
  }

  .reader {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .days {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px 10px 16px;
  }

  .more {
    height: 1px;
    flex-shrink: 0;
  }
</style>
