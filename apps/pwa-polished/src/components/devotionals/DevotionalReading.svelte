<script lang="ts">
  /**
   * One devotional reading.
   *
   * Spurgeon (Morning and Evening, Faith's Checkbook): his headline verse in the
   * King James wording he wrote about, the same verse in the reader's own
   * translation under it, then his text. Daily Light: Bagster's fragments as he
   * arranged them, each with its reference; tapping a fragment opens the full
   * verse(s) under it in the reader's translation.
   *
   * Every reference opens the reader with the fade highlight and leaves a
   * BookBookmark crumb that brings you back here, scrolled where you were.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { SunHorizon, MoonStars, CalendarBlank, CaretLeft, CaretRight, ShareNetwork } from 'phosphor-svelte';
  import { navigationStore } from '../../stores/navigationStore';
  import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
  import { devotionalSettings, type DevotionalTarget } from '../../stores/devotionalStore';
  import { IndexedDBTextStore } from '../../lib/adapters';
  import { renderVerseHtml } from '../../lib/verseRendering';
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

  const dispatch = createEventDispatcher<{ back: void; step: DevotionalTarget }>();
  const textStore = new IndexedDBTextStore();

  let reading: DevotionalReading | null = null;
  let loading = true;
  let rootEl: HTMLElement;

  $: translation = $navigationStore.translation;
  $: isNet = translation?.toLowerCase() === 'net';
  $: isKjv = translation?.toLowerCase() === 'kjv';
  $: bothSlots = work.hasSlots && $devotionalSettings.slotMode === 'both';
  $: slotLabel = target.slot === 'morning' ? 'Morning' : target.slot === 'evening' ? 'Evening' : '';

  $: load(target.workId, target.month, target.day, target.slot);

  let loadToken = 0;
  async function load(workId: string, month: number, day: number, slot: DevotionalTarget['slot']) {
    const token = ++loadToken;
    loading = true;
    expanded = new Set();
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
    return (rootEl?.closest('.tab-content') as HTMLElement | null) ?? null;
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

  // The Spurgeon headline's translation line follows the reader's translation, and is left
  // out when it would only repeat the King James words above it.
  $: if (reading && work.workId !== 'daily-light' && translation && !isKjv) {
    for (const k of reading.keyRefs) loadVerse(k, translation);
  }

  // Re-fetch any open Daily Light verses if the translation changes while the reading is up.
  $: if (reading && translation) {
    for (const i of expanded) {
      const k = reading.keyRefs[i];
      if (k) loadVerse(k, translation);
    }
  }

  // ── Daily Light fragments ────────────────────────────────────────────────

  let expanded = new Set<number>();

  function toggle(i: number) {
    const next = new Set(expanded);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    expanded = next;
  }

  /** Fragments grouped into Bagster's paragraphs, keeping each one's index into keyRefs. */
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

  /** KJV text with its [supplied words] set in italics, as a printed KJV shows them. */
  function kjvHtml(text: string): string {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/\[([^\]]+)\]/g, '<em>$1</em>');
  }

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
  $: sharePassage = firstRef
    ? (translation && !isKjv && verseCache[`${translation}|${firstRef.osis}`]) || firstRef.kjvText
    : '';
  $: shareTranslation = firstRef && translation && !isKjv && verseCache[`${translation}|${firstRef.osis}`] ? translation : 'KJV';
  $: shareRef = firstRef && firstRef.verseStart != null
    ? { book: normalizeBookName(firstRef.book), chapter: firstRef.chapter, startVerse: firstRef.verseStart, endVerse: firstRef.verseEnd ?? firstRef.verseStart }
    : null;

  async function openShare() {
    if (firstRef && translation && !isKjv) await loadVerse(firstRef, translation);
    shareOpen = true;
  }
</script>

