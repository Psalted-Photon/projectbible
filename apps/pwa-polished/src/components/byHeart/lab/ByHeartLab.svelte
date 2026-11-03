<script lang="ts">
  /**
   * By Heart's lab, opened from Dev Options. It decides go or no-go for the
   * plan: seven tests on the real reader, card and voice files, run by hand on
   * each device, with a Copy results button to paste back. Over the app like
   * ParallelView, mounted only while open. Comes out when By Heart is finished.
   */
  import { onDestroy, onMount } from 'svelte';
  import { CaretDown, CaretRight, Copy } from 'phosphor-svelte';
  import CloseX from '../../CloseX.svelte';
  import LabLive from './LabLive.svelte';
  import LabBlurLine from './LabBlurLine.svelte';
  import LabCovers from './LabCovers.svelte';
  import LabColor from './LabColor.svelte';
  import LabPress from './LabPress.svelte';
  import LabReader from './LabReader.svelte';
  import LabLimit from './LabLimit.svelte';
  import { copyText } from '../../../lib/clipboard';
  import { showNotice } from '../../../stores/noticeStore';
  import { askConfirm } from '../../../stores/confirmStore';
  import { stayAwake, allowSleep } from '../../../lib/installAwake';
  import type { LabPassage } from '../../../lib/byHeart/lab/labPassages';
  import { byHeartLabOpen } from '../../../lib/byHeart/lab/labOpen';
  import { clearResults, labResults, patchResults, resultsText } from '../../../lib/byHeart/lab/labResults';

  type TestId = 'live' | 'blur' | 'covers' | 'color' | 'press' | 'reader' | 'limit';

  const TESTS: { id: TestId; title: string }[] = [
    { id: 'live', title: 'Live reveal' },
    { id: 'blur', title: 'The blur line' },
    { id: 'covers', title: 'Pills and speed' },
    { id: 'color', title: 'Word color through blur' },
    { id: 'press', title: 'Tap and press' },
    { id: 'reader', title: 'The simple reader' },
    { id: 'limit', title: 'The word limit' },
  ];

  /** One at a time, as each holds a card and the live test holds the mic. */
  let open: TestId | null = 'live';
  /** Picked in the simple reader, read in the live test. */
  let picked: LabPassage | null = null;

  $: done = {
    live: $labResults.runs.length > 0,
    blur: $labResults.blur.length > 0,
    covers: Object.keys($labResults.speed).length > 0,
    color: Object.keys($labResults.color).length > 0,
    press: $labResults.press.presses.length > 0,
    reader: !!$labResults.reader.picked,
    limit: $labResults.limit.length > 0,
  } as Record<TestId, boolean>;

  function close() {
    byHeartLabOpen.set(false);
  }

  async function copy() {
    const ok = await copyText(resultsText());
    showNotice(ok ? 'Results copied.' : "Couldn't copy the results.", ok ? 'info' : 'error');
  }

  async function clear() {
    if (await askConfirm("Clear every test's results on this device?", { confirmLabel: 'Clear', danger: true })) clearResults();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  }

  onMount(() => stayAwake('by-heart-lab-open'));
  onDestroy(() => allowSleep('by-heart-lab-open'));
</script>

<svelte:window on:keydown={onKey} />

