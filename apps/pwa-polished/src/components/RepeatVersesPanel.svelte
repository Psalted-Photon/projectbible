<script lang="ts">
  /**
   * Every verse a repeat word is in, opened from its pill's "Show verses" menu.
   * The current book groups by chapter; every book groups by book, in canonical
   * order, with the current book open. Rows are the app's usual reference rows
   * with the word marked in the pill's own color; tapping one jumps there.
   *
   * Placed under the pill it came from, sized like the search results, and
   * closed by ×, Escape or a tap outside (the navbar watches for that).
   */
  import { onMount, tick } from "svelte";
  import { CaretRight, X } from "phosphor-svelte";
  import { getBookColor } from "../lib/bibleData";
  import { fixedOrigin } from "../lib/fixedOrigin";
  import { fadeAway, growFrom, reveal } from "../lib/motion";
  import { REPEAT_COLORS } from "../lib/repeatColors";
  import {
    findRepeatVerses,
    repeatMarkPattern,
    type RepeatVerseHit,
    type RepeatVerses,
    type RepeatVersesScope,
  } from "../lib/repeatVerses";
  import VerseRefRow from "./VerseRefRow.svelte";

  export let word: string;
  export let label: string;
  export let colorIndex: number;
  export let translation: string;
  export let book: string;
  export let chapter: number;
  export let scope: RepeatVersesScope = "book";
  /** The pill it hangs from. */
  export let anchor: HTMLElement | null = null;
  export let onClose: () => void;
  export let onOpen: (book: string, chapter: number, verse: number) => void;

  /** A long group shows this many rows until asked for the rest. */
  const GROUP_PAGE = 100;

  interface Group {
    key: string;
    label: string;
    color: string;
    hits: RepeatVerseHit[];
  }

  $: color = REPEAT_COLORS[colorIndex] ?? REPEAT_COLORS[0];
  $: mark = repeatMarkPattern(word);

  let result: RepeatVerses | null = null;
  let failed = false;
  let request = 0;
  let expanded = new Set<string>();
  let showingAll = new Set<string>();

  $: load(translation, word, scope, book);

  async function load(t: string, w: string, s: RepeatVersesScope, b: string) {
    const mine = ++request;
    result = null;
    failed = false;
    try {
      const got = await findRepeatVerses(t, w, s, b);
      if (mine !== request) return;
      result = got;
      expanded = openAtStart(got, s);
      showingAll = new Set();
    } catch {
      if (mine === request) failed = true;
    }
  }

  function groupsOf(r: RepeatVerses | null, s: RepeatVersesScope, b: string): Group[] {
    if (r?.kind !== "list") return [];
    const groups: Group[] = [];
    for (const h of r.hits) {
      const key = s === "book" ? `c${h.chapter}` : h.book;
      let last: Group | undefined = groups[groups.length - 1];
      if (last?.key !== key) {
        last = {
          key,
          label: s === "book" ? `${b} ${h.chapter}` : h.book,
          color: getBookColor(h.book),
          hits: [],
        };
        groups.push(last);
      }
      last.hits.push(h);
    }
    return groups;
  }

  $: groups = groupsOf(result, scope, book);

  /**
   * A short book list opens whole; a long one opens at the chapter being read.
   * Every book opens at the current book.
   */
  function openAtStart(r: RepeatVerses, s: RepeatVersesScope): Set<string> {
    if (r.kind !== "list" || !r.hits.length) return new Set();
    if (s === "all") return new Set([book]);
    if (r.hits.length <= 60) return new Set(r.hits.map((h) => `c${h.chapter}`));
    const here = r.hits.find((h) => h.chapter === chapter) ?? r.hits[0];
    return new Set([`c${here.chapter}`]);
  }

  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }

  function showAll(key: string) {
    showingAll = new Set(showingAll).add(key);
  }

  /** 23,412 reads as "23,000+"; under a thousand, the number itself. */
  function roughly(n: number): string {
    return n >= 1000 ? `${(Math.floor(n / 1000) * 1000).toLocaleString()}+` : n.toLocaleString();
  }

  $: where = scope === "book" ? `in ${book}` : "in every book";
  $: total = result?.kind === "list" ? result.hits.length : null;

  // ── Placement ─────────────────────────────────────────────────────────────

  let panel: HTMLElement;
  let placed = false;

  function place() {
    if (!panel || !anchor) return;
    const origin = fixedOrigin(panel);
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(4, Math.min(rect.left - origin.left, origin.width - panel.offsetWidth - 4));
    panel.style.left = `${left}px`;
    panel.style.top = `${rect.bottom + 4 - origin.top}px`;
    placed = true;
  }

  onMount(() => {
    tick().then(() => {
      place();
      growFrom(panel, anchor?.getBoundingClientRect());
    });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="repeat-verses-panel"
  class:positioned={placed}
  bind:this={panel}
  out:fadeAway|global
  role="dialog"
  aria-label="Verses with {label}"
>
  <div class="rv-header">
    <div class="rv-title">
      <span class="rv-word" style="background:{color.pill}; color:{color.pillText}">{label}</span>
      <span class="rv-where">{where}{total !== null ? ` · ${total.toLocaleString()} ${total === 1 ? "verse" : "verses"}` : ""}</span>
    </div>
    <button class="rv-close" on:click|stopPropagation={onClose} aria-label="Close">
      <X size={14} weight="bold" />
    </button>
  </div>

  <div class="rv-switch" role="radiogroup" aria-label="Where to look">
    <button
      role="radio"
      aria-checked={scope === "book"}
      class:on={scope === "book"}
      on:click|stopPropagation={() => (scope = "book")}>Current book</button
    >
    <button
      role="radio"
      aria-checked={scope === "all"}
      class:on={scope === "all"}
      on:click|stopPropagation={() => (scope = "all")}>Every book</button
    >
  </div>

  <div class="rv-body">
    {#if failed}
      <div class="rv-state">Couldn't read the verses.</div>
    {:else if !result}
      <div class="rv-state">Finding verses…</div>
    {:else if result.kind === "tooCommon"}
      <div class="rv-state">
        Too common to list ('{label}' is in {roughly(result.count)} verses{scope === "book" ? ` of ${book}` : ""})
      </div>
    {:else if !groups.length}
      <div class="rv-state">No verses</div>
    {:else}
      {#each groups as group (group.key)}
        {@const open = expanded.has(group.key)}
        <div class="rv-group">
          <button class="rv-group-header" on:click|stopPropagation={() => toggle(group.key)}>
            <span class="rv-caret motion-caret" class:open>
              <CaretRight size={10} weight="bold" />
            </span>
            <span class="rv-group-label" style="color:{group.color}">{group.label}</span>
            <span class="rv-group-count">({group.hits.length})</span>
          </button>
          {#if open}
            {@const shown = showingAll.has(group.key) ? group.hits : group.hits.slice(0, GROUP_PAGE)}
            <div class="rv-rows" in:reveal>
              {#each shown as hit (`${hit.book} ${hit.chapter}:${hit.verse}`)}
                <VerseRefRow
                  book={hit.book}
                  chapter={hit.chapter}
                  verse={hit.verse}
                  englishRef={false}
                  highlight={mark}
                  markColor={color.bg}
                  onOpen={() => onOpen(hit.book, hit.chapter, hit.verse)}
                />
              {/each}
              {#if shown.length < group.hits.length}
                <button class="rv-more" on:click|stopPropagation={() => showAll(group.key)}>
                  Show all {group.hits.length.toLocaleString()}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  /* The search results dropdown's box, scaled with the bar it hangs from. */
  .repeat-verses-panel {
    position: fixed;
    left: 0;
    top: 0;
    width: calc(380px * var(--bar-scale, 1));
    max-width: 92vw;
    max-height: min(calc(440px * var(--bar-scale, 1)), 75vh);
    display: flex;
    flex-direction: column;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    z-index: 10002;
    font-size: calc(13px * var(--bar-scale, 1));
    /* Hidden until placed under the pill, like the bar's dropdowns. */
    visibility: hidden;
  }

  .repeat-verses-panel.positioned {
    visibility: visible;
  }

  .rv-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: calc(8px * var(--bar-scale, 1)) calc(8px * var(--bar-scale, 1)) calc(4px * var(--bar-scale, 1))
      calc(12px * var(--bar-scale, 1));
  }

  .rv-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .rv-word {
    flex-shrink: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: calc(2px * var(--bar-scale, 1)) calc(8px * var(--bar-scale, 1));
    border-radius: 6px;
    font-weight: 600;
  }

  .rv-where {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #aaa;
  }

  .rv-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: calc(26px * var(--bar-scale, 1));
    height: calc(26px * var(--bar-scale, 1));
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #999;
    cursor: pointer;
  }

  .rv-close:hover {
    background: #3a3a3a;
    color: #e0e0e0;
  }

  .rv-switch {
    display: flex;
    gap: 2px;
    margin: calc(2px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1)) calc(8px * var(--bar-scale, 1));
    padding: 2px;
    background: #1a1a1a;
    border-radius: 6px;
    align-self: flex-start;
  }

  .rv-switch button {
    padding: calc(4px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #999;
    font-family: inherit;
    font-size: calc(12px * var(--bar-scale, 1));
    cursor: pointer;
    touch-action: manipulation;
  }

  .rv-switch button.on {
    background: #3a3a3a;
    color: #e0e0e0;
    font-weight: 600;
  }

  .rv-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 calc(6px * var(--bar-scale, 1)) calc(6px * var(--bar-scale, 1));
    border-top: 1px solid #3a3a3a;
  }

  .rv-state {
    padding: 20px 14px;
    text-align: center;
    color: #888;
  }

  .rv-group {
    margin-top: 2px;
  }

  /* SearchResultsTree's header: a turning caret, the colored name, the count. */
  .rv-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: calc(7px * var(--bar-scale, 1)) calc(8px * var(--bar-scale, 1));
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 1em;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
  }

  .rv-group-header:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .rv-caret {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: #888;
    /* The button is the target, never the arrow (see SearchResultsTree). */
    pointer-events: none;
  }

  .rv-group-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rv-group-count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.85em;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }

  .rv-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 2px 0 8px;
    padding-left: calc(18px * var(--bar-scale, 1));
  }

  .rv-more {
    align-self: flex-start;
    padding: 4px 6px;
    background: none;
    border: none;
    color: #667eea;
    font-family: inherit;
    font-size: 0.92em;
    text-decoration: underline;
    cursor: pointer;
  }

  .rv-more:hover {
    color: #7e8ff0;
  }

  .rv-body::-webkit-scrollbar {
    width: 8px;
  }

  .rv-body::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .rv-body::-webkit-scrollbar-thumb {
    background: #4a4a4a;
    border-radius: 4px;
  }
</style>
