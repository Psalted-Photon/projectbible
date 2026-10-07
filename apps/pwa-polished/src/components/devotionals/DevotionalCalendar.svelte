<script lang="ts">
  /**
   * The devotionals' date picker: a month of day numbers, and the month name
   * zooms out to the whole year. The readings are the same every year, but the
   * days line up under this year's weekdays, like the tab's date above them.
   * February always has its 29th; in a year without one it just follows the 28th.
   *
   * The parent places it (it drops down under whatever opened it). `reader`
   * dresses it in the reader's colors for the reading screen; without it, it
   * matches the Reading Plan window like the rest of the Devotionals tab.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { dropIn, fadeAway, scale } from '../../lib/motion';
  import { CaretLeft, CaretRight, CaretDown } from 'phosphor-svelte';
  import { monthName } from '../../lib/devotionals/devotionalsData';
  import { todayMonthDay } from '../../lib/devotionals/slot';

  /** The date being shown, which the calendar opens on and marks. */
  export let month: number;
  export let day: number;
  export let reader = false;

  const dispatch = createEventDispatcher<{ pick: { month: number; day: number }; close: void }>();

  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = todayMonthDay();
  const year = new Date().getFullYear();

  let view: 'days' | 'months' = 'days';
  let viewMonth = month;

  $: days = Array.from({ length: DAYS_IN_MONTH[viewMonth - 1] }, (_, i) => i + 1);
  // Empty boxes before the 1st, so it sits under this year's weekday for it.
  $: blanks = new Date(year, viewMonth - 1, 1).getDay();

  function shiftMonth(delta: number) {
    viewMonth = ((viewMonth - 1 + delta + 12) % 12) + 1;
  }

  function pickMonth(m: number) {
    viewMonth = m;
    view = 'days';
  }

  function pick(m: number, d: number) {
    dispatch('pick', { month: m, day: d });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Caught on the way down, so the reading screen's own Escape (close) never sees it.
    e.preventDefault();
    e.stopPropagation();
    // Escape steps back out of the year view before it closes the calendar.
    if (view === 'months') view = 'days';
    else dispatch('close');
  }

  let panel: HTMLElement;
  onMount(() => panel?.focus());
</script>

<svelte:window on:keydown|capture={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="dc-backdrop" on:click={() => dispatch('close')}></div>
<div class="dc-panel" class:reader bind:this={panel} tabindex="-1" role="dialog" aria-label="Pick a date" in:dropIn out:fadeAway>
  {#if view === 'days'}
    <div class="dc-head">
      <button class="dc-step" on:click={() => shiftMonth(-1)} aria-label="Previous month"><CaretLeft size={14} weight="bold" /></button>
      <button class="dc-month" on:click={() => (view = 'months')} aria-label="Show all months">
        {monthName(viewMonth)} <CaretDown size={12} weight="bold" />
      </button>
      <button class="dc-step" on:click={() => shiftMonth(1)} aria-label="Next month"><CaretRight size={14} weight="bold" /></button>
    </div>
    <div class="dc-days dc-weekdays" aria-hidden="true">
      {#each WEEKDAYS as wd}<span>{wd}</span>{/each}
    </div>
    {#key viewMonth}
      <div class="dc-days" in:scale={{ start: 1.06, duration: 140 }}>
        {#each Array(blanks) as _}<span></span>{/each}
        {#each days as d (d)}
          <button
            class="dc-cell"
            class:current={viewMonth === month && d === day}
            class:today={viewMonth === today.month && d === today.day}
            on:click={() => pick(viewMonth, d)}
            aria-label="{monthName(viewMonth)} {d}"
          >{d}</button>
        {/each}
      </div>
    {/key}
  {:else}
    <div class="dc-head">
      <span class="dc-year">Every month</span>
    </div>
    <!-- 96%, not smaller: nothing in the app shrinks further than that. -->
    <div class="dc-months" in:scale={{ start: 0.96, duration: 160 }}>
      {#each DAYS_IN_MONTH as _, i (i)}
        <button
          class="dc-cell dc-month-cell"
          class:current={i + 1 === month}
          class:today={i + 1 === today.month}
          on:click={() => pickMonth(i + 1)}
        >{monthName(i + 1).slice(0, 3)}</button>
      {/each}
    </div>
  {/if}
  {#if !(month === today.month && day === today.day)}
    <button class="dc-today" on:click={() => pick(today.month, today.day)}>Today</button>
  {/if}
</div>

<style>
  .dc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .dc-panel {
    position: absolute;
    z-index: 31;
    width: 280px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    padding: 10px;
    border-radius: 12px;
    background: #1c1c1c;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.85);
    outline: none;
    transform-origin: top center;
  }
  .dc-panel.reader {
    background: var(--reader-bg, #111);
    border-color: var(--reader-rule, rgba(255, 255, 255, 0.14));
    color: var(--reader-text, rgba(255, 255, 255, 0.85));
  }

  .dc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 8px;
    min-height: 30px;
  }
  .dc-step {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
  }
  .reader .dc-step {
    border-color: var(--reader-rule, rgba(255, 255, 255, 0.1));
  }
  .dc-month {
    display: flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    padding: 4px 8px;
    border-radius: 7px;
    cursor: pointer;
  }
  .dc-month:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .dc-year {
    flex: 1;
    text-align: center;
    font-size: 0.95rem;
    font-weight: 700;
  }

  .dc-days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .dc-weekdays {
    margin-bottom: 4px;
  }
  .dc-weekdays span {
    text-align: center;
    font-size: 0.7rem;
    font-weight: 700;
    opacity: 0.5;
  }
  .dc-months {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .dc-cell {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    color: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .dc-month-cell {
    aspect-ratio: auto;
    padding: 14px 0;
    font-size: 0.9rem;
  }
  .dc-cell:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .dc-cell.today {
    border-color: #e6b84a;
    color: #e6b84a;
  }
  .dc-cell.current {
    background: #e6b84a;
    border-color: #e6b84a;
    color: #111;
  }

  .dc-today {
    display: block;
    margin: 8px auto 0;
    background: none;
    border: 1px solid #e6b84a;
    color: #e6b84a;
    border-radius: 8px;
    padding: 5px 14px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>