<div class="devo-reading" bind:this={rootEl}>
  <div class="dr-top">
    <button class="dr-back" on:click={() => dispatch('back')}>
      <CaretLeft size={14} weight="bold" /> Devotionals
    </button>
    <div class="dr-top-actions">
      {#if reading && shareRef}
        <button class="dr-icon-btn" on:click={openShare} title="Share this reading" aria-label="Share this reading">
          <ShareNetwork size={18} weight="bold" />
        </button>
      {/if}
      <button class="dr-icon-btn" on:click={() => step(-1)} title="Previous reading" aria-label="Previous reading">
        <CaretLeft size={18} weight="bold" />
      </button>
      <button class="dr-icon-btn" on:click={() => step(1)} title="Next reading" aria-label="Next reading">
        <CaretRight size={18} weight="bold" />
      </button>
    </div>
  </div>

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
            <div class="dl-frag">
              <button class="dl-frag-text" class:open={expanded.has(i)} on:click={() => toggle(i)}>
                {@html kjvHtml(k.fragment ?? k.kjvText)}
              </button>
              <button class="dr-ref" style="color:{getBookColor(normalizeBookName(k.book))}" on:click={() => goToRef(k.osis)}>
                {k.label}
              </button>
              {#if expanded.has(i)}
                {@const text = verseCache[`${translation}|${k.osis}`]}
                <div class="dl-expand">
                  {#if text === undefined}
                    <span class="dr-muted">Loading…</span>
                  {:else if text}
                    <span class="dr-trans-text">{@html renderVerseHtml(text)}</span>
                    <span class="dr-trans-tag">({#if isNet}<a href="https://netbible.org" target="_blank" rel="noopener noreferrer">NET</a>{:else}{translationLabel(translation)}{/if})</span>
                  {:else}
                    <span class="dr-muted">{translationLabel(translation)} doesn't have this verse.</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
      <p class="dr-footnote">Bagster's words are the King James Version. Tap any line to read it in {translationLabel(translation)}.</p>
    </div>
  {:else}
    {#if reading.title && !/^(Morning|Evening),/.test(reading.title)}
      <h3 class="dr-title">{reading.title}</h3>
    {/if}
    {#each reading.keyRefs as k}
      {@const text = translation && !isKjv ? verseCache[`${translation}|${k.osis}`] : ''}
      <div class="dr-headline">
        <p class="dr-kjv">“{@html kjvHtml(k.kjvText)}”</p>
        <button class="dr-ref" style="color:{getBookColor(normalizeBookName(k.book))}" on:click={() => goToRef(k.osis)}>
          {k.label}
        </button>
        {#if text}
          <p class="dr-trans">
            <span class="dr-trans-text">{@html renderVerseHtml(text)}</span>
            <span class="dr-trans-tag">({#if isNet}<a href="https://netbible.org" target="_blank" rel="noopener noreferrer">NET</a>{:else}{translationLabel(translation)}{/if})</span>
          </p>
        {/if}
      </div>
    {/each}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="dr-body" on:click={onBodyClick}>
      {@html sanitizePackHtml(colorRefs(reading.bodyHtml))}
    </div>
  {/if}
</div>

{#if shareOpen && shareRef}
  <ShareModal
    reference={shareRef}
    passage={sharePassage}
    translation={shareTranslation}
    source={shareSource}
    linkUrl={buildDevotionalUrl(target.workId, target.month, target.day, target.slot)}
    on:close={() => (shareOpen = false)}
  />
{/if}

<style>
  .devo-reading {
    color: rgba(255, 255, 255, 0.88);
  }

  .dr-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .dr-back {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: #e6b84a;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    padding: 6px 4px;
  }
  .dr-top-actions {
    display: flex;
    gap: 6px;
  }
  .dr-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
  }
  .dr-icon-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .dr-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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
    color: rgba(255, 255, 255, 0.45);
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
  .dr-kjv {
    margin: 0 0 6px;
    font-style: italic;
    font-size: var(--base-font-size, 18px);
    line-height: 1.6;
  }
  .dr-kjv :global(em) {
    font-style: normal;
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
  .dr-trans {
    margin: 10px 0 0;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.95rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
  }
  .dr-trans-tag {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }
  .dr-trans-tag a {
    color: inherit;
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
    color: rgba(255, 255, 255, 0.72);
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
  .dl-theme .dl-frag-text {
    font-size: 1.12em;
    color: #e6b84a;
  }
  .dl-frag {
    margin-bottom: 10px;
  }
  .dl-frag-text {
    display: block;
    width: 100%;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    padding: 2px 0 2px 8px;
    margin-left: -10px;
    color: inherit;
    font: inherit;
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.6);
    text-align: left;
    cursor: pointer;
  }
  .dl-frag-text.open {
    border-left-color: #e6b84a;
  }
  .dl-frag .dr-ref {
    display: block;
    margin-left: 0;
  }
  .dl-expand {
    margin: 6px 0 4px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    font-size: 0.95rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
  }

  .dr-muted {
    color: rgba(255, 255, 255, 0.4);
    font-size: 0.85rem;
  }
  .dr-footnote {
    margin-top: 20px;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.35);
  }
</style>
