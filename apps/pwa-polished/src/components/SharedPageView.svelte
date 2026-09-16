<script lang="ts">
  /**
   * One shared page, read-only.
   *
   * A local note is read back through the editor, because you are always
   * allowed to write in it. A shared page is often somebody else's, so the
   * default is reading, and this draws the page without an editor anywhere
   * near it.
   *
   * Two things it has to get right. The HTML is a stranger's, so it goes
   * through the allowlist again here even though the store already cleaned it
   * on the way in — the cost is nothing and it means no path exists by which
   * unchecked markup reaches innerHTML. And verse references have to keep
   * working: they survive as spans carrying the same data attributes
   * BibleRefNode writes, so a tap opens the same menu it opens in a note.
   * Expanding a reference works here too, but only on the screen: the printed
   * verse is put straight into the DOM and is gone again the next time the page
   * is opened. That stays true now there is a write path, and deliberately.
   * This is where you read what other people wrote, and expanding a reference
   * is a reader's convenience — writing it into the page would edit everybody's
   * copy, bump the revision, and count as a save somebody never asked to make.
   * In the editor the same gesture goes through RefAwareEditor and is saved,
   * which is the right place for it.
   *
   * The page is drawn a block at a time rather than as one lump of HTML,
   * because each paragraph has a gutter of its own: the pills of everybody who
   * has written in that line, in the order they first did. That is the same
   * arrangement several commentators get on one verse in the reader, and the
   * same badge — see paragraphStamp.ts for how the list is kept, and for what
   * it is and is not evidence of. A page nobody has stamped yet has no pills
   * on any line, and then no gutter is drawn at all and it reads exactly as it
   * did before this existed.
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import BibleRefPopover from './BibleRefPopover.svelte';
  import { navigationStore } from '../stores/navigationStore';
  import { IndexedDBTextStore } from '../adapters/TextStore';
  import { formatVerseSuffix, VERSE_SUFFIX_RE } from '../lib/lexical/bibleRefTransforms';
  import { sanitizeNoteHtml } from '../lib/shared/sanitizeNoteHtml';
  import { splitPageBlocks } from '../lib/shared/paragraphStamp';
  import AuthorPill from './AuthorPill.svelte';
  import type { SharedNotebookMember } from '../adapters/SharedNotebookStore';

  export let html: string = '';
  /** Shown in place of the page when there is nothing in it yet. */
  export let placeholder: string = 'This page is empty.';
  /**
   * The notebook's roster, for turning the ids stamped on a paragraph into
   * badges. Left empty — a page read with no roster to hand — the gutter
   * simply does not appear, rather than a column of anonymous discs.
   */
  export let members: SharedNotebookMember[] = [];

  /** Past this many on one line, the rest become a count. */
  const MAX_SHOWN = 4;

  const textStore = new IndexedDBTextStore();

  type RefHit = {
    /** The reference's own span, which expanding writes the verse into. */
    el: HTMLElement;
    ref: string;
    book: string;
    chapter: number;
    verse: number;
    expanded: boolean;
    x: number;
    y: number;
  };

  let hit: RefHit | null = null;
  let busy = false;
  /** Set when the verse text couldn't be fetched, so the menu can say so. */
  let unavailable = false;

  // Run through the allowlist on every change rather than once on mount: the
  // page can be replaced under us by a pull while it is open.
  $: clean = sanitizeNoteHtml(html);
  $: isEmpty = clean.replace(/<[^>]*>/g, '').trim() === '';

  $: byUserId = new Map(members.map((m) => [m.userId, m]));
  $: blocks = splitPageBlocks(clean).map((block) => {
    // An id stamped by somebody who has since left the notebook has nobody to
    // draw. Dropped rather than drawn grey: the line was written by the people
    // still named beside it plus somebody who is gone, and a blank disc would
    // only invite the question without answering it.
    const known = block.pills.map((id) => byUserId.get(id)).filter((m): m is SharedNotebookMember => !!m);
    return {
      html: block.html,
      // Three and a count rather than four and a count — the "+2" takes the
      // fourth place, so the column is never wider than four badges.
      shown: known.length > MAX_SHOWN ? known.slice(0, MAX_SHOWN - 1) : known,
      more: known.length > MAX_SHOWN ? known.length - (MAX_SHOWN - 1) : 0,
      /** Everybody on the line, for the tooltip on the count. */
      all: known,
    };
  });
  $: hasGutter = blocks.some((b) => b.all.length > 0);

  function handleClick(e: MouseEvent) {
    const el = (e.target as HTMLElement | null)?.closest?.('.bible-ref') as HTMLElement | null;
    if (!el) return;

    // A reference the sanitiser stripped the target from is just text now —
    // leave it alone rather than opening a menu that goes nowhere.
    const ref = el.getAttribute('data-ref');
    const book = el.getAttribute('data-book');
    if (!ref || !book) return;

    e.preventDefault();
    const rect = el.getBoundingClientRect();
    busy = false;
    unavailable = false;
    hit = {
      el,
      ref,
      book,
      chapter: parseInt(el.getAttribute('data-chapter') ?? '1', 10),
      verse: parseInt(el.getAttribute('data-verse') ?? '1', 10),
      expanded: el.getAttribute('data-expanded') === 'true',
      x: rect.left + rect.width / 2,
      y: rect.top,
    };
  }

  function close() {
    hit = null;
    unavailable = false;
  }

  function goTo() {
    if (!hit) return;
    const current = get(navigationStore);
    // Record where we are first, so the nav bar's Back arrow returns here —
    // the same two-step a reference in a note takes.
    navigationStore.pushHistory(current, 'notes');
    navigationStore.navigateToVerse(current.translation, hit.book, hit.chapter, hit.verse);
    close();
  }

  /**
   * Print the verse inside the reference, exactly as a note does.
   *
   * The editor's version of this edits the Lexical tree and the note is saved.
   * Here the span is changed in place instead, and the change lasts only as
   * long as the page stays on screen — a pull, or closing and reopening the
   * page, redraws it from the stored HTML and the verse is gone. Making it
   * stick means opening the page for editing, where it becomes an edit with
   * your name on it rather than something the page did by itself.
   */
  async function expand() {
    if (!hit || busy) return;
    busy = true;
    unavailable = false;
    try {
      // Whatever the reader is on — expanding copies what you're looking at.
      const translation = get(navigationStore).translation;
      const text = await textStore.getVerse(translation, hit.book, hit.chapter, hit.verse);
      if (text) {
        const verse = document.createElement('span');
        verse.textContent = formatVerseSuffix(text);
        hit.el.appendChild(verse);
        hit.el.classList.add('is-expanded');
        hit.el.setAttribute('data-expanded', 'true');
        close();
      } else {
        // Pack not installed for this book, or no such verse in it. Say so and
        // leave the menu open so Go to is still available.
        console.warn('[SharedPageView] No verse text for', hit.ref, 'in', translation);
        unavailable = true;
      }
    } catch (err) {
      console.error('[SharedPageView] Expand failed:', err);
      unavailable = true;
    }
    busy = false;
  }

  /** Strip the printed verse back off, leaving the reference as it was. */
  function collapse() {
    if (!hit) return;
    const last = hit.el.lastElementChild;
    if (last && VERSE_SUFFIX_RE.test(last.textContent ?? '')) last.remove();
    hit.el.classList.remove('is-expanded');
    hit.el.removeAttribute('data-expanded');
    close();
  }

  /** Any click that isn't on the menu or another reference dismisses it. */
  function handleWindowPointer(e: PointerEvent) {
    if (!hit) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('.ref-popover') || t?.closest?.('.bible-ref')) return;
    close();
  }

  onDestroy(() => (hit = null));
