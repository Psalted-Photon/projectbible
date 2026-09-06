<script lang="ts">
  /**
   * The card that opens when you tap a [n] in the text.
   *
   * Anchored to the marker and clamped to the viewport the same way
   * BibleRefPopover is, but wider and height-capped: a footnote can run to a
   * paragraph, and a cross-reference can list a dozen passages.
   *
   * A reference inside a note expands in place. Tapping "1 Chronicles 2:9–10"
   * pulls that verse in under the note rather than taking you there, so the
   * verse you were reading is still on screen behind the card.
   */
  import { createEventDispatcher } from 'svelte';
  import { getBookColor } from '../lib/bibleData';
  import { linkifyNoteRefs, noteRefList } from '../lib/linkifyNoteRefs';
  import type { NoteKind } from '../lib/verseRendering';

  export let x = 0;
  export let y = 0;
  /** The note as stored, sentinels and all. */
  export let body = '';
  /** The note's own verse reference, e.g. "1:3". Empty when the source gave none. */
  export let noteRef = '';
  export let kind: NoteKind = 'footnote';
  export let index = 1;
  /** Where the note sits, for references that name no book. */
  export let book = '';
  export let chapter = 1;

  /** The reference currently expanded, and the verse text fetched for it. */
  export let openRef: string | null = null;
  export let openText = '';
  export let openBusy = false;
  export let openUnavailable = false;

  const dispatch = createEventDispatcher();

  const WIDTH = 320;

  let rootEl: HTMLElement;

  /**
   * Move the card to the end of <body>.
   *
   * Panels carry `filter: invert(1)` on the light and sepia themes, and a CSS
   * filter turns its element into the anchor for any fixed-position descendant
   * — so rendered in place this would be positioned against the panel and
   * clipped away. Same reason BibleRefPopover does it.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // A cross-reference or a list of parallel passages is references and nothing
  // else, so it reads better as a row of chips than as a sentence.
  $: asChips = kind !== 'footnote';
  $: chips = asChips ? noteRefList(body, book, chapter) : [];
  $: prose = asChips ? '' : linkifyNoteRefs(body, book, chapter);

  $: label =
    kind === 'parallel' ? 'Parallel passages' : kind === 'crossref' ? 'Cross-reference' : 'Footnote';

  $: heading = noteRef ? `${book} ${noteRef.replace(/\./g, ':')}` : `${label} ${index}`;
  $: color = getBookColor(book);

  // Placement: prefer above the marker, drop below when there is no room. The
  // height is not known until it renders, so this uses the measured box where
  // there is one and a sensible guess on the first frame.
  let measured = 220;
  $: if (rootEl) measured = Math.min(rootEl.offsetHeight || measured, 340);
  $: left = Math.min(Math.max(x - WIDTH / 2, 8), Math.max(8, window.innerWidth - WIDTH - 8));
  $: top = y - measured - 12 < 8 ? y + 22 : y - measured - 12;

  function onBodyClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const refEl = target?.closest?.('.note-ref, .note-chip') as HTMLElement | null;
    if (!refEl) return;
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const ref = refEl.dataset.ref;
    if (!ref) return;
    dispatch(ref === openRef ? 'collapse' : 'expand', { ref });
  }
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && dispatch('close')} />

<div
  class="footnote-card themed"
  bind:this={rootEl}
  use:portal
  style="left:{left}px; top:{top}px; width:{WIDTH}px; --ref-color:{color};"
>
  <div class="fc-head">
    <span class="fc-where">{heading}</span>
    <span class="fc-kind">{label}</span>
  </div>

  <!-- Delegation: references are rendered as HTML by linkifyNoteRefs, so there
       is nothing to bind a handler to individually. -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="fc-body" on:click={onBodyClick} on:keydown={onBodyClick}>
    {#if asChips}
      {#if chips.length}
        <div class="fc-chips">
          {#each chips as chip}
            <span
              class="note-chip"
              class:open={chip.ref === openRef}
              style="--ref-color:{getBookColor(chip.book)}"
              data-ref={chip.ref}
              tabindex="0"
              role="link">{chip.label}</span
            >
          {/each}
        </div>
      {:else}
        <!-- No reference resolved: show what the note says rather than nothing. -->
        <p class="fc-prose">{body}</p>
      {/if}
    {:else}
      <p class="fc-prose">{@html prose}</p>
    {/if}

    {#if openRef}
      <div class="fc-expanded">
        <div class="fc-expanded-head">
          <span class="fc-expanded-ref">{openRef}</span>
          <button class="fc-goto" on:click|stopPropagation={() => dispatch('goto', { ref: openRef })}>
            Go to
          </button>
        </div>
        {#if openBusy}
          <p class="fc-note">Loading…</p>
        {:else if openUnavailable}
          <p class="fc-note">Not in the translation you're reading</p>
        {:else}
          <p class="fc-verse">{@html openText}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .footnote-card {
    position: fixed;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    max-height: 340px;
    padding: 8px 10px 10px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-left: 3px solid var(--ref-color, #c0392b);
    border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }

  .fc-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 6px;
    margin-bottom: 6px;
    border-bottom: 1px solid #3a3a3a;
  }

  .fc-where {
    color: var(--ref-color, #ddd);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fc-kind {
    color: #8a8a8a;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .fc-body {
    overflow-y: auto;
  }

  .fc-prose {
    margin: 0;
    color: #ddd;
    font-size: 0.84rem;
    line-height: 1.45;
  }

  .fc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  /* Both reference forms read the same way: tinted by book, underlined so it is
     clear they do something. */
  .fc-body :global(.note-ref) {
    color: var(--ref-color, #8fa3f5);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--ref-color, #8fa3f5) 45%, transparent);
    text-underline-offset: 2px;
  }

  .fc-body :global(.note-ref:hover) {
    text-decoration-color: var(--ref-color, #8fa3f5);
  }

  .note-chip {
    padding: 3px 7px;
    border: 1px solid color-mix(in srgb, var(--ref-color, #8fa3f5) 45%, transparent);
    border-radius: 3px;
    color: var(--ref-color, #8fa3f5);
    cursor: pointer;
    font-size: 0.78rem;
    line-height: 1.3;
    white-space: nowrap;
  }

  .note-chip:hover,
  .note-chip.open {
    background: color-mix(in srgb, var(--ref-color, #8fa3f5) 18%, transparent);
  }

  .fc-expanded {
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid #3a3a3a;
  }

  .fc-expanded-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .fc-expanded-ref {
    color: #9a9a9a;
    font-size: 0.72rem;
    font-weight: 600;
  }

  .fc-goto {
    background: #333;
    border: none;
    border-radius: 3px;
    color: #8fa3f5;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 3px 8px;
  }

  .fc-goto:hover {
    background: #3d3d3d;
    color: #b9c4fa;
  }

  .fc-verse {
    margin: 0;
    color: #cfcfcf;
    font-size: 0.82rem;
    font-style: italic;
    line-height: 1.45;
  }

  .fc-note {
    margin: 0;
    color: #8a8a8a;
    font-size: 0.78rem;
    font-style: italic;
  }
</style>
