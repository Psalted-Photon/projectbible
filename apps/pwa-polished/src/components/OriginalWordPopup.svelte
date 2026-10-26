<script context="module" lang="ts">
  import { writable } from "svelte/store";
  import { originalWordAt, resolveOriginalWord, type OriginalWord } from "../lib/strongs/formLookup";

  interface Shown {
    text: string;
    rect: DOMRect;
    /** Null while looking it up; false when nothing matched. */
    word: OriginalWord | null | false;
    open?: (id: string) => void;
  }

  const shown = writable<Shown | null>(null);
  let token = 0;

  /**
   * Show the popup for a Greek or Hebrew word under a tap in running text.
   * Returns false when the tap wasn't on one, so the caller's own handling
   * goes on. `open` replaces opening the number's entry in the word study,
   * for a caller already showing an entry.
   */
  export function showOriginalWordAt(e: MouseEvent, open?: (id: string) => void): boolean {
    // A selection being made isn't a tap on a word.
    if (window.getSelection()?.toString()) return false;
    const hit = originalWordAt(e.clientX, e.clientY);
    if (!hit) return false;
    const mine = ++token;
    shown.set({ text: hit.text, rect: hit.rect, word: null, open });
    resolveOriginalWord(hit.text).then((word) => {
      if (mine === token) shown.update((s) => (s ? { ...s, word: word ?? false } : s));
    });
    return true;
  }

  export function closeOriginalWord(): void {
    token++;
    shown.set(null);
  }
</script>

<script lang="ts">
  /**
   * A Greek or Hebrew word's meaning, next to where it was tapped inside a
   * commentary, a note or a definition: the word, how it sounds, what it
   * means, and its number, which opens the full entry. One for the whole app,
   * mounted once in App.svelte. Closed by its × or Escape only, so reading on
   * past it never loses it by accident.
   */
  import { tick } from "svelte";
  import CloseX from "./CloseX.svelte";
  import { displayId, glossHead, languageColor } from "../lib/strongs/entry";
  import { openStrongsWord } from "../lib/openWork";

  const GAP = 6;
  const EDGE = 8;

  let card: HTMLDivElement | null = null;
  let left = 0;
  let top = 0;

  $: if ($shown) place($shown.rect, $shown.word);

  /** Under the word, or over it when there's no room below; never off screen. */
  async function place(rect: DOMRect, _word: Shown["word"]) {
    await tick();
    const w = card?.offsetWidth ?? 260;
    const h = card?.offsetHeight ?? 110;
    left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - w - EDGE);
    top = rect.bottom + GAP + h > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - GAP - h) : rect.bottom + GAP;
  }

  function openEntry(word: OriginalWord) {
    const open = $shown?.open;
    closeOriginalWord();
    if (open) open(word.id);
    else openStrongsWord(word.id, word.lemma, null);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && $shown) {
      e.preventDefault();
      closeOriginalWord();
    }
  }
</script>

<!-- Capture: the word card sits on top of whatever opened it (a Strong's
     card, the lookup card), so it hears Escape first and marks it handled. -->
<svelte:window on:keydown|capture={onKeydown} />

{#if $shown}
  {@const s = $shown}
  <div class="ow-card" bind:this={card} style="left:{left}px; top:{top}px" role="dialog" aria-label="Word meaning">
    <CloseX class="ow-close" label="Close" on:click={closeOriginalWord} />
    {#if s.word}
      {@const w = s.word}
      <div class="ow-word" dir="auto" lang={w.language === "hebrew" ? "he" : "grc"}>{s.text}</div>
      {#if w.lemma && w.lemma !== s.text}
        <div class="ow-lemma" dir="auto">from {w.lemma}</div>
      {/if}
      {#if w.transliteration}<div class="ow-translit">{w.transliteration}</div>{/if}
      {#if w.gloss}<div class="ow-gloss">{glossHead(w.gloss)}</div>{/if}
      <button class="ow-number" style="color:{languageColor(w.language)}" on:click={() => openEntry(w)}>
        {displayId(w.id)} ›
      </button>
    {:else}
      <div class="ow-word" dir="auto">{s.text}</div>
      <div class="ow-muted">{s.word === false ? "No Strong's entry for this word." : "Looking it up…"}</div>
    {/if}
  </div>
{/if}

<style>
  .ow-card {
    position: fixed;
    z-index: 10055;
    max-width: min(280px, calc(100vw - 16px));
    min-width: 160px;
    padding: 10px 40px 10px 12px;
    background: rgba(26, 26, 26, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color: var(--text-color, #dfe2e8);
    font-size: 13px;
    line-height: 1.4;
  }

  .ow-card :global(.ow-close) {
    position: absolute;
    top: 2px;
    right: 2px;
  }

  .ow-word {
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    font-size: 19px;
    line-height: 1.3;
  }

  .ow-lemma {
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    color: var(--text-muted, #9aa0aa);
    font-size: 13px;
  }

  .ow-translit {
    color: var(--text-muted, #9aa0aa);
    font-style: italic;
  }

  .ow-gloss {
    margin-top: 2px;
  }

  .ow-number {
    margin-top: 6px;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .ow-number:hover {
    text-decoration: underline;
  }

  .ow-muted {
    color: var(--text-muted, #9aa0aa);
    font-style: italic;
  }
</style>
