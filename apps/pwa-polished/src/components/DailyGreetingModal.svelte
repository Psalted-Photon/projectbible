<script lang="ts">
  import { dailyGreetingOpen, dismissDailyGreeting } from '../stores/dailyGreetingStore';
  import { welcomePending } from '../stores/welcomeStore';
  import { localDateStr } from '../stores/clockStore';
  import { navigationStore } from '../stores/navigationStore';
  import { IndexedDBTextStore } from '../lib/adapters';
  import { get } from 'svelte/store';
  import verseOfDay from '../data/verse-of-the-day.json';
  import { renderVerseHtml } from '../lib/verseRendering';
  import { DEFAULT_TRANSLATION, getBookChapters, translationLabel } from '../lib/bibleData';
  import { testamentOf } from '../lib/testamentDefaults';
  import { booksInTranslation } from '../lib/translationBooks';
  import { mtToLxxPsalm } from '../lib/lxxPsalms';
  import { Sun, ArrowRight, SunHorizon, MoonStars, CalendarBlank } from 'phosphor-svelte';
  import { isDevotionalsInstalled, type DevotionalSlot } from '../lib/devotionals/devotionalsData';
  import { currentSlotStore, todayMonthDay, ONE_A_DAY_WORKS } from '../lib/devotionals/slot';
  import { devotionalSettings, openDevotional } from '../stores/devotionalStore';

  const textStore = new IndexedDBTextStore();

  // Parse "Book Ch:V" or "Book Ch:V1-V2" → structured object. A one-chapter
  // book may give verses alone ("Jude 24-25"), which means chapter 1.
  function parseRef(ref: string) {
    const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (m) {
      return {
        book: m[1],
        chapter: parseInt(m[2], 10),
        startVerse: parseInt(m[3], 10),
        endVerse: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10),
      };
    }
    const one = ref.match(/^(.+?)\s+(\d+)(?:-(\d+))?$/);
    if (!one || getBookChapters(one[1]) !== 1) return null;
    return {
      book: one[1],
      chapter: 1,
      startVerse: parseInt(one[2], 10),
      endVerse: one[3] ? parseInt(one[3], 10) : parseInt(one[2], 10),
    };
  }

  // The list's references use English verse numbers. The Septuagint runs a
  // psalm behind, which lib/lxxPsalms converts; the Hebrew (and the LXX lemma
  // text) also counts psalm titles as verses and starts a few chapters early
  // or late. In these a chapter is only used when it has as many verses as the
  // English, so the card says the verse isn't available rather than quietly
  // showing a different one.
  const LXX_NUMBERING = new Set(['lxx', 'lxx2012']);
  const OWN_NUMBERING = new Set(['hebrew-oshb', 'wlc', ...LXX_NUMBERING]);

  interface VerseSpan { chapter: number; startVerse: number; endVerse: number }

  // State (re-evaluated each time modal opens)
  let todayStr = '';
  let verseRef = '';
  let parsed: ReturnType<typeof parseRef> = null;
  let verseText = '';
  /** Where the verse sits in the reader's translation (LXX Psalms differ). */
  let verseAt: VerseSpan | null = null;
  let verseTranslation = '';
  let unavailable = '';
  let textLoading = false;

  // Reload content whenever the modal opens
  $: if ($dailyGreetingOpen) {
    todayStr = localDateStr(new Date());
    const mmdd = todayStr.slice(5); // "MM-DD"
    verseRef = (verseOfDay as Record<string, string>)[mmdd] ?? '';
    parsed = parseRef(verseRef);
    verseText = '';
    verseAt = null;
    verseTranslation = '';
    unavailable = '';
    textLoading = true;
    loadVerseText();
  }

  // Always the reader's translation, never another one borrowed in its place:
  // when it hasn't got the verse, the card says so.
  async function loadVerseText() {
    if (!parsed) { textLoading = false; return; }
    const p = parsed;
    const translation = get(navigationStore).translation;
    const id = translation.toLowerCase();
    const label = translationLabel(translation);

    const books = await booksInTranslation(translation);
    if (books && !books.has(p.book)) {
      const testament = testamentOf(p.book);
      const hasTestament = [...books].some((b) => testamentOf(b) === testament);
      unavailable = hasTestament
        ? `Not available in ${label}.`
        : `Not available in ${label}, which has the ${testament === 'NT' ? 'Old' : 'New'} Testament only.`;
      textLoading = false;
      return;
    }

    let at: VerseSpan | null = { chapter: p.chapter, startVerse: p.startVerse, endVerse: p.endVerse };
    let checkCount = OWN_NUMBERING.has(id);
    if (LXX_NUMBERING.has(id) && p.book === 'Psalm') {
      const s = mtToLxxPsalm(p.chapter, p.startVerse);
      const e = mtToLxxPsalm(p.chapter, p.endVerse);
      at = s && e && s.chapter === e.chapter ? { chapter: s.chapter, startVerse: s.verse, endVerse: e.verse } : null;
      // The conversion is checked against lxx2012 at build time. The lemma
      // text counts titles as verses on top, so it still gets the count check.
      if (id === 'lxx2012') checkCount = false;
    }
    if (at && checkCount) {
      const [own, english] = await Promise.all([
        textStore.getChapter(translation, p.book, at.chapter),
        textStore.getChapter(DEFAULT_TRANSLATION, p.book, p.chapter),
      ]);
      if (own[own.length - 1]?.verse !== english[english.length - 1]?.verse) at = null;
    }
    if (!at) {
      unavailable = `Not available in ${label}, which numbers the verses of this chapter differently.`;
      textLoading = false;
      return;
    }

    const parts: string[] = [];
    for (let v = at.startVerse; v <= at.endVerse; v++) {
      const t = await textStore.getVerse(translation, p.book, at.chapter, v);
      if (t) parts.push(t);
    }
    verseText = parts.join(' ');
    if (verseText) {
      verseAt = at;
      verseTranslation = translation;
    } else unavailable = `Not available in ${label}.`;
    textLoading = false;
  }

  // Where the verse is in the translation, when its numbers differ from the
  // list's: Psalm 103:5-7 is "Psalm 102:5-7" in LXX2012.
  $: ownRef =
    parsed && verseAt && (verseAt.chapter !== parsed.chapter || verseAt.startVerse !== parsed.startVerse)
      ? `${parsed.book} ${verseAt.chapter}:${verseAt.startVerse}${verseAt.endVerse !== verseAt.startVerse ? `-${verseAt.endVerse}` : ''}`
      : '';

  // ── Today's devotional ──────────────────────────────────────────────────
  // Hidden until the pack is in. "Morning" before noon and "Evening" after, by
  // the timezone setting, flipping while the card is open; a fixed Morning or
  // Evening setting holds all day, and Faith's Checkbook is "Today's".
  let devoInstalled = false;
  $: if ($dailyGreetingOpen) isDevotionalsInstalled().then((v) => (devoInstalled = v));
  $: devoWork = $devotionalSettings.mainWork;
  let devoSlot: DevotionalSlot;
  $: devoSlot = ONE_A_DAY_WORKS.has(devoWork)
    ? 'day'
    : $devotionalSettings.slotMode === 'both'
      ? $currentSlotStore
      : $devotionalSettings.slotMode;
  $: devoLabel = devoSlot === 'day' ? "Today's Devotional" : devoSlot === 'morning' ? 'Morning Devotional' : 'Evening Devotional';

  function openDevo() {
    const { month, day } = todayMonthDay();
    openDevotional({ workId: devoWork, month, day, slot: devoSlot });
    close();
  }

  // Closing counts as reading it — marks today seen so it stays closed.
  function close() {
    dismissDailyGreeting();
  }

  function goToVerse() {
    if (!parsed || !verseAt) { close(); return; }
    const current = get(navigationStore);
    // Push current location so the navbar back arrow can return here
    navigationStore.pushHistory(current);
    // navigateToVerse (not navigateTo) so the verse gets the category-colored fade highlight
    navigationStore.navigateToVerse(current.translation, parsed.book, verseAt.chapter, verseAt.startVerse);
    close();
  }