<div class="bh-lab">
  <header>
    <h2>By Heart lab</h2>
    <button class="lab-btn" on:click={copy}><Copy size="1em" weight="bold" /> Copy results</button>
    <CloseX edge label="Close the lab" on:click={close} />
  </header>

  <div class="body">
    {#each TESTS as test (test.id)}
      <section>
        <button class="test-head" aria-expanded={open === test.id} on:click={() => (open = open === test.id ? null : test.id)}>
          {#if open === test.id}<CaretDown size="1em" weight="bold" />{:else}<CaretRight size="1em" weight="bold" />{/if}
          <span>{test.title}</span>
          {#if done[test.id]}<span class="tick">has results</span>{/if}
        </button>
        {#if open === test.id}
          <div class="test-body">
            {#if test.id === 'live'}<LabLive {picked} />
            {:else if test.id === 'blur'}<LabBlurLine />
            {:else if test.id === 'covers'}<LabCovers />
            {:else if test.id === 'color'}<LabColor />
            {:else if test.id === 'press'}<LabPress />
            {:else if test.id === 'reader'}<LabReader bind:picked />
            {:else if test.id === 'limit'}<LabLimit />
            {/if}
          </div>
        {/if}
      </section>
    {/each}

    <section class="notes">
      <label>
        Anything else you noticed
        <textarea rows="3" value={$labResults.notes} on:change={(e) => patchResults({ notes: e.currentTarget.value })}></textarea>
      </label>
      <button class="lab-btn" on:click={clear}>Clear all results</button>
    </section>
  </div>
</div>

<style>
  .bh-lab {
    --lab-bg: var(--reader-bg, #1a1a1a);
    --lab-text: var(--reader-text, #e0e0e0);
    --lab-accent: #e6b84a;
    position: fixed;
    inset: 0;
    /* Level with ParallelView: over the windows and panes, under the modals. */
    z-index: 8000;
    display: flex;
    flex-direction: column;
    background: var(--lab-bg);
    color: var(--lab-text);
    font-size: 15px;
  }

  :global(body.light-theme) .bh-lab {
    --lab-bg: #fafafa;
    --lab-text: #1a1a1a;
    --lab-accent: #9a3412;
  }

  :global(body.sepia-theme) .bh-lab {
    --lab-bg: #f6f0e3;
    --lab-text: #3b2f22;
    --lab-accent: #9a3412;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    min-height: calc(48px * var(--bar-scale, 1));
    padding: 0 calc(12px * var(--bar-scale, 1));
    border-bottom: 1px solid rgba(127, 127, 127, 0.25);
    font-size: calc(15px * var(--bar-scale, 1));
  }

  h2 {
    margin: 0;
    font-size: 1.1em;
    white-space: nowrap;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 16px 80px;
  }

  section {
    border-bottom: 1px solid rgba(127, 127, 127, 0.18);
  }

  .test-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 14px 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .tick {
    margin-left: auto;
    font-size: 0.8em;
    font-weight: 400;
    color: var(--lab-accent);
  }

  .test-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 20px;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    padding: 16px 0;
    border-bottom: none;
  }

  .notes label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  /* Shared by every test. */
  .bh-lab :global(.lab-hint) {
    margin: 0;
    font-size: 0.9em;
    line-height: 1.45;
    opacity: 0.85;
  }

  .bh-lab :global(.lab-say) {
    margin: 0;
    padding: 8px 12px;
    border-left: 3px solid var(--lab-accent);
    font-size: 0.95em;
  }

  .bh-lab :global(.lab-row) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .bh-lab :global(.lab-row label) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
  }

  .bh-lab :global(.lab-row label.grow) {
    flex: 1;
    min-width: 160px;
  }

  .bh-lab :global(.lab-row input[type='range']) {
    flex: 1;
    min-width: 0;
  }

  .bh-lab :global(.lab-center) {
    justify-content: center;
    padding: 16px 0;
  }

  .bh-lab :global(select) {
    padding: 4px 6px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 6px;
    background: var(--lab-bg);
    color: inherit;
    font: inherit;
  }

  .bh-lab :global(.lab-btn) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
    white-space: nowrap;
  }

  .bh-lab :global(.lab-btn:disabled),
  .bh-lab :global(.lab-chip:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  .bh-lab :global(.lab-btn.on),
  .bh-lab :global(.lab-chip.on) {
    border-color: var(--lab-accent);
    color: var(--lab-accent);
  }

  .bh-lab :global(.lab-btn.big) {
    flex: 1;
    justify-content: center;
    padding: 14px;
    font-size: 1.05em;
    font-weight: 600;
  }

  .bh-lab :global(.lab-chips) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .bh-lab :global(.lab-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: 1px solid rgba(127, 127, 127, 0.35);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.82em;
    cursor: pointer;
  }

  .bh-lab :global(.lab-mic-row) {
    flex-wrap: nowrap;
  }

  .bh-lab :global(.lab-mic) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 64px;
    height: 64px;
    padding: 0;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 50%;
    background: transparent;
    color: var(--lab-accent);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition: box-shadow 0.08s;
  }

  .bh-lab :global(.lab-mic.live) {
    background: var(--lab-accent);
    color: var(--lab-bg);
    box-shadow: 0 0 0 calc(3px + var(--level, 0) * 12px) rgba(230, 184, 74, 0.35);
  }

  .bh-lab :global(.lab-mic.press) {
    width: 88px;
    height: 88px;
  }

  .bh-lab :global(.lab-status) {
    min-width: 0;
    font-size: 0.9em;
  }

  .bh-lab :global(.lab-wrong) {
    margin-top: 2px;
    color: var(--lab-accent);
  }

  .bh-lab :global(.lab-heard) {
    margin: 0;
    font-size: 0.85em;
    line-height: 1.4;
  }

  .bh-lab :global(.lab-heard .pending) {
    opacity: 0.55;
  }

  .bh-lab :global(.lab-trouble) {
    margin: 0;
    color: #ef4444;
    font-size: 0.9em;
  }

  .bh-lab :global(.lab-stats) {
    font-size: 0.85em;
    line-height: 1.5;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(127, 127, 127, 0.12);
  }

  .bh-lab :global(.lab-picked) {
    max-height: 7em;
    overflow-y: auto;
    opacity: 0.8;
  }

  .bh-lab :global(.lab-checks) {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.9em;
  }

  .bh-lab :global(.lab-checks label) {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
</style>
