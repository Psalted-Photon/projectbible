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
   * Expanding is not offered, because that would write into a page this
   * reader may not be allowed to change.
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import BibleRefPopover from './BibleRefPopover.svelte';
  import { navigationStore } from '../stores/navigationStore';
  import { sanitizeNoteHtml } from '../lib/shared/sanitizeNoteHtml';

  export let html: string = '';
  /** Shown in place of the page when there is nothing in it yet. */
  export let placeholder: string = 'This page is empty.';

  type RefHit = {
    ref: string;
    book: string;
    chapter: number;
    verse: number;
    x: number;
    y: number;
  };

  let hit: RefHit | null = null;

  // Run through the allowlist on every change rather than once on mount: the
  // page can be replaced under us by a pull while it is open.
  $: clean = sanitizeNoteHtml(html);
  $: isEmpty = clean.replace(/<[^>]*>/g, '').trim() === '';

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
    hit = {
      ref,
      book,
      chapter: parseInt(el.getAttribute('data-chapter') ?? '1', 10),
      verse: parseInt(el.getAttribute('data-verse') ?? '1', 10),
      x: rect.left + rect.width / 2,
      y: rect.top,
    };
  }

  function close() {
    hit = null;
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
<div class="shared-page" on:click={handleClick}>
  {#if isEmpty}
    <p class="empty">{placeholder}</p>
  {:else}
    {@html clean}
  {/if}
</div>

{#if hit}
  <BibleRefPopover
    x={hit.x}
    y={hit.y}
    refLabel={hit.ref}
    book={hit.book}
    canExpand={false}
    on:goto={goTo}
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

  .empty {
    color: #777;
    font-style: italic;
    margin: 0;
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

  /* A reference whose target the allowlist rejected. It keeps the colour so
     the sentence still reads as one piece, but it is not a link. */
  .shared-page :global(.bible-ref:not([data-ref])) {
    border-bottom: none;
    cursor: default;
  }
</style>
