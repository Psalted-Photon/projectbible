<script lang="ts">
  /**
   * The verse list shared by the word study's Forms and Occurrences tabs.
   *
   * Same shape as the encyclopedia's and Nave's verse tabs — books collapse,
   * expanding one loads its text, and each row carries its book's colour — so a
   * verse list reads identically wherever you meet one. What differs here is the
   * preview: it shows the *original* Greek or Hebrew with the tagged word
   * marked, which is the whole point of arriving from a lexicon entry.
   *
   * When a word occurs in both testaments the list opens with a corpus level
   * above the books, because Septuagint hits and New Testament hits are separate
   * evidence rather than one run of references.
   */
  import { getBookColor } from "../lib/bibleData.js";
  import { loadOriginalTokens, refKey, type VerseUse, type Token } from "../lib/strongsUsage";

  export let uses: VerseUse[] = [];
  /** Hebrew and Aramaic previews read right-to-left. */
  export let rtl = false;
  /**
   * Editions to measure against when deciding a verse is a variant, per
   * testament. A verse missing from some of them gets a badge naming the ones
   * that do carry it.
   */
  export let variantBaseline: Record<"OT" | "NT", string[]> = { OT: [], NT: [] };
  export let onNavigate: (use: VerseUse) => void;
  /** Refs already visited, dimmed on return. Owned by the parent so it survives
   *  switching tabs. */
  export let visited: Set<string> = new Set();

  type BookGroup = { book: string; color: string; uses: VerseUse[] };
  type Corpus = { testament: "OT" | "NT"; label: string; count: number; books: BookGroup[] };

  const CORPUS_LABEL: Record<"OT" | "NT", string> = {
    OT: "Septuagint (OT)",
    NT: "New Testament",
  };

  // `uses` arrives already in canonical order, so grouping preserves it.
  $: corpora = ((): Corpus[] => {
    const out: Corpus[] = [];
    for (const testament of ["OT", "NT"] as const) {
      const mine = uses.filter((u) => u.testament === testament);
      if (!mine.length) continue;
      const books = new Map<string, VerseUse[]>();
      for (const u of mine) {
        const bucket = books.get(u.book);
        if (bucket) bucket.push(u);
        else books.set(u.book, [u]);
      }
      out.push({
        testament,
        label: CORPUS_LABEL[testament],
        count: mine.length,
        books: [...books.entries()].map(([book, list]) => ({
          book,
          color: getBookColor(book),
          uses: list,
        })),
      });
    }
    return out;
  })();

  /** One corpus needs no header — the split only earns its row when a word
   *  actually spans both testaments. */
  $: splitCorpora = corpora.length > 1;

  let expandedCorpora = new Set<string>();
  let expandedBooks = new Set<string>();

  // A single book is its own answer: expanding it by hand would be a click that
  // could never go the other way usefully.
  let autoFor = "";
  $: {
    const signature = corpora.map((c) => `${c.testament}:${c.books.length}`).join(",");
    if (signature !== autoFor) {
      autoFor = signature;
      expandedCorpora = new Set(corpora.map((c) => c.testament));
      if (corpora.length === 1 && corpora[0].books.length === 1) {
        const group = corpora[0].books[0];
        expandedBooks = new Set([bookKey(corpora[0].testament, group.book)]);
        // Opened for you, so it has to be filled for you too — otherwise the one
        // book a rare word lives in shows as bare references with no text.
        loadBookPreviews(group);
      } else {
        expandedBooks = new Set();
      }
    }
  }

  function bookKey(testament: string, book: string): string {
    return `${testament}|${book}`;
  }

  function toggleCorpus(testament: string) {
    const next = new Set(expandedCorpora);
    next.has(testament) ? next.delete(testament) : next.add(testament);
    expandedCorpora = next;
  }

  async function toggleBook(testament: string, group: BookGroup) {
    const key = bookKey(testament, group.book);
    const next = new Set(expandedBooks);
    if (next.has(key)) {
      next.delete(key);
      expandedBooks = next;
      return;
    }
    next.add(key);
    expandedBooks = next;
    await loadBookPreviews(group);
  }

  // --- Previews -----------------------------------------------------------
  // Keyed by edition as well as reference: the same verse can be previewed from
  // BYZ in one list and TR in another, and they are not the same text.
  let previews: Record<string, Token[]> = {};

  function previewSource(u: VerseUse): string {
    return u.sources[0] ?? "";
  }

  function previewKey(u: VerseUse): string {
    return `${previewSource(u)}|${u.book}|${u.chapter}|${u.verse}`;
  }

  /** Verse text for one book, loaded on expand. A word like καί never pays for
   *  every book at once, which is the same bargain the encyclopedia makes. */
  async function loadBookPreviews(group: BookGroup) {
    const wanted = group.uses.filter((u) => previews[previewKey(u)] === undefined);
    if (!wanted.length) return;
    const loaded = await Promise.all(
      wanted.map(async (u) => {
        const tokens = await loadOriginalTokens(previewSource(u), u.rawBook, u.chapter, u.verse);
        return [previewKey(u), tokens] as const;
      }),
    );
    previews = { ...previews, ...Object.fromEntries(loaded) };
  }

  /**
   * The stretch of verse worth showing.
   *
   * A whole verse of Greek would push every other row off the screen, but a
   * blunt character cut could drop the very word the row exists to show. So the
   * window is centred on the first marked token instead, and says so with an
   * ellipsis when there is more either side.
   */
  const WINDOW = 7;
  function windowed(tokens: Token[], marks: number[]): { before: boolean; after: boolean; shown: Token[] } {
    if (tokens.length <= WINDOW * 2 + 1) return { before: false, after: false, shown: tokens };
    const first = marks.length ? Math.min(...marks) : tokens[0].wordIndex;
    const at = Math.max(0, tokens.findIndex((t) => t.wordIndex === first));
    const start = Math.max(0, at - WINDOW);
    const end = Math.min(tokens.length, at + WINDOW + 1);
    return { before: start > 0, after: end < tokens.length, shown: tokens.slice(start, end) };
  }

  /** Editions carrying this verse, when they are not all of them. */
  function variantOf(u: VerseUse): string | null {
    const baseline = variantBaseline[u.testament] ?? [];
    if (baseline.length < 2 || u.sources.length >= baseline.length) return null;
    return u.sources.map((s) => s.toUpperCase()).join(" ");
  }

  function marksFor(u: VerseUse): number[] {
    return u.marks[previewSource(u)] ?? [];
  }
