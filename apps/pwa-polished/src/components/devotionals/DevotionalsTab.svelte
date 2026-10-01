<script lang="ts">
  /**
   * Reading Plan → Devotionals. The way in to the devotionals, and where they
   * are set up. Works signed out; only the reminders need an account.
   *
   * Two states: the pack isn't installed (install card), or home (today's
   * readings, any other date, setup). An open reading covers the screen on
   * top of home, and closing it lands back here.
   */
  import { onMount } from 'svelte';
  import { SunHorizon, MoonStars, CalendarBlank, CaretLeft, CaretRight, BookBookmark } from 'phosphor-svelte';
  import {
    isDevotionalsInstalled,
    listWorks,
    clearDevotionalsCache,
    shiftDate,
    type DevotionalWork,
    type DevotionalSlot,
  } from '../../lib/devotionals/devotionalsData';
  import { currentSlotStore, todayMonthDay } from '../../lib/devotionals/slot';
  import { devotionalTarget, devotionalSettings, type DevotionalTarget } from '../../stores/devotionalStore';
  import { todayStore } from '../../stores/clockStore';
  import { PACK_CATALOG, downloadAndImportPack, installBusy, installMessage } from '../../lib/packInstaller';
  import { showNotice } from '../../stores/noticeStore';
  import DevotionalReading from './DevotionalReading.svelte';
  import DevotionalReminders from './DevotionalReminders.svelte';

  let installed: boolean | null = null;
  let works: DevotionalWork[] = [];
  let open: DevotionalTarget | null = null;
  let installing = false;
  let progress = '';

  // The date the home view shows. Starts on today and follows midnight while it's still on today.
  let month = 1;
  let day = 1;
  let followingToday = true;
  $: today = (void $todayStore, todayMonthDay());
  $: if (followingToday) ({ month, day } = today);
  $: isToday = month === today.month && day === today.day;

  onMount(() => {
    // Settings may have been pulled from another device since the store was made.
    devotionalSettings.refresh();
    void refresh();
    const onPacks = () => { clearDevotionalsCache(); void refresh(); };
    window.addEventListener('packsUpdated', onPacks);
    return () => window.removeEventListener('packsUpdated', onPacks);
  });

  async function refresh() {
    installed = await isDevotionalsInstalled();
    works = installed ? await listWorks() : [];
  }

  // A reading asked for from elsewhere. Held until the pack is in, then opened and cleared.
  $: if ($devotionalTarget && installed) {
    open = $devotionalTarget;
    devotionalTarget.set(null);
  }

  $: openWork = open ? works.find((w) => w.workId === open!.workId) ?? null : null;

  function read(work: DevotionalWork, slot: DevotionalSlot) {
    open = { workId: work.workId, month, day, slot };
  }

  function moveDay(delta: number) {
    ({ month, day } = shiftDate(month, day, delta));
    followingToday = month === today.month && day === today.day;
  }

  function backToToday() {
    followingToday = true;
    ({ month, day } = today);
  }

  // The date input needs a whole date; the year only matters for the weekday it shows.
  $: year = new Date().getFullYear();
  $: dateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  $: weekday = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  function onDateInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return;
    month = +m[1];
    day = +m[2];
    followingToday = month === today.month && day === today.day;
  }

  async function install() {
    const pack = PACK_CATALOG.find((p) => p.id === 'devotionals');
    if (!pack || $installBusy) return;
    installing = true;
    $installBusy = true;
    try {
      await downloadAndImportPack(pack, (message) => {
        progress = message;
        $installMessage = message;
      });
      showNotice('Devotionals installed');
      window.dispatchEvent(new CustomEvent('packsUpdated'));
      clearDevotionalsCache();
      await refresh();
    } catch (error) {
      console.error('[Devotionals] install failed', error);
      showNotice(`Couldn't install Devotionals: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      installing = false;
      progress = '';
      $installBusy = false;
      $installMessage = '';
    }
  }

  const SLOT_MODES: { id: 'morning' | 'evening' | 'both'; label: string }[] = [
    { id: 'morning', label: 'Morning' },
    { id: 'evening', label: 'Evening' },
    { id: 'both', label: 'Both' },
  ];
</script>

{#if installed === null}
  <p class="dt-muted">Loading…</p>
{:else if !installed}
  <div class="dt-install">
    <span class="dt-install-icon"><BookBookmark size={30} weight="duotone" /></span>
    <h3>Devotionals</h3>
    <p>
      Three classic daily devotionals: Spurgeon's <em>Morning and Evening</em>, Spurgeon's
      <em>Faith's Checkbook</em>, and Bagster's <em>Daily Light on the Daily Path</em>. A reading for
      every morning and evening of the year, and it all works offline.
    </p>
    {#if $devotionalTarget}
      <p class="dt-note">Someone sent you a reading from these. Install the pack to open it.</p>
    {/if}
    <button class="dt-primary" on:click={install} disabled={installing || $installBusy}>
      {#if installing}{progress || 'Installing…'}{:else if $installBusy}Another pack is installing…{:else}Install (8.6 MB){/if}
    </button>
    <p class="dt-small">Public domain. Also in Profile → Packs.</p>
  </div>
{:else}
  {#if open && openWork}
    <DevotionalReading
      work={openWork}
      target={open}
      on:close={() => (open = null)}
      on:step={(e) => (open = e.detail)}
    />
  {/if}
  <div class="dt-home">
    <div class="dt-date-row">
      <button class="dt-icon-btn" on:click={() => moveDay(-1)} aria-label="Previous day"><CaretLeft size={16} weight="bold" /></button>
      <label class="dt-date">
        <span>{weekday}</span>
        <input type="date" value={dateValue} on:change={onDateInput} aria-label="Pick a date" />
      </label>
      <button class="dt-icon-btn" on:click={() => moveDay(1)} aria-label="Next day"><CaretRight size={16} weight="bold" /></button>
      {#if !isToday}
        <button class="dt-today" on:click={backToToday}>Today</button>
      {/if}
    </div>

    {#each works as work (work.workId)}
      <div class="dt-work">
        <div class="dt-work-head">
          <span class="dt-work-title">{work.title}</span>
          <span class="dt-work-author">{work.author}</span>
        </div>
        <p class="dt-work-about">{work.about}</p>
        <div class="dt-work-actions">
          {#if !work.hasSlots}
            <button class="dt-read" on:click={() => read(work, 'day')}>
              <CalendarBlank size={16} weight="bold" /> {isToday ? "Today's reading" : 'Read'}
            </button>
          {:else}
            {#if $devotionalSettings.slotMode !== 'evening'}
              <button class="dt-read" class:now={isToday && $currentSlotStore === 'morning'} on:click={() => read(work, 'morning')}>
                <SunHorizon size={16} weight="bold" /> Morning
              </button>
            {/if}
            {#if $devotionalSettings.slotMode !== 'morning'}
              <button class="dt-read" class:now={isToday && $currentSlotStore === 'evening'} on:click={() => read(work, 'evening')}>
                <MoonStars size={16} weight="bold" /> Evening
              </button>
            {/if}
          {/if}
        </div>
      </div>
    {/each}

    <section class="dt-setup">
      <h3>Setup</h3>

      <div class="dt-setting">
        <span class="dt-setting-label">Verse of the Day opens</span>
        <div class="dt-seg">
          {#each works as work (work.workId)}
            <button
              class:active={$devotionalSettings.mainWork === work.workId}
              on:click={() => devotionalSettings.update({ mainWork: work.workId })}
            >{work.shortTitle}</button>
          {/each}
        </div>
      </div>

      <div class="dt-setting">
        <span class="dt-setting-label">Readings</span>
        <div class="dt-seg">
          {#each SLOT_MODES as mode (mode.id)}
            <button
              class:active={$devotionalSettings.slotMode === mode.id}
              on:click={() => devotionalSettings.update({ slotMode: mode.id })}
            >{mode.label}</button>
          {/each}
        </div>
        <span class="dt-setting-hint">
          {#if $devotionalSettings.slotMode === 'both'}Morning until noon, evening after.{:else}Only the {$devotionalSettings.slotMode} reading, all day.{/if}
          Faith's Checkbook has one reading a day either way.
        </span>
      </div>

      <DevotionalReminders />
    </section>
  </div>
{/if}

<style>
  .dt-muted {
    color: rgba(255, 255, 255, 0.4);
  }

  .dt-install {
    text-align: center;
    max-width: 420px;
    margin: 20px auto;
    color: rgba(255, 255, 255, 0.85);
  }
  .dt-install-icon {
    display: inline-flex;
    padding: 10px;
    border-radius: 12px;
    color: #e6b84a;
    background: rgba(230, 184, 74, 0.1);
  }
  .dt-install h3 {
    margin: 10px 0 8px;
  }
  .dt-install p {
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.7);
  }
  .dt-note {
    color: #e6b84a !important;
  }
  .dt-small {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4) !important;
  }
  .dt-primary {
    margin-top: 6px;
    background: #e6b84a;
    color: #111;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-weight: 700;
    cursor: pointer;
  }
  .dt-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .dt-date-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  .dt-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
  }
  .dt-date {
    position: relative;
    flex: 1;
    text-align: center;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
  }
  /* The native picker sits invisibly over the label, so tapping the date opens it. */
  .dt-date input {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .dt-today {
    background: none;
    border: 1px solid #e6b84a;
    color: #e6b84a;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .dt-work {
    padding: 14px 16px;
    margin-bottom: 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .dt-work-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dt-work-title {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
  }
  .dt-work-author {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
  }
  .dt-work-about {
    margin: 6px 0 10px;
    font-size: 0.82rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.55);
  }
  .dt-work-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dt-read {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .dt-read.now {
    background: #e6b84a;
    color: #111;
    border-color: #e6b84a;
  }

  .dt-setup {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .dt-setup h3 {
    margin: 0 0 12px;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.9);
  }
  .dt-setup :global(.dt-setting) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .dt-setup :global(.dt-setting-label) {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
  }
  .dt-setup :global(.dt-setting-hint) {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.4);
  }
  .dt-setup :global(.dt-seg) {
    display: flex;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    overflow: hidden;
  }
  .dt-setup :global(.dt-seg button) {
    flex: 1;
    background: none;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.65);
    padding: 8px 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .dt-setup :global(.dt-seg button:last-child) {
    border-right: none;
  }
  .dt-setup :global(.dt-seg button.active) {
    background: rgba(230, 184, 74, 0.18);
    color: #e6b84a;
  }
</style>
