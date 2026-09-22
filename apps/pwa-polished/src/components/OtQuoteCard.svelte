<script lang="ts">
  /**
   * The card that opens when you tap the ❝OT❞ mark in a verse's gutter.
   *
   * It shows two things and nothing else: which Old Testament passage the verse
   * is quoting, and how that passage reads in the Septuagint. No "Quoted"
   * label, no book-colour bar, no rendering of the verse in the translation you
   * are already reading — you know your translation and you can see the words.
   *
   * The Septuagint wording is the entire point. Hebrews 1:7 says God makes his
   * angels spirits and his ministers a flame of fire; an English Psalm 104:4
   * translated from the Hebrew says winds and messengers, and the quotation
   * dissolves. The Greek Old Testament reads exactly what Hebrews reads. So the
   * one piece of chrome that stays is the quiet "Septuagint" line — without it
   * these words look like an error against the psalm you would find by
   * navigating there. That is provenance, not decoration.
   *
   * Positioning is the part that differs from FootnoteCard. That card anchors
   * to its marker's point and falls back to just below it, which for a gutter
   * mark sitting on a verse's first line drops the card straight onto the verse
   * you tapped. Here the anchor is the verse's whole box and staying off it is
   * structural — see placement below.
   */
  import { createEventDispatcher } from 'svelte';
  import { formatOtRef, type OtQuoteEntry } from '../lib/otQuotesIndex';

  /** The tapped verse's box in viewport coordinates — what to stay clear of. */
  export let verseTop = 0;
  export let verseBottom = 0;
  export let verseLeft = 0;
  export let verseWidth = 0;

  export let entry: OtQuoteEntry;
  /** Which of the entry's references is expanded. */
  export let refIndex = 0;
  export let text = '';
  export let busy = false;
  export let unavailable = false;

  const dispatch = createEventDispatcher();

  // Narrower than FootnoteCard's 320: one reference and one sentence, against a
  // note that can run to a paragraph and list a dozen passages.
  const WIDTH = 280;
  const GAP = 10;
  const EDGE = 8;

  let rootEl: HTMLElement;

  /**
   * Move the card to the end of <body>.
   *
   * Mandatory, not tidiness: the light and sepia themes put `filter: invert(1)`
   * on panels, and a CSS filter makes its element the containing block for any
   * fixed-position descendant. Rendered in place the card would be positioned
   * against the panel and clipped away. Same reason FootnoteCard does it.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $: activeRef = entry.refs[refIndex];
  $: hasLxx = !!entry.lxx[refIndex];

  // ── Placement ──────────────────────────────────────────────────────────
  //
  // The rule is not "prefer above, fall back to below" but "never intersect the
  // verse". Whichever side has room takes the card; if neither does, the larger
  // side takes it and the card is capped to fit there. The card is kept small
  // enough (280 × ~200) that a side almost always fits.
  //
  // The height is not known until it renders, so the measured box is used where
  // there is one and a sensible guess on the first frame.
  const MAX_HEIGHT = 200;
  let measured = 150;
  $: if (rootEl) measured = Math.min(rootEl.offsetHeight || measured, MAX_HEIGHT);

  $: viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  $: viewportW = typeof window !== 'undefined' ? window.innerWidth : 400;

  // How much room each side of the verse actually has. A verse scrolled part
  // way off screen has a box reaching past the viewport, so these clamp at zero
  // rather than going negative and reading as room.
  $: roomAbove = Math.max(0, Math.min(verseTop, viewportH) - GAP - EDGE);
  $: roomBelow = Math.max(0, viewportH - Math.max(verseBottom, 0) - GAP - EDGE);

  /** Above when it fits there, below when it fits there, else the larger side. */
  $: placeAbove =
    measured <= roomAbove ? true : measured <= roomBelow ? false : roomAbove > roomBelow;

  /**
   * The height the card is allowed, which is whatever its side actually has.
   *
   * No minimum is enforced. A floor would be the one thing that could put the
   * card back over the verse — precisely what this is here to prevent — and a
   * verse tall enough to leave neither side 70px is a verse filling the screen,
   * where a squeezed card is the honest outcome. Not covering the words you
   * tapped matters more than the card looking comfortable.
   */
  $: cappedHeight = Math.max(0, Math.min(MAX_HEIGHT, placeAbove ? roomAbove : roomBelow));

  /** What the card will actually occupy, once capped. */
  $: height = Math.min(measured, cappedHeight);

  // Anchored to the near edge of the verse and grown away from it, so the card
  // cannot reach the verse from either side. Nothing clamps it back towards the
  // verse afterwards: an edge clamp is what would undo the whole rule.
  $: top = placeAbove ? verseTop - GAP - height : verseBottom + GAP;

  // Centred on the verse rather than on the mark: the mark sits hard against
  // the left gutter, so centring on it would push the card off the left edge on
  // a phone every time.
  $: left = Math.min(
    Math.max(verseLeft + verseWidth / 2 - WIDTH / 2, EDGE),
    Math.max(EDGE, viewportW - WIDTH - EDGE),
  );
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<!-- Hidden rather than squeezed to nothing when the verse leaves no room on
     either side — mid-scroll, with the verse spanning the whole viewport. It
     comes back as soon as a side opens up, because the scroll handler keeps
     remeasuring. -->
