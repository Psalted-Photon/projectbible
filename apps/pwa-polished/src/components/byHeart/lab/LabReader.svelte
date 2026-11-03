<script lang="ts">
  /**
   * The simple reader test: the real reader with its pick-only switch on, and a
   * few questions about it. What gets picked becomes "Your verse" in the live
   * test. A real reader, registered the way a harmony pane is, so it leaves no
   * window behind and keeps no trail.
   */
  import { get } from 'svelte/store';
  import { onDestroy } from 'svelte';
  import BibleReader from '../../BibleReader.svelte';
  import CloseX from '../../CloseX.svelte';
  import { windowStore } from '../../../lib/stores/windowStore';
  import { navigationStore } from '../../../stores/navigationStore';
  import { formatShareRef, type PickedPassage } from '../../../lib/shareText';
  import { makePassage, type LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { labResults, patchResults } from '../../../lib/byHeart/lab/labResults';

  export let picked: LabPassage | null = null;

  const CHECKS = [
    'The ring has only Select and Extend',
    'Tapping a word, then Select, takes its verse',
    'Dragging across words takes just those words',
    'Extend, then tapping another word, stretches it',
    'Tapping a verse number takes the verse',
    'The location and translation menus work',
    'No markers, notes, highlights or other extras show',
  ];

  let windowId: string | null = null;

  function open() {
    const nav = get(navigationStore);
    [windowId] = windowStore.createHarmonyPanes([{ book: nav.book, chapter: nav.chapter, translation: nav.translation }]);
  }

  function close() {
    if (windowId) windowStore.closeWindow(windowId);
    windowId = null;
  }

  function onPick(p: PickedPassage) {
    picked = makePassage(p.passage, formatShareRef(p.ref), p.translation);
    patchResults({
      reader: { ...$labResults.reader, picked: `${picked.reference} (${picked.label})`, words: picked.words.length },
    });
    close();
  }

  function check(name: string, on: boolean) {
    patchResults({ reader: { ...$labResults.reader, checks: { ...$labResults.reader.checks, [name]: on } } });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !windowId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }

  onDestroy(close);
</script>

<svelte:window on:keydown|capture={onKey} />

<p class="lab-hint">
  Open the simple reader, pick a passage any way you like and tap <b>Select</b>. Your pick shows up here and as “Your verse” in the live test. Tick what worked.
</p>

<div class="lab-row">
  <button class="lab-btn" on:click={open}>Open the simple reader</button>
</div>

{#if picked}
  <div class="lab-stats">
    <div><b>{picked.reference}</b> ({picked.label}), {picked.words.length} words</div>
    <div class="lab-picked">{picked.passage}</div>
  </div>
{/if}

<div class="lab-checks">
  {#each CHECKS as name}
    <label>
      <input type="checkbox" checked={$labResults.reader.checks[name] === true} on:change={(e) => check(name, e.currentTarget.checked)} />
      {name}
    </label>
  {/each}
</div>

{#if windowId}
  <div class="pick-screen">
    <div class="pick-bar">
      <span>Pick a passage</span>
      <CloseX edge label="Close the simple reader" on:click={close} />
    </div>
    <div class="pick-reader themed">
      <BibleReader {windowId} {onPick} />
    </div>
  </div>
{/if}

<style>
  .pick-screen {
    position: fixed;
    inset: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    background: var(--lab-bg);
  }

  .pick-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-height: calc(40px * var(--bar-scale, 1));
    padding: 0 calc(12px * var(--bar-scale, 1));
    font-size: calc(14px * var(--bar-scale, 1));
    font-weight: 600;
  }

  .pick-reader {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
