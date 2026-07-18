<script lang="ts">
  import { planDayDateStr } from '@projectbible/core';
  import type { ReadingPlan } from '@projectbible/core';
  import type { ReadingProgressEntry } from '../stores/ReadingProgressStore';

  export let plan: ReadingPlan;
  export let dayProgressMap: Map<number, ReadingProgressEntry>;
  export let todayStr: string; // YYYY-MM-DD from parent
  export let onDayClick: (dayNumber: number) => void;

  // ── Month navigation ────────────────────────────────────────────────────────
  // Initialize to the month that contains today, clamped to plan range.
  function monthOf(dateStr: string): Date {
    const [y, m] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }

  const planStart = planDayDateStr(plan.days[0].date);
  const planEnd   = planDayDateStr(plan.days[plan.days.length - 1].date);

  let currentMonth: Date = monthOf(
    todayStr >= planStart && todayStr <= planEnd ? todayStr : planStart
  );

  function prevMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
  }
  function nextMonth() {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  }

  // ── O(1) lookup: YYYY-MM-DD → plan day ─────────────────────────────────────
  $: planDayMap = (() => {
    const m = new Map<string, { dayNumber: number; chapters: any[] }>();
    for (const day of plan.days) {
      m.set(planDayDateStr(day.date), { dayNumber: day.dayNumber, chapters: day.chapters });
    }
    return m;
  })();

  // ── Calendar matrix for current month ──────────────────────────────────────
  type Cell = null | {
    dateStr: string;        // YYYY-MM-DD
    dayOfMonth: number;
    dayNumber: number | null;     // plan day number, null if non-reading day
    chapterCount: number;
    status: 'completed' | 'current' | 'overdue' | 'future' | null;
    isToday: boolean;
    inPlan: boolean;        // date falls within plan range
  };

  $: calendarMatrix = (() => {
    const year  = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    // First cell: Sunday of the week containing the 1st
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay(); // 0=Sun

    const rows: Cell[][] = [];
    let row: Cell[] = [];
    let dayOfMonth = 1 - startOffset; // may be negative (padding days)

    for (let i = 0; i < 42; i++) { // 6 rows × 7 cols
      const d = new Date(year, month, dayOfMonth);
      const inCurrentMonth = d.getMonth() === month;
      const ds = planDayDateStr(d);
      const planDay = planDayMap.get(ds);
      const inPlan = ds >= planStart && ds <= planEnd;

      let status: 'completed' | 'current' | 'overdue' | 'future' | null = null;
      if (planDay) {
        const progress = dayProgressMap.get(planDay.dayNumber);
        if (progress?.completed) {
          status = ds > todayStr ? 'future' : 'completed'; // completed-ahead still looks completed
        } else if (ds < todayStr) {
          status = 'overdue';
        } else if (ds === todayStr) {
          status = 'current';
        } else {
          status = 'future';
        }
      }

      row.push(inCurrentMonth ? {
        dateStr: ds,
        dayOfMonth: d.getDate(),
        dayNumber: planDay?.dayNumber ?? null,
        chapterCount: planDay?.chapters.length ?? 0,
        status,
        isToday: ds === todayStr,
        inPlan,
      } : null);

      dayOfMonth++;
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }

    // Trim trailing empty rows (all null)
    while (rows.length > 1 && rows[rows.length - 1].every(c => c === null)) {
      rows.pop();
    }
    return rows;
  })();

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  $: monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
</script>