</script>

<div class="sv-list">
  {#each corpora as corpus (corpus.testament)}
    {#if splitCorpora}
      <button class="sv-corpus" on:click={() => toggleCorpus(corpus.testament)}>
        <span class="sv-caret">{expandedCorpora.has(corpus.testament) ? "▼" : "▶"}</span>
        <span class="sv-corpus-name">{corpus.label}</span>
        <span class="sv-count">{corpus.count} verse{corpus.count === 1 ? "" : "s"}</span>
      </button>
    {/if}
    {#if !splitCorpora || expandedCorpora.has(corpus.testament)}
      <div class="sv-books" class:indented={splitCorpora}>
        {#each corpus.books as group (group.book)}
          <div class="vb-group">
            <button class="vb-header" on:click={() => toggleBook(corpus.testament, group)}>
              <span class="vb-caret" style="color:{group.color}">
                {expandedBooks.has(bookKey(corpus.testament, group.book)) ? "▼" : "▶"}
              </span>
              <span class="vb-name" style="color:{group.color}">{group.book}</span>
              <span class="vb-count">({group.uses.length})</span>
            </button>
            {#if expandedBooks.has(bookKey(corpus.testament, group.book))}
              <div class="vb-refs">
                {#each group.uses as u (refKey(u))}
                  {@const tokens = previews[previewKey(u)]}
                  {@const marks = marksFor(u)}
                  {@const variant = variantOf(u)}
                  <button
                    class="vb-ref"
                    class:visited={visited.has(refKey(u))}
                    style="border-left-color:{group.color}"
                    on:click={() => onNavigate(u)}
                  >
                    <span class="vb-ref-head">
                      <span class="vb-ref-label" style="color:{group.color}">
                        {group.book}
                        {u.chapter}:{u.verse}
                      </span>
                      {#if variant}
                        <span class="vb-variant" title="Only in {variant}">{variant}</span>
                      {/if}
                    </span>
                    {#if tokens?.length}
                      {@const win = windowed(tokens, marks)}
                      <span class="vb-ref-text" dir={rtl ? "rtl" : "ltr"} class:rtl>
                        {#if win.before}<span class="vb-elide">… </span>{/if}
                        {#each win.shown as t, i (t.wordIndex)}
                          {#if i > 0}{" "}{/if}<span class:marked={marks.includes(t.wordIndex)}
                            >{t.text}</span
                          >
                        {/each}
                        {#if win.after}<span class="vb-elide"> …</span>{/if}
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .sv-list {
    display: flex;
    flex-direction: column;
  }

  /* Corpus header sits above the books and reads as the heavier level. */
  .sv-corpus {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--text-color, #dfe2e8);
    font-family: inherit;
    font-size: 13.5px;
    font-weight: 600;
    text-align: left;
    padding: 9px 4px;
    cursor: pointer;
  }

  .sv-corpus:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .sv-caret {
    font-size: 10px;
    color: var(--text-muted, #9aa0aa);
  }

  .sv-corpus-name {
    flex: 1;
  }

  .sv-count {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
    font-weight: 400;
  }

  .sv-books.indented {
    padding-left: 16px;
  }

  /* --- Book groups: same names and values as the encyclopedia's verse tab,
     so the two lists stay visually identical. --- */
  .vb-group {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .vb-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-color, #dfe2e8);
    font-family: inherit;
    font-size: 13.5px;
    text-align: left;
    padding: 7px 4px;
    cursor: pointer;
  }

  .vb-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .vb-caret {
    font-size: 10px;
  }

  .vb-name {
    flex: 1;
    font-weight: 600;
  }

  .vb-count {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
  }

  .vb-refs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 4px 10px 24px;
  }

  .vb-ref {
    display: block;
    width: 100%;
    text-align: left;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-left: 3px solid;
    border-radius: 5px;
    padding: 6px 9px;
    cursor: pointer;
    font-family: inherit;
  }

  .vb-ref:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .vb-ref.visited .vb-ref-label,
  .vb-ref.visited .vb-ref-text {
    opacity: 0.5;
  }

  .vb-ref-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 2px;
  }

  .vb-ref-label {
    font-size: 12px;
    font-weight: 600;
  }

  /* Only shown when the editions disagree, so its presence is the message. */
  .vb-variant {
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--text-muted, #9aa0aa);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    padding: 0 4px;
    white-space: nowrap;
  }

  /* The original text. Reference labels above stay latin, so the direction
     switch belongs on this line alone. */
  .vb-ref-text {
    display: block;
    color: #c2c6cd;
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .vb-ref-text.rtl {
    text-align: right;
  }

  .vb-elide {
    color: var(--text-muted, #777);
  }

  /* Same mark treatment as search results and the encyclopedia, so a highlighted
     word means the same thing everywhere in the app. */
  .vb-ref-text .marked {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
