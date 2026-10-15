<script lang="ts">
  /**
   * The same verse in English, under a Greek or Hebrew preview. Shown only
   * when the text above is an original and the "English" switch is on, so it
   * can sit under every preview row and stay out of the way otherwise.
   *
   * `shown` is the translation the preview above is in. Its reference is in
   * that text's own numbering, or, with `englishRef`, in English numbering
   * (the encyclopedias, Nave's, saved lists), which is read where the text
   * keeps it first.
   */
  import { englishCompanion } from "../lib/englishCompanion";
  import { loadCompanionVerse, type CompanionVerse, type CompanionPiece } from "../lib/companion";
  import { isOriginalLanguage } from "../lib/translationKind";
  import { renderCompanionHtml } from "../lib/verseRendering";
  import { englishRefIn } from "../lib/versification";

  export let shown: string;
  export let book: string;
  export let chapter: number;
  export let verse: number;
  export let englishRef = false;
  /** The translation the reader is on, which picks the English. Defaults to `shown`. */
  export let readerTranslation: string | null = null;
  /** The number to mark in the English, and how many words the original marks. */
  export let strongsId: string | null = null;
  export let marked = 1;
  /** Room for the whole line; several English verses share it. */
  export let maxLength = 180;

  $: on = $englishCompanion && isOriginalLanguage(shown);

  let en: CompanionVerse | null = null;
  let token = 0;
  $: if (on) load(shown, book, chapter, verse, englishRef, readerTranslation ?? shown, strongsId, marked);
  else en = null;

  async function load(
    from: string,
    b: string,
    c: number,
    v: number,
    english: boolean,
    reader: string,
    id: string | null,
    count: number,
  ) {
    const mine = ++token;
    const at = english ? englishRefIn(from, { book: b, chapter: c, verse: v }) : { book: b, chapter: c, verse: v };
    if (!at) {
      en = null;
      return;
    }
    const got = await loadCompanionVerse(from, b, at.chapter, at.verse, reader, id ? { strongsId: id, marked: count } : undefined);
    if (mine === token) en = got;
  }

  function html(pieces: CompanionPiece[]): string {
    const max = Math.max(80, Math.floor(maxLength / pieces.length));
    return pieces.map((p) => renderCompanionHtml(p.stored, p.spans, { range: p.ref.part, maxLength: max })).join(" ");
  }

  /** "NET", plus where the verse sits when its number differs from the row's. */
  function label(translation: string, pieces: CompanionPiece[]): string {
    const name = translation.toUpperCase();
    const moved = pieces.length > 1 || pieces.some((p) => p.ref.chapter !== chapter || p.ref.verse !== verse);
    if (!moved) return name;
    return `${name} ${pieces.map((p) => `${p.ref.chapter}:${p.ref.verse}`).join(", ")}`;
  }
</script>

{#if on && en}
  {#if !en.missing}
    <span class="companion-line" dir="ltr" lang="en"
      >{@html html(en.pieces)} <span class="cl-tag">{label(en.translation, en.pieces)}</span></span
    >
  {:else}
    <span class="companion-line cl-missing" dir="ltr" lang="en">Not in {en.translation.toUpperCase()}</span>
    {#if en.fallback}
      <span class="companion-line" dir="ltr" lang="en"
        >{@html html(en.fallback.pieces)} <span class="cl-tag">{label(en.fallback.translation, en.fallback.pieces)}</span></span
      >
    {/if}
  {/if}
{/if}

<style>
  /* The app's own font, dimmer than the original above it, and always left to
     right, even under Hebrew. */
  .companion-line {
    display: block;
    margin-top: 2px;
    color: var(--text-muted, #9aa0aa);
    font-family: inherit;
    font-size: 12.5px;
    font-style: normal;
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
  }

  .cl-missing {
    font-style: italic;
    opacity: 0.75;
  }

  .cl-tag {
    font-size: 10px;
    letter-spacing: 0.04em;
    opacity: 0.7;
    white-space: nowrap;
  }

  /* Same mark treatment as the Greek above it and search results. */
  .companion-line :global(mark) {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