<div
  class="ot-card themed"
  class:ot-hidden={cappedHeight < 48}
  bind:this={rootEl}
  use:portal
  style="left:{left}px; top:{top}px; width:{WIDTH}px; max-height:{cappedHeight}px;"
>
  <div class="ot-head">
    <span class="ot-ref">{formatOtRef(activeRef)}</span>
    <button
      class="ot-goto"
      title={hasLxx ? 'Read it in the Septuagint' : 'Go to the passage'}
      on:click|stopPropagation={() => dispatch('goto', { index: refIndex })}
    >→</button>
  </div>

  <!-- A verse can quote several passages at once — Hebrews 1:5 braids three
       together. Showing three verse texts stacked would turn the card into the
       page it is meant to stay off, so the others are labels that swap which
       one is expanded. -->
  {#if entry.refs.length > 1}
    <div class="ot-others">
      {#each entry.refs as ref, i}
        <button
          class="ot-other"
          class:active={i === refIndex}
          on:click|stopPropagation={() => dispatch('select', { index: i })}
        >{formatOtRef(ref)}</button>
      {/each}
    </div>
  {/if}

  <div class="ot-body">
    {#if busy}
      <p class="ot-note">Loading…</p>
    {:else if unavailable}
      <!-- Never a silent fall back to the translation you are reading: those
           would be the wrong words presented as the right ones, which is the
           one failure this card exists to prevent. LXX Jeremiah is ordered
           differently and lxx2012 does not carry every chapter. -->
      <p class="ot-note">No Septuagint text for this passage</p>
    {:else}
      <p class="ot-verse">{@html text}</p>
    {/if}
  </div>

  {#if !busy && !unavailable}
    <div class="ot-foot">Septuagint</div>
  {/if}
</div>

<style>
  .ot-card {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    padding: 7px 10px 8px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid #c9a227;
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .ot-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  .ot-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
  }

  .ot-ref {
    color: #d9b23c;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ot-goto {
    background: #333;
    border: none;
    border-radius: 3px;
    color: #d9b23c;
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 3px 8px;
    flex: 0 0 auto;
  }

  .ot-goto:hover {
    background: #3d3d3d;
    color: #e8c85a;
  }

  .ot-others {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    flex: 0 0 auto;
  }

  .ot-other {
    background: none;
    border: 1px solid #3f3f3f;
    border-radius: 3px;
    color: #8a8a8a;
    cursor: pointer;
    font-size: 0.68rem;
    padding: 2px 6px;
  }

  .ot-other.active {
    border-color: #c9a227;
    color: #d9b23c;
  }

  .ot-body {
    margin-top: 6px;
    overflow-y: auto;
    min-height: 0;
  }

  .ot-verse {
    margin: 0;
    color: #cfcfcf;
    font-size: 0.84rem;
    font-style: italic;
    line-height: 1.45;
  }

  .ot-note {
    margin: 0;
    color: #8a8a8a;
    font-size: 0.78rem;
    font-style: italic;
  }

  /* The one label that stays. Quiet enough to read as a source line rather
     than a heading. */
  .ot-foot {
    margin-top: 5px;
    color: #7d7d7d;
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-align: right;
    text-transform: uppercase;
    flex: 0 0 auto;
  }
</style>
