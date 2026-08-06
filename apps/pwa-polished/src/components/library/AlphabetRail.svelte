<script lang="ts">
  import { LIBRARY_LETTERS, LIBRARY_OTHER } from "../../adapters/lexicon-lookup.js";

  /** Letters that actually have entries, and how many — letters with none are
   *  shown dimmed rather than hidden, so the strip stays a stable A–Z ruler. */
  export let counts: Record<string, number> = {};
  export let active: string | null = null;
  export let onSelect: (letter: string) => void;

  let railEl: HTMLDivElement | null = null;
  let scrubbing = false;

  $: letters = [...LIBRARY_LETTERS, ...(counts[LIBRARY_OTHER] ? [LIBRARY_OTHER] : [])];

  function select(letter: string) {
    if (!counts[letter] || letter === active) return;
    onSelect(letter);
  }

  /** Which letter sits under a y coordinate — the strip is evenly divided, so
   *  this is arithmetic rather than a hit test against 27 elements. */
  function letterAt(clientY: number): string | null {
    if (!railEl) return null;
    const box = railEl.getBoundingClientRect();
    const i = Math.floor(((clientY - box.top) / box.height) * letters.length);
    return letters[Math.min(Math.max(i, 0), letters.length - 1)] ?? null;
  }

  // Dragging down the rail runs through the letters, the way a thumb-index in a
  // paper dictionary does. Pointer capture keeps it tracking even once the
  // finger wanders off the strip.
  function onPointerDown(e: PointerEvent) {
    scrubbing = true;
    railEl?.setPointerCapture(e.pointerId);
    const letter = letterAt(e.clientY);
    if (letter) select(letter);
  }

  function onPointerMove(e: PointerEvent) {
    if (!scrubbing) return;
    const letter = letterAt(e.clientY);
    if (letter) select(letter);
  }

  function onPointerUp(e: PointerEvent) {
    scrubbing = false;
    railEl?.releasePointerCapture(e.pointerId);
  }

  function onKeydown(e: KeyboardEvent) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    // Skip past empty letters so the arrows always land somewhere with content.
    let i = letters.indexOf(active ?? letters[0]);
    for (let n = 0; n < letters.length; n++) {
      i = (i + step + letters.length) % letters.length;
      if (counts[letters[i]]) return select(letters[i]);
    }
  }
</script>

<div
  bind:this={railEl}
  class="rail"
  class:scrubbing
  role="tablist"
  aria-label="Jump to letter"
  tabindex="0"
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerUp}
  on:keydown={onKeydown}
>
  {#each letters as letter}
    <span
      class="letter"
      class:active={letter === active}
      class:empty={!counts[letter]}
      role="tab"
      aria-selected={letter === active}
      title={counts[letter] ? `${letter} — ${counts[letter]} entries` : letter}
    >
      {letter}
    </span>
  {/each}
</div>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    width: 22px;
    padding: 4px 0;
    border-right: 1px solid var(--border-color, #333);
    /* The strip is a scrub target, so no text selection or browser panning
       should fire while a finger is running down it. */
    user-select: none;
    touch-action: none;
    cursor: pointer;
    outline: none;
  }
  .rail:focus-visible {
    border-right-color: var(--color-primary, #4a90e2);
  }
  .letter {
    font-size: 10px;
    line-height: 1;
    color: var(--text-muted, #999);
    /* Every letter takes an equal slice: it keeps the whole alphabet on screen
       without scrolling, and makes letterAt() a straight division. */
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .letter.active {
    color: var(--color-primary, #4a90e2);
    font-weight: 700;
  }
  .letter.empty {
    opacity: 0.25;
  }
  /* While scrubbing the letters grow slightly, so the one under the thumb is
     readable past the finger covering it. */
  .rail.scrubbing .letter.active {
    font-size: 12px;
  }

  @media (max-width: 480px) {
    .rail {
      width: 26px;
    }
    .letter {
      font-size: 11px;
    }
  }
</style>