</script>

<svelte:window on:pointerdown={handleWindowPointer} />

<!-- The click handler is delegated to the container because the references it
     serves are inside HTML set with innerHTML, which Svelte cannot bind to.
     Keyboard users reach the same targets through the spans' own role="link"
     and the window handler below, so this is not a keyboard trap. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="shared-page" class:with-gutter={hasGutter} on:click={handleClick}>
  {#if isEmpty}
    <p class="empty">{placeholder}</p>
  {:else if !hasGutter}
    <!-- Nothing has been stamped, so there is nothing to make room for. One
         lump of HTML, exactly as it was drawn before the gutter existed. -->
    {@html clean}
  {:else}
    {#each blocks as block, i (i)}
      <div class="blk">
        <span class="blk-pills">
          {#each block.shown as who (who.userId)}
            <AuthorPill
              color={who.color}
              initials={who.initials}
              title="{who.displayName || 'Someone'} wrote in this paragraph"
            />
          {/each}
          {#if block.more}
            <span
              class="blk-more"
              title={block.all.map((m) => m.displayName || 'Someone').join(', ')}
              >+{block.more}</span
            >
          {/if}
        </span>
        <div class="blk-body">{@html block.html}</div>
      </div>
    {/each}
  {/if}
</div>

{#if hit}
  <BibleRefPopover
    x={hit.x}
    y={hit.y}
    refLabel={hit.ref}
    book={hit.book}
    expanded={hit.expanded}
    {busy}
    {unavailable}
    on:goto={goTo}
    on:expand={expand}
    on:collapse={collapse}
    on:close={close}
  />
{/if}

<style>
  .shared-page {
    padding: 14px 16px 28px;
    color: #e0e0e0;
    font-size: 16px;
    line-height: 1.6;
    overflow-y: auto;
    overflow-wrap: break-word;
    height: 100%;
  }

  /* The gutter takes 32px off the left of every line, so the page gives some
     of its own padding back and the prose stays roughly where it was. On a
     20%-wide sliver that difference is the sentence fitting or not. */
  .shared-page.with-gutter {
    padding-left: 6px;
  }

  .empty {
    color: #777;
    font-style: italic;
    margin: 0;
  }

  /* ── The pill gutter ──────────────────────────────────────────────────────
     One row per block: a narrow column for the badges, then the paragraph.
     Laid out with grid rather than a float or an absolute position so the
     column can never overlap the prose, whatever the reader's typeface and
     leading are — and those are each reader's own, so it has to hold for all
     of them. */
  .blk {
    display: grid;
    grid-template-columns: 26px 1fr;
    column-gap: 6px;
    align-items: start;
  }

  .blk-pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 1px;
    /* Nudged down to sit on the first line of the paragraph rather than above
       it — the badge is 14px tall against a line box of roughly 26px. */
    padding-top: 0.35em;
  }

  .blk-more {
    font-size: 8px;
    font-weight: 700;
    color: #888;
    line-height: 1;
    padding-top: 3px;
    user-select: none;
  }

  /* The paragraph's own bottom margin does the spacing between rows, so the
     row itself adds none. */
  .blk-body {
    min-width: 0;
  }

  /* The page's own markup, which Svelte's scoping cannot reach through
     {@html}. These mirror LexicalEditor's rules so a shared page reads
     exactly like a note written on this device. */
  .shared-page :global(.editor-paragraph) {
    margin: 0 0 0.6em;
  }

  .shared-page :global(.editor-paragraph:last-child) {
    margin-bottom: 0;
  }

  .shared-page :global(.editor-text-bold) { font-weight: bold; }
  .shared-page :global(.editor-text-italic) { font-style: italic; }
  .shared-page :global(.editor-text-underline) { text-decoration: underline; }
  .shared-page :global(.editor-text-strikethrough) { text-decoration: line-through; }
  .shared-page :global(.editor-text-superscript) { font-size: 0.75em; vertical-align: super; }
  .shared-page :global(.editor-text-subscript) { font-size: 0.75em; vertical-align: sub; }

  .shared-page :global(.bible-ref) {
    color: var(--ref-color, #c0392b);
    border-bottom: 1px dotted currentColor;
    cursor: pointer;
  }

  /* Expanded: the verse text rides along in italic, one shade quieter — the
     same two rules LexicalEditor gives it. */
  .shared-page :global(.bible-ref.is-expanded) {
    border-bottom: none;
    font-style: italic;
  }

  .shared-page :global(.bible-ref.is-expanded > span:last-child) {
    font-style: italic;
  }

  /* A reference whose target the allowlist rejected. It keeps the colour so
     the sentence still reads as one piece, but it is not a link. */
  .shared-page :global(.bible-ref:not([data-ref])) {
    border-bottom: none;
    cursor: default;
  }
</style>
