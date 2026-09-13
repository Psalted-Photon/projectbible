<script context="module" lang="ts">
  import { parseOsisRef } from "../../lib/parseRefString";

  /**
   * Where a reference's preview text lives in the cache: "Genesis 1:1".
   *
   * Deliberately the key the Verses tab already stores under, so a verse
   * fetched for one tab is on screen the instant the other asks for it. Ranges
   * and whole-chapter citations key on the verse they open at, which is also
   * where tapping them lands.
   */
  export function navesRefKey(osis: string): string | null {
    const t = parseOsisRef(osis);
    return t ? `${t.book} ${t.chapter}:${t.verse ?? 1}` : null;
  }
</script>

<script lang="ts">
  import { getBookColor } from "../../lib/bibleData.js";
  import { renderVersePreviewHtml } from "../../lib/verseRendering";
  import type { NavesRef, NavesLink } from "../../adapters/lexicon-lookup.js";

  /**
   * Everything one outline point cites.
   *
   * Scripture opens into the same row the Verses tab uses — book-coloured
   * label over the opening line of the passage — so you can read what a point
   * rests on without leaving the outline. It starts closed and the text is
   * only fetched once it opens: "Prayer" cites over a thousand verses, and an
   * outline that printed all of them would have stopped being an outline.
   *
   * Cross-topic links stay chips. A topic name has nothing to preview, and the
   * different shape is what tells you that one leaves Scripture for another
   * article.
   */
  export let refs: NavesRef[] = [];
  export let links: NavesLink[] = [];
  export let open = false;
  /** Verse text by `navesRefKey`, shared with the Verses tab's cache. */
  export let previews: Record<string, string> = {};
  /** Sits under a collapsible heading rather than beside a plain point. */
  export let indent = false;
  export let onToggle: () => void;
  export let onRef: (osis: string) => void;
  export let onLink: (link: NavesLink) => void;

  /**
   * `live` is whether we can actually go where a reference points. Nave's cites
   * the Prayer of Azariah and the Wisdom of Solomon a handful of times —
   * apocrypha this app doesn't carry. Those are still worth printing, because
   * they say what the author had in mind, but not as something that looks
   * tappable and then does nothing.
   */
  $: rows = refs.map((r) => {
    const key = navesRefKey(r.osis);
    return {
      osis: r.osis,
      label: r.label,
      key,
      live: key !== null,
      // A ref we can't read falls through to getBookColor's own neutral grey.
      color: getBookColor(parseOsisRef(r.osis)?.book ?? ""),
    };
  });
</script>

{#if refs.length}
  <div class="refs" class:indent>
    <button class="refs-toggle" on:click={onToggle} aria-expanded={open}>
      <span class="refs-caret">{open ? "▼" : "▶"}</span>
      <span>{refs.length} reference{refs.length === 1 ? "" : "s"}</span>
    </button>
    {#if open}
      <div class="ref-list">
        {#each rows as row}
          {#if row.live}
            <button
              class="ref-row"
              style="border-left-color:{row.color}"
              on:click={() => onRef(row.osis)}
            >
              <span class="ref-row-label" style="color:{row.color}">{row.label}</span>
              {#if row.key && previews[row.key]}
                <span class="ref-row-text">
                  {@html renderVersePreviewHtml(previews[row.key], { maxLength: 150 })}
                </span>
              {/if}
            </button>
          {:else}
            <div class="ref-row dead" title="Nave's cites a book this app doesn't carry">
              <span class="ref-row-label">{row.label}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if links.length}
  <div class="chips" class:indent>
    {#each links as l}
      {#if l.topicId != null}
        <button class="link-chip" on:click={() => onLink(l)}>{l.name}</button>
      {:else}
        <span
          class="link-dead"
          title="Nave's names this topic but the module has no entry for it"
        >{l.name}</span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .refs {
    margin-top: 3px;
  }
  /* Lines up under a collapsible heading's title rather than its caret. */
  .refs.indent,
  .chips.indent {
    padding-left: 17px;
  }

  /* Closed, a point's citations are one quiet line, so the outline still reads
     as an outline. */
  .refs-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: var(--text-muted, #9aa0aa);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
    padding: 2px 4px 2px 0;
  }
  .refs-toggle:hover {
    color: var(--text-color, #dfe2e8);
  }
  .refs-caret {
    font-size: 8px;
  }

  .ref-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 0 6px 14px;
  }
  /* The Verses tab's row, to the pixel — the same citation should not look like
     two different things depending on which tab you found it in. */
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
  .ref-row.dead {
    border-left-style: dashed;
    border-left-color: rgba(255, 255, 255, 0.18);
    cursor: default;
  }
  .ref-row-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
  }
  .ref-row.dead .ref-row-label {
    color: var(--text-muted, #888);
    font-weight: 500;
  }
  .ref-row-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #c2c6cd;
    font-size: 12.5px;
    line-height: 1.4;
    margin-top: 2px;
  }

  /* Topic chips wrap under their line rather than stretching it, so a point
     pointing at a dozen other articles stays one readable sentence. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
    margin-bottom: 4px;
  }
  .link-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--color-primary, #4a90e2);
    font-family: inherit;
    font-size: 11.5px;
    padding: 2px 7px;
    cursor: pointer;
    white-space: nowrap;
  }
  .link-chip:hover {
    background: rgba(74, 144, 226, 0.15);
    border-color: var(--color-primary, #4a90e2);
  }
  /* Nave's points at a few hundred topics the module never carried. They are
     still worth printing — they say what the author had in mind — but not as
     something that looks tappable. */
  .link-dead {
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 11.5px;
    padding: 2px 7px;
    white-space: nowrap;
  }
</style>
