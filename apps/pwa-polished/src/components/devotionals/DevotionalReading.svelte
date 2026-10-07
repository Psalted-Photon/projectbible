<script lang="ts">
  /**
   * One devotional reading.
   *
   * Spurgeon (Morning and Evening, Faith's Checkbook): his headline verse, then
   * his text. Daily Light: Bagster's references in his paragraphs. Only the
   * references come from the pack; every verse shown is the reader's own
   * translation, so there is one translation on the page and no label for it.
   *
   * Where the pack has them, a Spurgeon reading also has a plain modern-English
   * version (the Original / Modern switch, remembered as textMode) and notes on
   * its old words and phrases (the (i) panel). Neither shows when it isn't there.
   *
   * Every reference opens the reader with the fade highlight and leaves a
   * BookBookmark crumb that brings you back here, scrolled where you were.
   *
   * Shown full screen over the Reading Plan window, with nothing but the text,
   * in the reader's own colors (black on dark, paper on light and sepia, the
   * chosen colors on custom): the X closes it back to the Devotionals tab.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { fade } from '../../lib/motion';
  import { SunHorizon, MoonStars, CalendarBlank, CalendarDots, CaretLeft, CaretRight, ShareNetwork, Info, X } from 'phosphor-svelte';
  import { navigationStore } from '../../stores/navigationStore';
  import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
  import { devotionalSettings, type DevotionalTarget } from '../../stores/devotionalStore';
  import { IndexedDBTextStore } from '../../lib/adapters';
  import { renderVerseHtml, cleanVersePreviewText } from '../../lib/verseRendering';
  import { sanitizePackHtml } from '../../lib/sanitizePackHtml';
  import { parseOsisRef } from '../../lib/parseRefString';
  import { getBookColor, normalizeBookName, translationLabel } from '../../lib/bibleData';
  import {
    getReading,
    stepReading,
    formatMonthDay,
    type DevotionalWork,
    type DevotionalReading,
    type DevotionalKeyRef,
  } from '../../lib/devotionals/devotionalsData';
  import ShareModal from '../ShareModal.svelte';
  import DevotionalCalendar from './DevotionalCalendar.svelte';
  import { buildDevotionalUrl } from '../../lib/shareText';

  export let work: DevotionalWork;
  export let target: DevotionalTarget;

  const dispatch = createEventDispatcher<{ close: void; step: DevotionalTarget }>();
  const textStore = new IndexedDBTextStore();

  let reading: DevotionalReading | null = null;
  let loading = true;
  let scrollEl: HTMLElement;

  /**
   * Move the viewer to the end of <body>, as ArtViewer does: on the light and
   * sepia themes the Reading Plan window carries a CSS filter, which would pin
   * a fixed-position child to the window and clip it instead of the screen.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function onKeydown(e: KeyboardEvent) {
    // The share window handles its own Escape, and so does the calendar.
    if (e.key !== 'Escape' || shareOpen) return;
    e.preventDefault();
    if (notesOpen) notesOpen = false;
    else dispatch('close');
  }

  $: translation = $navigationStore.translation;
  $: bothSlots = work.hasSlots && $devotionalSettings.slotMode === 'both';
  $: slotLabel = target.slot === 'morning' ? 'Morning' : target.slot === 'evening' ? 'Evening' : '';

  $: load(target.workId, target.month, target.day, target.slot);

  let loadToken = 0;
  async function load(workId: string, month: number, day: number, slot: DevotionalTarget['slot']) {
    const token = ++loadToken;
    loading = true;
    verseCache = {};
    notesOpen = false;
    const r = await getReading(workId, month, day, slot);
    if (token !== loadToken) return;
    reading = r;
    loading = false;
    await tick();
    // Coming back from the reader puts the reading where it was; anything else starts at the top.
    const scroller = scrollContainer();
    if (scroller) scroller.scrollTop = target.scrollTop ?? 0;
  }

  function scrollContainer(): HTMLElement | null {
    return scrollEl ?? null;
  }

  // ── Verse text in the reader's translation ───────────────────────────────

  /** Verse text keyed by `${translation}|${osis}`; '' means that translation hasn't got it. */
  let verseCache: Record<string, string> = {};

  function versesOf(k: DevotionalKeyRef): number[] {
    if (k.verseStart == null) return [];
    if (k.verses?.length) return k.verses;
    const out: number[] = [];
    for (let v = k.verseStart; v <= (k.verseEnd ?? k.verseStart); v++) out.push(v);
    return out;
  }

  async function loadVerse(k: DevotionalKeyRef, trans: string): Promise<void> {
    const key = `${trans}|${k.osis}`;
    if (key in verseCache) return;
    const book = normalizeBookName(k.book);
    const parts: string[] = [];
    for (const v of versesOf(k)) {
      const t = await textStore.getVerse(trans, book, k.chapter, v);
      if (t) parts.push(t);
    }
    verseCache = { ...verseCache, [key]: parts.join(' ') };
  }

  // Every reference, in the reader's translation; follows it if it changes while the reading is up.
  $: if (reading && translation) {
    for (const k of reading.keyRefs) loadVerse(k, translation);
  }

  // ── Daily Light ──────────────────────────────────────────────────────────

  /** References grouped into Bagster's paragraphs, keeping each one's index into keyRefs. */
  $: paragraphs = (() => {
    if (!reading || work.workId !== 'daily-light') return [] as { k: DevotionalKeyRef; i: number }[][];
    const groups: { k: DevotionalKeyRef; i: number }[][] = [];
    reading.keyRefs.forEach((k, i) => {
      const p = k.para ?? 0;
      if (!groups[p]) groups[p] = [];
      groups[p].push({ k, i });
    });
    return groups.filter(Boolean);
  })();

  // ── Body links ───────────────────────────────────────────────────────────

  const OSIS_BOOK_COLOR = (osis: string): string | null => {
    const t = parseOsisRef(osis);
    return t ? getBookColor(t.book) : null;
  };

  /** Tint each reference by its book, like the encyclopedia's scripture links. */
  function colorRefs(html: string): string {
    return html.replace(/<a class="devo-ref" data-osis="([^"]+)"/g, (tag, osis) => {
      const color = OSIS_BOOK_COLOR(osis);
      return color ? `${tag} style="color:${color}"` : tag;
    });
  }

  /** A Scripture link in the body or the notes panel. */
  function onBodyClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a.devo-ref') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const osis = a.getAttribute('data-osis');
    if (osis) goToRef(osis);
  }

  // ── Original / Modern ────────────────────────────────────────────────────

  let bodyEl: HTMLElement;

  $: hasModern = !!reading?.modernHtml;
  $: showModern = hasModern && $devotionalSettings.textMode === 'modern';
  $: bodyHtml = reading ? (showModern && reading.modernHtml ? reading.modernHtml : reading.bodyHtml) : '';

  /**
   * Which original block is at the top of the screen, and how far through it.
   * The original's nth element is block n; each modern element says its block
   * in data-b (one long paragraph often becomes three or four).
   */
  function blockAtTop(): { block: number; fraction: number } | null {
    const scroller = scrollContainer();
    if (!scroller || !bodyEl) return null;
    const top = scroller.getBoundingClientRect().top;
    const els = Array.from(bodyEl.children) as HTMLElement[];
    const blockOf = (el: HTMLElement, i: number) => (showModern ? Number(el.dataset.b) : i);
    const at = els.findIndex((el) => el.getBoundingClientRect().bottom > top);
    // Still up in the headline, or past the end: those look the same either way.
    if (at < 0 || (at === 0 && els[0].getBoundingClientRect().top > top)) return null;
    const block = blockOf(els[at], at);
    const span = blockSpan(els.filter((el, i) => blockOf(el, i) === block));
    return { block, fraction: span.height ? Math.min(1, Math.max(0, (top - span.top) / span.height)) : 0 };
  }

  function blockSpan(els: HTMLElement[]): { top: number; height: number } {
    const rects = els.map((el) => el.getBoundingClientRect());
    const top = Math.min(...rects.map((r) => r.top));
    return { top, height: Math.max(...rects.map((r) => r.bottom)) - top };
  }

  /** Switch versions, keeping the same paragraph at the top of the screen. */
  async function setTextMode(mode: 'original' | 'modern') {
    if (mode === (showModern ? 'modern' : 'original')) return;
    const place = blockAtTop();
    devotionalSettings.update({ textMode: mode });
    await tick();
    const scroller = scrollContainer();
    if (!place || !scroller || !bodyEl) return;
    const els = Array.from(bodyEl.children) as HTMLElement[];
    const mine = els.filter((el, i) => (showModern ? Number(el.dataset.b) : i) === place.block);
    if (!mine.length) return;
    const span = blockSpan(mine);
    scroller.scrollTop += span.top + place.fraction * span.height - scroller.getBoundingClientRect().top;
  }

  // ── Words and phrases ────────────────────────────────────────────────────

  let notesOpen = false;
  $: notes = reading?.notes ?? [];

  /** Open the reader at a reference, leaving a crumb that comes back to this reading. */
  function goToRef(osis: string) {
    const t = parseOsisRef(osis);
    if (!t) return;
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'devotional', {
      surface: 'devotional',
      workId: target.workId,
      month: target.month,
      day: target.day,
      slot: target.slot,
      scrollTop: scrollContainer()?.scrollTop ?? 0,
    });
    // navigateToVerse (not navigateTo) so the verse gets the fade highlight.
    navigationStore.navigateToVerse(current.translation, t.book, t.chapter, t.verse ?? 1);
    readingPlanModalStore.close();
  }

  function step(dir: 1 | -1) {
    dispatch('step', { workId: target.workId, ...stepReading(target, dir, bothSlots) });
  }

  // ── Calendar ─────────────────────────────────────────────────────────────

  let calendarOpen = false;

  /** Same book, same morning or evening, the picked date. */
  function onPickDate(e: CustomEvent<{ month: number; day: number }>) {
    calendarOpen = false;
    const { month, day } = e.detail;
    if (month === target.month && day === target.day) return;
    dispatch('step', { workId: target.workId, month, day, slot: target.slot });
  }

  // ── Share ────────────────────────────────────────────────────────────────

  let shareOpen = false;
  $: firstRef = reading?.keyRefs[0] ?? null;
  $: shareSource = `${work.author.replace(/^C\. H\. /, '')} · ${work.title} · ${formatMonthDay(target.month, target.day)}${slotLabel ? `, ${slotLabel.toLowerCase()}` : ''}`;
  // Stored verse text carries poetry and note markers; the share sheet wants plain words.
  $: sharePassage = firstRef && translation ? cleanVersePreviewText(verseCache[`${translation}|${firstRef.osis}`] ?? '') : '';
  $: shareRef = sharePassage && firstRef && firstRef.verseStart != null
    ? { book: normalizeBookName(firstRef.book), chapter: firstRef.chapter, startVerse: firstRef.verseStart, endVerse: firstRef.verseEnd ?? firstRef.verseStart }
    : null;

  function openShare() {
    shareOpen = true;
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="devo-layer no-edge-gesture" use:portal transition:fade={{ duration: 140 }}>
<!-- `themed` takes the reader's light/sepia filter, so the page matches the reader. -->
<div class="devo-viewer themed">
  <div class="dr-top">
    <div class="dr-top-actions">
      {#if reading && shareRef}
        <button class="dr-icon-btn" on:click={openShare} title="Share this reading" aria-label="Share this reading">
          <ShareNetwork size={16} weight="bold" />
        </button>
      {/if}
      <button class="dr-icon-btn" class:open={calendarOpen} on:click={() => (calendarOpen = !calendarOpen)} title="Pick a date" aria-label="Pick a date">
        <CalendarDots size={16} weight="bold" />
      </button>
      <button class="dr-icon-btn" on:click={() => step(-1)} title="Previous reading" aria-label="Previous reading">
        <CaretLeft size={16} weight="bold" />
      </button>
      <button class="dr-icon-btn" on:click={() => step(1)} title="Next reading" aria-label="Next reading">
        <CaretRight size={16} weight="bold" />
      </button>
    </div>
    <div class="dr-top-right">
      {#if hasModern}
        <div class="dr-mode" role="group" aria-label="Text version">
          <button class:active={!showModern} aria-pressed={!showModern} on:click={() => setTextMode('original')}>Original</button>
          <button class:active={showModern} aria-pressed={showModern} on:click={() => setTextMode('modern')}>Modern</button>
        </div>
      {/if}
      {#if notes.length}
        <button class="dr-icon-btn" class:open={notesOpen} on:click={() => (notesOpen = !notesOpen)} title="Words and phrases" aria-label="Words and phrases">
          <Info size={17} weight="bold" />
        </button>
      {/if}
      <button class="dr-close" on:click={() => dispatch('close')} title="Close" aria-label="Close reading">
        <X size={20} weight="bold" />
      </button>
    </div>
    {#if calendarOpen}
      <div class="dr-calendar">
        <DevotionalCalendar month={target.month} day={target.day} reader on:pick={onPickDate} on:close={() => (calendarOpen = false)} />
      </div>
    {/if}
    {#if notesOpen && notes.length}
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="dr-notes-backdrop" on:click={() => (notesOpen = false)}></div>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="dr-notes" role="dialog" tabindex="-1" aria-label="Words and phrases" on:click={onBodyClick} transition:fade={{ duration: 120 }}>
        <h4 class="dr-notes-title">Words and phrases</h4>
        <dl>
          {#each notes as n}
            <dt>{n.term}</dt>
            <dd>{@html sanitizePackHtml(colorRefs(n.html))}</dd>
          {/each}
        </dl>
      </div>
    {/if}
  </div>

  <div class="dr-scroll" bind:this={scrollEl}>
  <div class="devo-reading">

  <header class="dr-header">
    <span class="dr-slot-icon" class:evening={target.slot === 'evening'} class:day={target.slot === 'day'}>
      {#if target.slot === 'morning'}<SunHorizon size={20} weight="bold" />
      {:else if target.slot === 'evening'}<MoonStars size={20} weight="bold" />
      {:else}<CalendarBlank size={20} weight="bold" />{/if}
    </span>
    <div class="dr-header-text">
      <span class="dr-work">{work.title}</span>
      <span class="dr-date">{formatMonthDay(target.month, target.day)}{slotLabel ? ` · ${slotLabel}` : ''}</span>
    </div>
  </header>

  {#if loading}
    <p class="dr-muted show-late">Loading…</p>
  {:else if !reading}
    <p class="dr-muted">This reading isn't in the installed pack.</p>
  {:else if work.workId === 'daily-light'}
    <div class="dl-body">
      {#each paragraphs as para, pi}
        <div class="dl-para" class:dl-theme={pi === 0}>
          {#each para as { k, i } (i)}
            {@const text = verseCache[`${translation}|${k.osis}`]}
            <div class="dl-frag">
              {#if text}
                <p class="dl-text">{@html renderVerseHtml(text)}</p>
              {:else if text === ''}
                <p class="dr-muted">{translationLabel(translation)} doesn't have this verse.</p>
              {/if}
              <button class="dr-ref" style="color:{getBookColor(normalizeBookName(k.book))}" on:click={() => goToRef(k.osis)}>
                {k.label}
              </button>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    {#if reading.title && !/^(Morning|Evening),/.test(reading.title)}
      <h3 class="dr-title">{reading.title}</h3>
    {/if}
    {#each reading.keyRefs as k}
      {@const text = verseCache[`${translation}|${k.osis}`]}
      <div class="dr-headline">
        {#if text}
          <p class="dr-verse">{@html renderVerseHtml(text)}</p>
        {:else if text === ''}
          <p class="dr-muted">{translationLabel(translation)} doesn't have this verse.</p>
        {/if}
        <button class="dr-ref" style="color:{getBookColor(normalizeBookName(k.book))}" on:click={() => goToRef(k.osis)}>
          {k.label}
        </button>
      </div>
    {/each}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="dr-body" bind:this={bodyEl} on:click={onBodyClick}>
      {@html sanitizePackHtml(colorRefs(bodyHtml))}
    </div>
  {/if}
  </div>
  </div>
</div>

  <!-- Inside the layer so it stacks above the page, outside .themed so it keeps
       the dark look it has everywhere else in the Reading Plan window. -->
  {#if shareOpen && shareRef}
    <ShareModal
      reference={shareRef}
      passage={sharePassage}
      translation={translation}
      source={shareSource}
      linkUrl={buildDevotionalUrl(target.workId, target.month, target.day, target.slot)}
      on:close={() => (shareOpen = false)}
    />
  {/if}
</div>

<style>
  /* Above the Reading Plan window (1000) and its popups; below nothing but the share window inside it. */
  .devo-layer {
    position: fixed;
    inset: 0;
    z-index: 10000;
  }
  /* Black under the light/sepia filter turns to the reader's paper; custom brings its own. */
  .devo-viewer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--reader-bg, #000);
    overscroll-behavior: contain;
  }

  /* The portal escaped #app's safe-area padding, so the chrome carries its own. */
  .dr-top {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: calc(env(safe-area-inset-top, 0px) + calc(10px * var(--bar-scale, 1))) calc(env(safe-area-inset-right, 0px) + calc(12px * var(--bar-scale, 1))) calc(6px * var(--bar-scale, 1))
      calc(env(safe-area-inset-left, 0px) + calc(12px * var(--bar-scale, 1)));
  }
  .dr-top-actions {
    display: flex;
    gap: calc(4px * var(--bar-scale, 1));
  }
  .dr-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: calc(30px * var(--bar-scale, 1));
    height: calc(30px * var(--bar-scale, 1));
    border-radius: calc(7px * var(--bar-scale, 1));
    background: none;
    border: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.1));
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.5));
    cursor: pointer;
  }
  .dr-icon-btn:hover,
  .dr-icon-btn.open {
    background: rgba(255, 255, 255, 0.08);
    color: var(--reader-text-dim, rgba(255, 255, 255, 0.8));
  }
  /* The calendar drops down under the buttons, over the reading. */
  .dr-calendar {
    position: absolute;
    top: 100%;
    left: calc(env(safe-area-inset-left, 0px) + 12px);
  }
  .dr-calendar :global(.dc-panel) {
    transform-origin: top left;
  }
  .dr-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: calc(40px * var(--bar-scale, 1));
    height: calc(40px * var(--bar-scale, 1));
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: var(--reader-text, #f2f2f2);
    cursor: pointer;
  }
  .dr-close:hover {
    background: rgba(255, 255, 255, 0.16);
  }
  .dr-top-right {
    display: flex;
    align-items: center;
    gap: calc(6px * var(--bar-scale, 1));
    min-width: 0;
  }

  /* Original / Modern */
  .dr-mode {
    display: flex;
    height: calc(30px * var(--bar-scale, 1));
    border: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.12));
    border-radius: calc(7px * var(--bar-scale, 1));
    overflow: hidden;
  }
  .dr-mode button {
    background: none;
    border: none;
    padding: 0 calc(9px * var(--bar-scale, 1));
    font-size: calc(0.72rem * var(--bar-scale, 1));
    font-weight: 600;
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.5));
    cursor: pointer;
  }
  .dr-mode button + button {
    border-left: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.12));
  }
  .dr-mode button.active {
    background: rgba(230, 184, 74, 0.18);
    color: #e6b84a;
  }
  @media (max-width: 370px) {
    .dr-top-actions {
      gap: calc(2px * var(--bar-scale, 1));
    }
    .dr-mode button {
      padding: 0 calc(6px * var(--bar-scale, 1));
      font-size: calc(0.68rem * var(--bar-scale, 1));
    }
  }

  /* Words and phrases: drops down under the (i), over the reading. */
  .dr-notes-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .dr-notes {
    position: absolute;
    z-index: 31;
    top: 100%;
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    width: min(380px, calc(100vw - 24px));
    max-height: min(65vh, 520px);
    overflow-y: auto;
    overscroll-behavior: contain;
    box-sizing: border-box;
    padding: 12px 16px 6px;
    border-radius: 12px;
    background: var(--reader-bg, #111);
    border: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.14));
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    color: var(--reader-text, rgba(255, 255, 255, 0.85));
  }
  .dr-notes-title {
    margin: 0 0 10px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.45));
  }
  .dr-notes dl {
    margin: 0;
  }
  .dr-notes dt {
    font-weight: 700;
    font-size: 0.9rem;
    color: #e6b84a;
  }
  .dr-notes dd {
    margin: 2px 0 12px;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--reader-text-dim, rgba(255, 255, 255, 0.75));
  }
  .dr-notes :global(a.devo-ref) {
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  .dr-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .devo-reading {
    max-width: 680px;
    margin: 0 auto;
    padding: 12px calc(env(safe-area-inset-right, 0px) + 20px) calc(env(safe-area-inset-bottom, 0px) + 48px)
      calc(env(safe-area-inset-left, 0px) + 20px);
    color: var(--reader-text, rgba(255, 255, 255, 0.88));
  }

  .dr-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.08));
  }
  .dr-slot-icon {
    display: flex;
    padding: 6px;
    border-radius: 8px;
    color: #431407;
    background: radial-gradient(circle, #fde047 0%, #fbbf24 45%, #c2410c 100%);
  }
  .dr-slot-icon.evening {
    color: #e0e7ff;
    background: radial-gradient(circle, #6366f1 0%, #312e81 70%, #1e1b4b 100%);
  }
  .dr-slot-icon.day {
    color: #111;
    background: #e6b84a;
  }
  .dr-header-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dr-work {
    font-size: 1rem;
    font-weight: 700;
  }
  .dr-date {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.45));
  }

  .dr-title {
    margin: 0 0 12px;
    font-size: 1.05rem;
    color: #e6b84a;
  }

  .dr-headline {
    padding: 14px 16px;
    margin-bottom: 16px;
    border-radius: 10px;
    background: rgba(230, 184, 74, 0.06);
    border: 1px solid rgba(230, 184, 74, 0.15);
  }
  .dr-verse {
    margin: 0 0 6px;
    font-style: italic;
    font-size: var(--base-font-size, 18px);
    line-height: 1.6;
  }
  .dr-ref {
    background: none;
    border: none;
    padding: 2px 0;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    cursor: pointer;
    text-align: left;
  }
  .dr-body {
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.7);
  }
  .dr-body :global(p) {
    margin: 0 0 1em;
  }
  .dr-body :global(blockquote) {
    margin: 0 0 1em 1.2em;
    font-style: italic;
    color: var(--reader-text-dim, rgba(255, 255, 255, 0.72));
  }
  .dr-body :global(.sc) {
    font-variant: small-caps;
  }
  .dr-body :global(a.devo-ref) {
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }

  .dl-para {
    margin-bottom: 18px;
  }
  .dl-theme .dl-text {
    font-size: 1.12em;
    color: #e6b84a;
  }
  .dl-frag {
    margin-bottom: 10px;
  }
  .dl-text {
    margin: 0;
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.6);
  }
  .dl-frag .dr-ref {
    display: block;
  }

  .dr-muted {
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.4));
    font-size: 0.85rem;
  }

  /* Bar size: the top bar scales with --bar-scale. Its buttons are fixed
     boxes, so the icons inside are scaled in place to match. */
  .dr-icon-btn :global(svg),
  .dr-close :global(svg) {
    transform: scale(var(--bar-scale, 1));
  }
</style>
