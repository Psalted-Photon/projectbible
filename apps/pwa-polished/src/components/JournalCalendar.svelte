<script lang="ts">
  import { onMount, createEventDispatcher, tick } from 'svelte';
  import { localDateStr } from '../stores/clockStore';
  import { syncedJournalStore } from '../adapters/SyncedJournalStore';
  import { windowStore } from '../lib/stores/windowStore';
  import type { JournalEntry } from '@projectbible/core';

  const dispatch = createEventDispatcher<{ close: void }>();

  // ─── Today ───────────────────────────────────────────────────────────────────
  const todayStr = localDateStr(new Date());

  // ─── Month state ─────────────────────────────────────────────────────────────
  let currentMonth: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // ─── Entry data ───────────────────────────────────────────────────────────────
  let entryMap = new Map<string, JournalEntry>();
  let loading = false;

  async function loadEntries() {
    loading = true;
    try {
      const year  = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const startStr = localDateStr(new Date(year, month, 1));
      const endStr   = localDateStr(new Date(year, month + 1, 0)); // last day of month
      const entries  = await syncedJournalStore.getEntries(startStr, endStr);
      entryMap = new Map(entries.map(e => [e.date, e]));
    } catch (e) {
      console.error('JournalCalendar: error loading entries', e);
      entryMap = new Map();
    } finally {
      loading = false;
    }
  }

  onMount(() => { loadEntries(); });

  // ─── Month navigation ─────────────────────────────────────────────────────────
  function prevMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    selectedCell = null;
    loadEntries();
  }

  function nextMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    selectedCell = null;
    loadEntries();
  }

  function goToToday() {
    currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    selectedCell = null;
    loadEntries();
  }

  $: monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ─── Calendar grid ────────────────────────────────────────────────────────────
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  type Cell = null | {
    dateStr: string;
    dayOfMonth: number;
    isToday: boolean;
    hasEntry: boolean;
  };

  $: calendarMatrix = (() => {
    const year  = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay    = new Date(year, month, 1);
    const startOffset = firstDay.getDay(); // 0 = Sunday

    const rows: Cell[][] = [];
    let row: Cell[] = [];
    let day = 1 - startOffset; // may be negative (prev-month padding cells)

    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, day);
      const inMonth = d.getMonth() === month;
      const ds = localDateStr(d);

      row.push(inMonth ? {
        dateStr: ds,
        dayOfMonth: d.getDate(),
        isToday: ds === todayStr,
        hasEntry: entryMap.has(ds),
      } : null);

      day++;
      if (row.length === 7) { rows.push(row); row = []; }
    }

    // Trim trailing all-null rows
    while (rows.length > 1 && rows[rows.length - 1].every(c => c === null)) {
      rows.pop();
    }

    return rows;
  })();

  // ─── Popover ──────────────────────────────────────────────────────────────────
  type SelectedCell = {
    dateStr: string;
    entry: JournalEntry | null;
    style: string;
  };

  let selectedCell: SelectedCell | null = null;
  let popoverEl: HTMLElement;

  async function handleCellClick(cell: NonNullable<Cell>, event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const entry = entryMap.get(cell.dateStr) ?? null;

    const PW = 264;
    const PH = entry ? 170 : 110;

    let top  = rect.bottom + 6;
    let left = rect.left;

    if (top + PH > window.innerHeight - 8) top = rect.top - PH - 6;
    if (left + PW > window.innerWidth - 8) left = window.innerWidth - PW - 8;
    if (left < 8) left = 8;

    selectedCell = {
      dateStr: cell.dateStr,
      entry,
      style: `top:${top}px;left:${left}px;width:${PW}px;`,
    };

    await tick();
    popoverEl?.focus();
  }

  function dismissPopover() { selectedCell = null; }

  function handleWindowPointerdown(event: PointerEvent) {
    if (selectedCell && popoverEl && !popoverEl.contains(event.target as Node)) {
      selectedCell = null;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && selectedCell) selectedCell = null;
  }

  // ─── Open journal window ──────────────────────────────────────────────────────
  function openJournal(dateStr: string) {
    const isPortrait = window.innerHeight > window.innerWidth;
    const edge = isPortrait ? 'bottom' : 'right';
    const windowId = windowStore.createWindow(edge, 50);
    if (windowId) windowStore.setWindowContent(windowId, 'journal', { date: dateStr });
    selectedCell = null;
    dispatch('close');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function formatDateFull(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }
</script>

<svelte:window on:pointerdown={handleWindowPointerdown} on:keydown={handleWindowKeydown} />

<div class="jc-root">
  <div class="jc-top">
    <button class="today-btn" on:click={goToToday}>Today</button>
    <div class="month-nav">
      <button class="nav-btn" on:click={prevMonth} aria-label="Previous month">‹</button>
      <span class="month-label">{monthLabel}</span>
      <button class="nav-btn" on:click={nextMonth} aria-label="Next month">›</button>
    </div>
  </div>

  <div class="cal-grid">
    {#each WEEKDAYS as wd}
      <div class="wd-header">{wd}</div>
    {/each}

    {#each calendarMatrix as week}
      {#each week as cell}
        {#if cell === null}
          <div class="cal-cell empty"></div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="cal-cell"
            class:is-today={cell.isToday}
            class:has-entry={cell.hasEntry}
            class:is-selected={selectedCell?.dateStr === cell.dateStr}
            on:click={(e) => handleCellClick(cell, e)}
          >
            <span class="cell-num" class:today-num={cell.isToday}>{cell.dayOfMonth}</span>
            {#if cell.hasEntry}
              <span class="entry-dot"></span>
            {/if}
          </div>
        {/if}
      {/each}
    {/each}
  </div>

  {#if loading}
    <div class="jc-loading">Loading…</div>
  {/if}
</div>

{#if selectedCell}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="jc-popover"
    style={selectedCell.style}
    bind:this={popoverEl}
    tabindex="-1"
    role="dialog"
    on:keydown={handleWindowKeydown}
  >
    <button class="pop-x" on:click={dismissPopover} aria-label="Close">×</button>
    <div class="pop-date">{formatDateFull(selectedCell.dateStr)}</div>

    {#if selectedCell.entry}
      {#if selectedCell.entry.title}
        <div class="pop-title">{selectedCell.entry.title}</div>
      {/if}
      <div class="pop-preview">{stripHtml(selectedCell.entry.text)}</div>
      <button class="pop-action" on:click={() => openJournal(selectedCell?.dateStr ?? '')}>
        Open in Journal →
      </button>
    {:else}
      <div class="pop-empty">No entry for this day.</div>
      <button class="pop-action" on:click={() => openJournal(selectedCell?.dateStr ?? '')}>
        Add journal entry for this day →
      </button>
    {/if}
  </div>
{/if}

<style>
  .jc-root { display: flex; flex-direction: column; gap: 10px; }

  .jc-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .today-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: #252525;
    color: #ccc;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .today-btn:hover { background: #2e2e2e; border-color: #555; }

  .month-nav { display: flex; align-items: center; gap: 8px; }

  .month-label {
    font-size: 15px;
    font-weight: 700;
    color: #e0e0e0;
    min-width: 148px;
    text-align: center;
  }

  .nav-btn {
    background: none;
    border: 1px solid #444;
    color: #ccc;
    border-radius: 4px;
    width: 28px;
    height: 28px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .nav-btn:hover { background: #2a2a2a; border-color: #666; color: #e0e0e0; }

  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }

  .wd-header {
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: #555;
    padding: 2px 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .cal-cell {
    min-height: 44px;
    border-radius: 5px;
    padding: 5px 5px 4px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    background: #1e1e1e;
    border: 1px solid #2a2a2a;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    position: relative;
  }
  .cal-cell.empty { background: transparent; border-color: transparent; cursor: default; }
  .cal-cell:not(.empty):hover { border-color: #444; background: #252525; }

  .cal-cell.has-entry { background: #0c1f3a; border-color: #1d4ed8; }
  .cal-cell.has-entry:hover { background: #0f2748; border-color: #3b6ef6; }

  .cal-cell.is-today { box-shadow: 0 0 0 2px #3b82f6; }
  .cal-cell.is-selected { box-shadow: 0 0 0 2px #9ccc65; }

  .cell-num { font-size: 12px; font-weight: 500; color: #888; line-height: 1; }
  .cell-num.today-num { color: #3b82f6; font-weight: 700; }
  .cal-cell.has-entry .cell-num { color: #90caf9; }

  .entry-dot { width: 5px; height: 5px; border-radius: 50%; background: #3b82f6; }

  .jc-loading { text-align: center; color: #555; font-size: 13px; padding: 6px; }

  .jc-popover {
    position: fixed;
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    padding: 14px 14px 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    outline: none;
  }

  .pop-x {
    position: absolute;
    top: 8px;
    right: 10px;
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    transition: color 0.15s;
  }
  .pop-x:hover { color: #bbb; }

  .pop-date { font-size: 11px; color: #777; font-weight: 500; padding-right: 20px; }

  .pop-title { font-size: 14px; font-weight: 600; color: #e0e0e0; }

  .pop-preview {
    font-size: 13px;
    color: #b0b0b0;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .pop-empty { font-size: 13px; color: #555; font-style: italic; }

  .pop-action {
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid #4caf50;
    background: transparent;
    color: #4caf50;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    transition: background 0.15s, color 0.15s;
  }
  .pop-action:hover { background: #4caf50; color: #fff; }
</style>
