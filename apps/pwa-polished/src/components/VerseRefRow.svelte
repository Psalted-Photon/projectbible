<script context="module" lang="ts">
  import { IndexedDBTextStore } from '../lib/adapters';
  import { englishRefIn } from '../lib/versification';

  /**
   * Verse text already fetched, by "translation|Book c:v". Shared by every row
   * on screen, so a passage two cards cite is read once.
   */
  const previewCache = new Map<string, Promise<string>>();
  let textStore: IndexedDBTextStore | null = null;

  /**
   * The verse's text. An English-numbered reference is read where the
   * translation keeps it (Hebrew Malachi 3:19 for English 4:1).
   */
  function previewFor(translation: string, book: string, chapter: number, verse: number, english: boolean): Promise<string> {
    const key = `${translation}|${book} ${chapter}:${verse}|${english}`;
    let hit = previewCache.get(key);
    if (!hit) {
      textStore ??= new IndexedDBTextStore();
      const at = english ? englishRefIn(translation, { book, chapter, verse }) : { book, chapter, verse };
      hit = at
        ? textStore
            .getVerse(translation, book, at.chapter, at.verse)
            .then((t) => t ?? '')
            .catch(() => '')
        : Promise.resolve('');
      previewCache.set(key, hit);
    }
    return hit;
  }
</script>

<script lang="ts">
  /**
   * One Scripture reference, drawn the way every reference list in the app
   * draws it: the reference in its book's color, over the opening words of
   * the passage in the reader's translation, with a bar of the same color down
   * the left. The Verses tab, the encyclopedia's and the map's verse lists, and
   * Nave's outline all use this row; new lists should use this component so
   * a reference never looks like two different things in two places.
   *
   * A range or a whole chapter previews the verse it opens at, which is also
   * where tapping it lands.
   */
  import { getBookColor } from '../lib/bibleData';
  import { renderVersePreviewHtml } from '../lib/verseRendering';
  import { navigationStore } from '../stores/navigationStore';
  import CompanionLine from './CompanionLine.svelte';

  export let book: string;
  export let chapter: number;
  export let verse = 1;
  /** What to print: "Genesis 46:1–47:12". Defaults to the verse itself. */
  export let label: string | undefined = undefined;
  export let onOpen: () => void;
  /** The reference is in English numbering, as every list's data is; a reference
   *  typed into the search bar is in the reader's own. */
  export let englishRef = true;
  /** Words to mark in the preview, each match as group 1 (renderVersePreviewHtml). */
  export let highlight: RegExp | null = null;
  /** The mark's background; the search results' orange when not given. */
  export let markColor: string | null = null;

  $: color = getBookColor(book);
  $: translation = $navigationStore.translation;
  let text = '';
  $: load(translation, book, chapter, verse, englishRef);

  async function load(t: string, b: string, c: number, v: number, english: boolean) {
    text = '';
    if (!t) return;
    const got = await previewFor(t, b, c, v, english);
    // Only if the row still shows the same verse it asked for.
    if (t === translation && b === book && c === chapter && v === verse) text = got;
  }
</script>

<button
  class="ref-row"
  class:own-mark={!!markColor}
  style="border-left-color:{color};{markColor ? ` --ref-mark-bg:${markColor};` : ''}"
  on:click={onOpen}
>
  <span class="ref-row-label" style="color:{color}">{label ?? `${book} ${chapter}:${verse}`}</span>
  {#if text}
    <span class="ref-row-text" dir="auto">{@html renderVersePreviewHtml(text, { highlight, maxLength: 150 })}</span>
  {/if}
  <CompanionLine shown={translation} {book} {chapter} {verse} {englishRef} maxLength={150} />
</button>

<style>
  /* The Verses tab's row, to the pixel (see NavesPointRefs, IsbeContent). */
  .ref-row {
    display: block;
    width: 100%;
    text-align: left;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-left: 3px solid #8bc34a;
    border-radius: 5px;
    cursor: pointer;
    padding: 6px 9px;
    font-family: inherit;
  }
  .ref-row:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .ref-row:focus-visible {
    outline: 2px solid #fb7185;
    outline-offset: 1px;
  }
  .ref-row-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
  }
  .ref-row-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    /* The row is text-align: left; a Hebrew preview (dir="auto") lines up on
       the right instead. */
    text-align: start;
    color: #c2c6cd;
    font-size: 12.5px;
    line-height: 1.4;
    margin-top: 2px;
  }
  /* Same mark as search results unless the list brings its own color. */
  .ref-row-text :global(mark) {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
  }
  .own-mark .ref-row-text :global(mark) {
    background: var(--ref-mark-bg);
    color: inherit;
  }
</style>