<div class="cal-wrap">
  <!-- Month navigation header -->
  <div class="cal-header">
    <button class="nav-btn" on:click={prevMonth} aria-label="Previous month">‹</button>
    <span class="month-label">{monthLabel}</span>
    <button class="nav-btn" on:click={nextMonth} aria-label="Next month">›</button>
  </div>

  <!-- Weekday headers -->
  <div class="cal-grid">
    {#each WEEKDAYS as wd}
      <div class="wd-header">{wd}</div>
    {/each}

    <!-- Calendar cells -->
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
            class:has-reading={cell.dayNumber !== null}
            class:status-completed={cell.status === 'completed'}
            class:status-current={cell.status === 'current'}
            class:status-overdue={cell.status === 'overdue'}
            class:status-future={cell.status === 'future'}
            class:not-in-plan={!cell.inPlan && cell.dayNumber === null}
            on:click={() => cell.dayNumber !== null && onDayClick(cell.dayNumber)}
          >
            <span class="cell-date" class:today-num={cell.isToday}>{cell.dayOfMonth}</span>
            {#if cell.dayNumber !== null}
              <span class="ch-badge">{cell.chapterCount}ch</span>
            {/if}
          </div>
        {/if}
      {/each}
    {/each}
  </div>

  <!-- Legend -->
  <div class="cal-legend">
    <span class="leg-item leg-today">Today</span>
    <span class="leg-item leg-done">Done</span>
    <span class="leg-item leg-overdue">Overdue</span>
    <span class="leg-item leg-future">Upcoming</span>
  </div>
</div>

<style>
  .cal-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .month-label {
    font-size: 15px;
    font-weight: 700;
    color: #e0e0e0;
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

  .nav-btn:hover {
    background: #2a2a2a;
    border-color: #666;
    color: #e0e0e0;
  }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
  }

  .wd-header {
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: #666;
    padding: 2px 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .cal-cell {
    min-height: 46px;
    border-radius: 5px;
    padding: 4px 5px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: #1e1e1e;
    border: 1px solid #2a2a2a;
    font-size: 12px;
    position: relative;
    transition: border-color 0.15s, background 0.15s;
  }

  .cal-cell.empty {
    background: transparent;
    border-color: transparent;
  }

  .cal-cell.not-in-plan {
    background: #161616;
    opacity: 0.5;
  }

  .cal-cell.has-reading {
    cursor: pointer;
  }

  .cal-cell.has-reading:hover {
    border-color: #555;
    background: #252525;
  }

  /* Status backgrounds */
  .cal-cell.status-completed {
    background: #132213;
    border-color: #2a5a2a;
  }

  .cal-cell.status-current {
    background: #0d1b2e;
    border-color: #1d4ed8;
  }

  .cal-cell.status-overdue {
    background: #2a1414;
    border-color: #6b2020;
  }

  .cal-cell.status-future {
    background: #1e1e1e;
    border-color: #2a2a2a;
  }

  /* Today ring */
  .cal-cell.is-today {
    box-shadow: 0 0 0 2px #3b82f6;
  }

  .cal-cell.is-today.status-completed {
    box-shadow: 0 0 0 2px #4caf50;
  }

  .cell-date {
    font-size: 12px;
    font-weight: 500;
    color: #999;
    line-height: 1;
  }

  .cell-date.today-num {
    color: #3b82f6;
    font-weight: 700;
  }

  .cal-cell.status-completed .cell-date {
    color: #6dbf6d;
  }

  .cal-cell.status-overdue .cell-date {
    color: #e57373;
  }

  .cal-cell.status-current .cell-date {
    color: #93c5fd;
  }

  .ch-badge {
    margin-top: 4px;
    font-size: 10px;
    color: #777;
    line-height: 1;
  }

  .cal-cell.status-completed .ch-badge { color: #4a8a4a; }
  .cal-cell.status-current   .ch-badge { color: #5b8fd8; }
  .cal-cell.status-overdue   .ch-badge { color: #a05050; }

  /* Legend */
  .cal-legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .leg-item {
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 5px;
    color: #888;
  }

  .leg-item::before {
    content: '';
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .leg-today::before   { background: #0d1b2e; box-shadow: 0 0 0 2px #3b82f6; }
  .leg-done::before    { background: #132213; border: 1px solid #2a5a2a; }
  .leg-overdue::before { background: #2a1414; border: 1px solid #6b2020; }
  .leg-future::before  { background: #1e1e1e; border: 1px solid #2a2a2a; }
</style>
