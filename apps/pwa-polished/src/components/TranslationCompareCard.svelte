<script lang="ts">
  /**
   * The card a verse-number selection's Translation button opens: the same
   * verses in another installed translation, right under them.
   *
   * It opens on a list of your translations. Picking one shows the verses in
   * it, with chips to switch to another. A selection that skipped verses (3
   * and 5, not 4) shows "…" where the gap was.
   *
   * Built on OtQuoteCard's pattern and for the same reasons: portaled to body,
   * always below the verse box, never over the words you tapped.
   */
  import { createEventDispatcher } from 'svelte';
  import { X } from 'phosphor-svelte';
  import { fadeAway, grow } from '../lib/motion';
  import { availableTranslations } from '../stores/navigationStore';
  import { translationLabel, translationSortIndex } from '../lib/bibleData';
  import { verseAtEnglishRef } from '../lib/companion';
  import { toEnglish } from '../lib/versification';
  import { cleanVersePreviewText, renderVersePreviewHtml } from '../lib/verseRendering';
  import { OT_CARD_GAP, OT_CARD_MAX_HEIGHT } from '../lib/otCardMetrics';

  /** The selection's verse box in viewport coordinates — what to stay clear of. */
  export let verseBottom = 0;
  export let verseLeft = 0;
  export let verseWidth = 0;

  export let book: string;
  export let chapter: number;
  /** The verses the selection touches, in the reader's numbering, ascending. */
  export let verses: number[] = [];
  /** The translation being read, left off the list. */
  export let readerTranslation: string;

  const dispatch = createEventDispatcher();

  const WIDTH = 300;
  const GAP = OT_CARD_GAP;
  const EDGE = 8;
  const MAX_HEIGHT = OT_CARD_MAX_HEIGHT;
  const MIN_HEIGHT = 96;


  /** Out of any themed panel's filter, as OtQuoteCard explains. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $: options = $availableTranslations
    .filter((t) => t.toLowerCase() !== readerTranslation.toLowerCase())
    .sort((a, b) => translationSortIndex(a) - translationSortIndex(b));

  interface Row {
    verse: number;
    html: string;
    missing: boolean;
    /** A verse was skipped before this one. */
    gapBefore: boolean;
  }

  let picked: string | null = null;
  let rows: Row[] = [];
  let busy = false;
  let ticket = 0;

  /**
   * The verse in English numbering first, so verseAtEnglishRef can find it
   * wherever `translation` numbers it — Hebrew Malachi 3:19 is English 4:1.
   */
  async function verseIn(translation: string, verse: number): Promise<string> {
    const mapped = toEnglish(readerTranslation, { book, chapter, verse });
    const english = mapped.find((r) => r.part !== 'title') ?? mapped[0];
    if (!english) return '';
    return verseAtEnglishRef(translation, english.book, english.chapter, english.verse);
  }

  async function pick(translation: string) {
    const mine = ++ticket;
    picked = translation;
    busy = true;
    try {
      const texts = await Promise.all(verses.map((v) => verseIn(translation, v).catch(() => '')));
      if (mine !== ticket) return;
      rows = verses.map((verse, i) => {
        const text = texts[i];
        const missing = !text || cleanVersePreviewText(text) === '';
        return {
          verse,
          html: missing ? '' : renderVersePreviewHtml(text),
          missing,
          gapBefore: i > 0 && verse > verses[i - 1] + 1,
        };
      });
    } finally {
      if (mine === ticket) busy = false;
    }
  }

  $: numbered = verses.length > 1;

  // ── Placement: OtQuoteCard's rules, unchanged ───────────────────────────
  $: viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  $: viewportW = typeof window !== 'undefined' ? window.innerWidth : 400;
  $: roomBelow = Math.max(0, viewportH - Math.max(verseBottom, 0) - GAP - EDGE);
  $: cappedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, roomBelow));
  $: top = verseBottom + GAP;
  $: left = Math.min(
    Math.max(verseLeft + verseWidth / 2 - WIDTH / 2, EDGE),
    Math.max(EDGE, viewportW - WIDTH - EDGE),
  );
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div
  class="tc-card themed"
  use:portal
  use:grow={new DOMRect(verseLeft, verseBottom - 1, verseWidth, 1)}
  out:fadeAway
  style="left:{left}px; top:{top}px; width:{WIDTH}px; max-height:{cappedHeight}px;"
>
  <div class="tc-head">
    <span class="tc-title">{picked ? 'Translation' : 'Read it in'}</span>
    <button class="tc-close" title="Close" on:click|stopPropagation={() => dispatch('close')}>
      <X size={13} weight="bold" />
    </button>
  </div>

  {#if options.length === 0}
    <p class="tc-note">No other translations installed</p>
  {:else if !picked}
    <div class="tc-list">
      {#each options as t}
        <button class="tc-option" on:click|stopPropagation={() => pick(t)}>{translationLabel(t)}</button>
      {/each}
    </div>
  {:else}
    <div class="tc-chips">
      {#each options as t}
        <button
          class="tc-chip"
          class:active={t === picked}
          on:click|stopPropagation={() => t !== picked && pick(t)}
        >{translationLabel(t)}</button>
      {/each}
    </div>

    <div class="tc-body">
      {#if busy}
        <p class="tc-note show-late">Loading…</p>
      {:else}
        <p class="tc-verse">
          {#each rows as row}
            {#if row.gapBefore}<span class="tc-gap">…</span>{/if}
            {#if numbered}<sup class="tc-num">{row.verse}</sup>{/if}
            {#if row.missing}
              <span class="tc-missing">Not in this translation</span>
            {:else}
              {@html row.html}
            {/if}
            {' '}
          {/each}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tc-card {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    padding: 7px 10px 8px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid #e879f9;
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .tc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
  }

  .tc-title {
    color: #e9a6f5;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    line-height: 1.2;
    opacity: 0.8;
    text-transform: uppercase;
  }

  .tc-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    border-radius: 3px;
    color: #8a8a8a;
    cursor: pointer;
    padding: 0;
  }

  .tc-close:hover {
    background: #333;
    color: #cfcfcf;
  }

  .tc-list,
  .tc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    flex: 0 0 auto;
  }

  .tc-option {
    background: #333;
    border: none;
    border-radius: 3px;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 0.74rem;
    padding: 5px 9px;
  }

  .tc-option:hover {
    background: #3d3d3d;
  }

  .tc-chip {
    background: none;
    border: 1px solid #3f3f3f;
    border-radius: 3px;
    color: #cfcfcf;
    cursor: pointer;
    font-size: 0.68rem;
    opacity: 0.55;
    padding: 2px 6px;
  }

  .tc-chip.active {
    border-color: #e879f9;
    opacity: 1;
  }

  .tc-body {
    margin-top: 6px;
    overflow-y: auto;
    min-height: 0;
  }

  .tc-verse {
    margin: 0;
    color: #cfcfcf;
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .tc-num {
    color: #8a8a8a;
    font-size: 0.62rem;
    margin-inline-end: 2px;
  }

  .tc-gap {
    color: #8a8a8a;
    margin-inline-end: 4px;
  }

  .tc-missing,
  .tc-note {
    color: #8a8a8a;
    font-size: 0.78rem;
    font-style: italic;
  }

  .tc-note {
    margin: 6px 0 0;
  }
</style>
