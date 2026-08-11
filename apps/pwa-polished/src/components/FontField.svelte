<script lang="ts">
  /**
   * In-app typeface picker.
   *
   * Replaces a `<select>` whose `<option>`s carried `font-family`. Desktop
   * browsers draw that dropdown as HTML and honour the CSS; phones substitute
   * a native spinner that discards it, so every font name rendered in the
   * system font and you had to pick one to find out what it looked like.
   *
   * Each row is the font's own name set in that font — nothing else. That is
   * the whole point: the list shows you what you are choosing.
   */
  import { createEventDispatcher } from "svelte";
  import { READER_FONT_GROUPS, fontsInGroup } from "../lib/readerFonts";

  export let value: string = "";
  /**
   * What the first row calls "no face chosen". The reader keeps the
   * per-translation font, so it reads "Match translation"; the writing
   * surfaces just fall back to their own face, so they say "Default".
   */
  export let defaultLabel: string = "Match translation";

  const dispatch = createEventDispatcher<{ change: string }>();

  let listEl: HTMLDivElement | null = null;
  let atEnd = false;

  function pick(id: string) {
    if (id === value) return;
    value = id;
    dispatch("change", id);
  }

  /**
   * The app hides every scrollbar globally (App.svelte), so a list taller than
   * its box gives no clue that more fonts exist below. A fade at the bottom
   * edge is the hint — dropped once there is nothing left to scroll to, so it
   * never sits over the final row for no reason.
   */
  function onScroll() {
    if (!listEl) return;
    atEnd = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 2;
  }
</script>

<div class="ff-wrap" class:at-end={atEnd}>
<div
  bind:this={listEl}
  class="ff"
  role="listbox"
  aria-label="Reader typeface"
  on:scroll={onScroll}
>
  <button
    type="button"
    class="ff-row ff-default"
    class:selected={value === ""}
    role="option"
    aria-selected={value === ""}
    on:click={() => pick("")}
  >
    {defaultLabel}
    <span class="ff-hint">default</span>
  </button>

  {#each READER_FONT_GROUPS as group}
    <p class="ff-group">{group}</p>
    {#each fontsInGroup(group) as font}
      <button
        type="button"
        class="ff-row"
        class:selected={value === font.id}
        role="option"
        aria-selected={value === font.id}
        on:click={() => pick(font.id)}
      >
        <!-- The scale multiplier is the same x-height normalisation the reader
             uses, so Tangerine doesn't show up half the size of Bitter. -->
        <span style="font-family: {font.stack}; font-size: calc(1.15rem * {font.scale})">
          {font.label}
        </span>
      </button>
    {/each}
  {/each}
</div>
</div>

<style>
  .ff-wrap {
    position: relative;
  }

  .ff-wrap::after {
    content: "";
    position: absolute;
    left: 1px;
    right: 1px;
    bottom: 1px;
    height: 34px;
    border-radius: 0 0 5px 5px;
    background: linear-gradient(to bottom, rgba(26, 26, 26, 0), #1a1a1a);
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.15s ease;
  }
  .ff-wrap.at-end::after {
    opacity: 0;
  }

  .ff {
    max-height: 320px;
    overflow-y: auto;
    /* The app hides scrollbars globally, so momentum scroll is the only
       affordance — keep it smooth on iOS. */
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    border: 1px solid #444;
    border-radius: 6px;
    background: #1a1a1a;
    padding: 4px;
  }

  .ff-group {
    margin: 10px 0 4px;
    padding: 0 8px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #7d7d7d;
  }
  .ff-group:first-of-type {
    margin-top: 6px;
  }

  .ff-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    /* Comfortably past the 36px minimum touch target even for small faces. */
    min-height: 44px;
    padding: 6px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: #e0e0e0;
    text-align: left;
    line-height: 1.25;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .ff-row:hover {
    background: #262626;
  }
  .ff-row.selected {
    border-color: #667eea;
    background: #23273d;
  }
  .ff-row:focus-visible {
    outline: 2px solid #667eea;
    outline-offset: -2px;
  }

  .ff-default {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .ff-hint {
    font-size: 0.68rem;
    color: #7d7d7d;
    font-weight: 400;
    flex: none;
  }
</style>
