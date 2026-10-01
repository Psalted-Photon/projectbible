<script lang="ts">
  /**
   * One devotional reading.
   *
   * Spurgeon (Morning and Evening, Faith's Checkbook): his headline verse, then
   * his text. Daily Light: Bagster's references in his paragraphs. Only the
   * references come from the pack; every verse shown is the reader's own
   * translation, so there is one translation on the page and no label for it.
   *
   * Every reference opens the reader with the fade highlight and leaves a
   * BookBookmark crumb that brings you back here, scrolled where you were.
   *
   * Shown full screen over the Reading Plan window, with nothing but the text,
   * in the reader's own colours (black on dark, paper on light and sepia, the
   * chosen colours on custom): the X closes it back to the Devotionals tab.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { fade } from 'svelte/transition';
  import { SunHorizon, MoonStars, CalendarBlank, CaretLeft, CaretRight, ShareNetwork, X } from 'phosphor-svelte';
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
    // The share window handles its own Escape.
    if (e.key === 'Escape' && !shareOpen) {
      e.preventDefault();
      dispatch('close');
    }
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

  function onBodyClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a.devo-ref') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const osis = a.getAttribute('data-osis');
    if (osis) goToRef(osis);
  }

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
      <button class="dr-icon-btn" on:click={() => step(-1)} title="Previous reading" aria-label="Previous reading">
        <CaretLeft size={16} weight="bold" />
      </button>
      <button class="dr-icon-btn" on:click={() => step(1)} title="Next reading" aria-label="Next reading">
        <CaretRight size={16} weight="bold" />
      </button>
    </div>
    <button class="dr-close" on:click={() => dispatch('close')} title="Close" aria-label="Close reading">
      <X size={20} weight="bold" />
    </button>
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
    <p class="dr-muted">Loading…</p>
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
    <div class="dr-body" on:click={onBodyClick}>
      {@html sanitizePackHtml(colorRefs(reading.bodyHtml))}
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    padding: calc(env(safe-area-inset-top, 0px) + 10px) calc(env(safe-area-inset-right, 0px) + 12px) 6px
      calc(env(safe-area-inset-left, 0px) + 12px);
  }
  .dr-top-actions {
    display: flex;
    gap: 4px;
  }
  .dr-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: none;
    border: 1px solid var(--reader-rule, rgba(255, 255, 255, 0.1));
    color: var(--reader-text-dimmer, rgba(255, 255, 255, 0.5));
    cursor: pointer;
  }
  .dr-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--reader-text-dim, rgba(255, 255, 255, 0.8));
  }
  .dr-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: var(--reader-text, #f2f2f2);
    cursor: pointer;
  }
  .dr-close:hover {
    background: rgba(255, 255, 255, 0.16);
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
</style>
