<script lang="ts">
  /**
   * Recursive collapsible results tree, shared by the nav search dropdown and
   * Power Search. Renders any depth: Bible → translation → book → verse for
   * verses, category → result for notes, journal, characters and the rest.
   */
  import { CaretDown, CaretRight } from "phosphor-svelte";
  import type { SearchTreeNode } from "../lib/searchTree";
  import type { SearchResult } from "../lib/services/searchService";
  import { renderVersePreviewHtml } from "../lib/verseRendering";

  export let nodes: SearchTreeNode[] = [];
  /** Shared across the whole tree so nested levels stay independent. */
  export let expanded: Set<string> = new Set();
  export let depth = 0;
  export let query = "";
  export let onToggle: (key: string) => void = () => {};
  export let onSelect: (result: SearchResult) => void = () => {};

  function highlight(text: string): string {
    if (!query || !text) return escapeHtml(text || "");
    const safe = escapeHtml(text);
    const terms = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    let out = safe;
    for (const term of terms) {
      const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
    }
    return out;
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /** The query terms as one pattern, for the verse renderer's own marking. */
  $: queryRe = (() => {
    const alt = (query || "")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    return alt ? new RegExp(`(${alt})`, "gi") : null;
  })();

  /**
   * Verse subtitles are raw stored text — BSB footnotes, KJV pilcrows, NET
   * <b> marking Old Testament quotations. Route them through the shared preview
   * renderer so none of that shows and the bold survives; everything else
   * (notes, journal, commentary, Strong's) keeps the plain escape-then-mark.
   */
  function subtitleHtml(result: SearchResult): string {
    return result.type === "verse"
      ? renderVersePreviewHtml(result.subtitle || "", { highlight: queryRe, maxLength: 150 })
      : highlight(result.subtitle || "");
  }
</script>

{#each nodes as node (node.key)}
  <div class="tree-node" class:is-root={depth === 0} style="--depth: {depth}">
    <button
      class="tree-header"
      class:is-open={expanded.has(node.key)}
      class:is-empty={node.count === 0}
      disabled={node.count === 0}
      on:click={() => onToggle(node.key)}
    >
      <span class="tree-caret">
        {#if expanded.has(node.key)}
          <CaretDown size={depth === 0 ? 11 : 9} weight="bold" />
        {:else}
          <CaretRight size={depth === 0 ? 11 : 9} weight="bold" />
        {/if}
      </span>
      <span class="tree-label" style={node.color ? `color:${node.color}` : ""}>
        {node.label}
      </span>
      <span class="tree-count">({node.count})</span>
    </button>

    {#if expanded.has(node.key)}
      {#if node.children?.length}
        <div class="tree-children">
          <svelte:self
            nodes={node.children}
            {expanded}
            {query}
            {onToggle}
            {onSelect}
            depth={depth + 1}
          />
        </div>
      {:else if node.results?.length}
        <div class="tree-results">
          {#each node.results as result}
            <button
              class="tree-result"
              style={node.color ? `border-left-color:${node.color}` : ""}
              on:click={() => onSelect(result)}
            >
              <div class="tree-result-title">{result.title}</div>
              {#if result.subtitle}
                <div class="tree-result-subtitle">{@html subtitleHtml(result)}</div>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/each}

<style>
  .tree-node {
    margin-bottom: 2px;
  }

  .tree-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 10px;
    padding-left: calc(10px + var(--depth) * 14px);
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
    text-align: left;
    font-size: 0.85rem;
    transition: background 0.15s;
  }

  .tree-header:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
  }

  .tree-header.is-empty {
    opacity: 0.45;
    cursor: default;
  }

  /* Top-level categories carry the weight; nested levels recede. */
  .tree-node.is-root > .tree-header {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .tree-caret {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: #888;
    /* Transparent to clicks on purpose. Toggling swaps CaretDown for CaretRight,
       so the icon you clicked is destroyed in the flush that follows — and a
       detached node has no ancestors, which made the navbar's click-outside
       handler read the click as landing outside the results panel and close it.
       Reporting the enclosing button as the target keeps it resolvable, and
       makes the arrow part of the same hit area as the label. */
    pointer-events: none;
  }

  /* The label sizes to its text and the count sits right beside it, with the
     leftover space pushed after the pair — so "Genesis (1)" reads as one unit
     at any width instead of the count drifting off to the far edge. */
  .tree-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }

  .tree-children {
    margin-top: 1px;
  }

  .tree-results {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 3px 0 6px;
    padding-left: calc(18px + var(--depth) * 14px);
  }

  .tree-result {
    padding: 7px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: none;
    border-left: 2px solid #444;
    border-radius: 0 4px 4px 0;
    color: #ddd;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.15s;
  }

  .tree-result:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .tree-result-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #60a5fa;
    margin-bottom: 2px;
  }

  .tree-result-subtitle {
    font-size: 0.8rem;
    line-height: 1.45;
    color: #bbb;
  }

  .tree-result-subtitle :global(mark) {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
  }

  @media (max-width: 480px) {
    .tree-header {
      padding: 6px 8px;
      padding-left: calc(8px + var(--depth) * 11px);
      font-size: 0.8rem;
    }

    .tree-results {
      padding-left: calc(14px + var(--depth) * 11px);
    }

    .tree-result-title,
    .tree-result-subtitle {
      font-size: 0.75rem;
    }
  }
</style>
