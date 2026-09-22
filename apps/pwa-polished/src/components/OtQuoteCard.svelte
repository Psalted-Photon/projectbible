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
   * you tapped. Here the anchor is the verse's whole box and the card always
   * sits below it — see placement below.
   */
  import { createEventDispatcher } from 'svelte';
  import { formatOtRef, type OtQuoteEntry } from '../lib/otQuotesIndex';
  import { OT_CARD_GAP, OT_CARD_MAX_HEIGHT } from '../lib/otCardMetrics';

  /**
   * The tapped verse's box in viewport coordinates — what to stay clear of.
   *
   * Only the bottom edge matters now that the card is always below the verse,
   * so the top is not passed. The left edge and width are for centring.
   */
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
  const GAP = OT_CARD_GAP;
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

  // Which grade of claim this is. The gutter mark carries it in its colour, but
  // that colour is gone the moment the card covers the mark, so the card says
  // it in words. "Echoing" rather than "alludes to": it is the word used for
  // exactly this relationship, and it is short enough never to wrap beside →.
  $: isAllusion = entry.grade === 'allusion';
  $: gradeLabel = isAllusion ? 'Echoing' : 'Quoting';

  // ── Placement ──────────────────────────────────────────────────────────
  //
  // Always below the verse. Never above, even when above has more room: above
  // the verse is where the verse you were just reading is, and covering it is
  // the one thing this card must not do. Choosing the roomier side would put
  // the card there roughly half the time, which is why that choice is gone.
  //
  // Room below is not this file's problem to solve either. The reader nudges
  // itself down on open (nudgeOtCardIntoView in BibleReader) so that a whole
  // card fits, the way the radial ring does, and the scroll handler re-measures
  // as it goes. What is left here is the last-resort guard: if the verse's
  // bottom has genuinely gone off the screen mid-scroll, the card hides rather
  // than squeezing to nothing.
  //
  // The height is not known until it renders, so the measured box is used where
  // there is one and a sensible guess on the first frame.
  const MAX_HEIGHT = OT_CARD_MAX_HEIGHT;
  let measured = 150;
  $: if (rootEl) measured = Math.min(rootEl.offsetHeight || measured, MAX_HEIGHT);

  $: viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  $: viewportW = typeof window !== 'undefined' ? window.innerWidth : 400;

  // How much room there is under the verse. A verse scrolled part way off the
  // bottom has a box reaching past the viewport, so this clamps at zero rather
  // than going negative and reading as room.
  $: roomBelow = Math.max(0, viewportH - Math.max(verseBottom, 0) - GAP - EDGE);

  /**
   * The height the card is allowed, which is whatever is under the verse.
   *
   * No minimum is enforced. A floor would be the one thing that could put the
   * card back over the verse — precisely what this is here to prevent — and a
   * verse whose bottom is at the foot of the screen is one the reader has
   * already tried to scroll out of the way. Not covering the words you tapped
   * matters more than the card looking comfortable.
   */
  $: cappedHeight = Math.max(0, Math.min(MAX_HEIGHT, roomBelow));

  // Anchored to the verse's bottom edge and grown downward, so the card cannot
  // reach the verse. Nothing clamps it back upward afterwards: an upward clamp
  // is what would undo the whole rule.
  //
  // In paragraph layout a .verse is an inline box, and getBoundingClientRect
  // returns the union of its line boxes — so verseBottom is the bottom of the
  // verse's last line whether it runs to one line or six. No per-line walking
  // is needed; the box already measured is the right one.
  $: top = verseBottom + GAP;

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
  class:ot-echo={isAllusion}
  bind:this={rootEl}
  use:portal
  style="left:{left}px; top:{top}px; width:{WIDTH}px; max-height:{cappedHeight}px;"
>
  <div class="ot-head">
    <div class="ot-head-lines">
      <span class="ot-grade">{gradeLabel}</span>
      <span class="ot-ref">{formatOtRef(activeRef)}</span>
    </div>
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
  /* One accent colour per card, and it is the colour of the mark you tapped:
     gold for a quotation, silver for an echo. Held in a custom property so the
     edge, the grade line and the reference all turn together — the card should
     read as the same object as the mark, not as a panel with a coloured word
     in it. --ot-ink is the same hue lifted for text, which needs more contrast
     against #2a2a2a than a 3px border does. */
  .ot-card {
    --ot-accent: #c9a227;
    --ot-ink: #d9b23c;
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    padding: 7px 10px 8px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid var(--ot-accent);
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .ot-card.ot-echo {
    --ot-accent: #b8c4cc;
    --ot-ink: #cbd6de;
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

  /* Two stacked lines against the → button, which stays centred on the pair. */
  .ot-head-lines {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  /* Same quiet register as the SEPTUAGINT foot line, so it reads as a caption
     over the reference rather than as a heading of its own. */
  .ot-grade {
    color: var(--ot-ink);
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    line-height: 1.2;
    opacity: 0.75;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .ot-ref {
    color: var(--ot-ink);
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
    color: var(--ot-ink);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1;
    padding: 3px 8px;
    flex: 0 0 auto;
  }

  .ot-goto:hover {
    background: #3d3d3d;
    filter: brightness(1.12);
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
    border-color: var(--ot-accent);
    color: var(--ot-ink);
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