</script>

<!-- A brand-new account gets the welcome first; both cards are fixed at the
     same depth, so they would otherwise stack. The greeting stays open
     underneath and appears the moment the welcome is closed. -->
{#if $dailyGreetingOpen && !$welcomePending}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="dg-overlay" on:click={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
    <div class="dg-card" on:click|stopPropagation role="dialog" aria-modal="true" aria-label="Daily greeting">
      <!-- Header -->
      <div class="dg-header">
        <span class="dg-icon"><Sun size={18} weight="bold" /><span class="icon-overlay"><Sun size={18} weight="thin" /></span></span>
        <div class="dg-header-text">
          <span class="dg-title">Verse of the Day</span>
          <span class="dg-date-label">
            {#if todayStr}
              {new Date(todayStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {/if}
          </span>
        </div>
      </div>

      <!-- Verse -->
      <div class="dg-verse-block">
        <div class="dg-verse-ref">{verseRef}</div>
        {#if textLoading}
          <p class="dg-verse-text dg-loading show-late">Loading…</p>
        {:else if verseText}
          <p class="dg-verse-text">{@html renderVerseHtml(verseText)}</p>
          <!-- The card always reads the reader's translation, which the bar
               already names; only a different verse number needs saying. -->
          {#if ownRef}
            <div class="dg-own-ref">{ownRef} in {translationLabel(verseTranslation)}</div>
          {/if}
        {:else if unavailable}
          <p class="dg-verse-text dg-unavailable">{unavailable}</p>
        {/if}
      </div>

      {#if devoInstalled}
        <button class="dg-devo" class:evening={devoSlot === 'evening'} on:click={openDevo}>
          <span class="dg-devo-icon">
            {#if devoSlot === 'morning'}<SunHorizon size={18} weight="bold" />{:else if devoSlot === 'evening'}<MoonStars size={18} weight="bold" />{:else}<CalendarBlank size={18} weight="bold" />{/if}
          </span>
          <span class="dg-devo-label">{devoLabel}</span>
          <ArrowRight size={14} weight="bold" />
        </button>
      {/if}

      <!-- Actions -->
      <div class="dg-actions">
        {#if parsed && verseAt}
          <button class="dg-btn-primary" on:click={goToVerse}>
            Read in context <ArrowRight size={14} weight="bold" />
          </button>
        {/if}
        <button class="dg-btn-secondary" on:click={close}>Dismiss</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dg-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
    backdrop-filter: blur(4px);
  }

  .dg-card {
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Header ──────────────────────────────────────────────── */
  .dg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .dg-icon {
    color: #431407;
    background: radial-gradient(circle, #fde047 0%, #fde047 20%, #431407 100%);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.dg-icon > svg) {
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
  }

  .dg-header-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dg-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 0.01em;
  }

  .dg-date-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  /* ── Verse block ─────────────────────────────────────────── */
  .dg-verse-block {
    padding: 18px 20px;
    background: rgba(230, 184, 74, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .dg-verse-ref {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #e6b84a;
    margin-bottom: 10px;
  }

  .dg-verse-text {
    margin: 0;
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.8);
    color: rgba(255, 255, 255, 0.85);
    font-style: italic;
  }

  .dg-loading {
    color: rgba(255, 255, 255, 0.35);
    font-style: normal;
    font-size: 0.85rem;
  }

  .dg-unavailable {
    color: rgba(255, 255, 255, 0.3);
    font-style: normal;
    font-size: 0.82rem;
  }

  .dg-own-ref {
    margin-top: 10px;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.35);
  }

  /* ── Today's devotional ──────────────────────────────────── */
  .dg-devo {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 20px;
    background: none;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .dg-devo:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .dg-devo-icon {
    display: flex;
    padding: 4px;
    border-radius: 6px;
    color: #431407;
    background: radial-gradient(circle, #fde047 0%, #fbbf24 45%, #c2410c 100%);
  }
  .dg-devo.evening .dg-devo-icon {
    color: #e0e7ff;
    background: radial-gradient(circle, #6366f1 0%, #312e81 70%, #1e1b4b 100%);
  }
  .dg-devo-label {
    flex: 1;
  }

  /* ── Actions ─────────────────────────────────────────────── */
  .dg-actions {
    display: flex;
    gap: 10px;
    padding: 16px 20px;
    justify-content: flex-end;
  }

  .dg-btn-primary {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #e6b84a;
    color: #111;
    border: none;
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .dg-btn-primary:hover {
    background: #f0c96a;
  }

  .dg-btn-secondary {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .dg-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
  }

  /* ── Mobile ──────────────────────────────────────────────── */
  @media (max-width: 520px) {
    .dg-card {
      max-width: 100%;
      border-radius: 12px;
    }
    .dg-actions {
      flex-direction: column-reverse;
    }
    .dg-btn-primary,
    .dg-btn-secondary {
      width: 100%;
      justify-content: center;
    }
  }
</style>
