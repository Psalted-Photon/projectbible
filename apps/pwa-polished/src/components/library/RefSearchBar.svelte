<script lang="ts">
  import { tick } from "svelte";
  import { MagnifyingGlass, X } from "phosphor-svelte";
  import BrandSpinner from "../BrandSpinner.svelte";

  /**
   * The navbar's collapsing search, scoped to one reference work. Styling is
   * lifted from NavigationBar's .pill-search-* rules on purpose — same height,
   * same colors, same rose focus ring — so the library reads as part of the
   * same app rather than a second search box with its own opinions.
   *
   * Unlike the navbar's, this one fills whatever width the header leaves it,
   * because a docked window is a lot narrower than the nav pill.
   */
  export let placeholder = "Search";
  export let searching = false;
  /** Runs as you type (debounced by the caller) and on Enter. */
  export let onSearch: (query: string) => void;
  /** Called when the box is emptied or collapsed, to drop the results. */
  export let onClear: () => void = () => {};

  let expanded = false;
  let focused = false;
  let query = "";
  let inputEl: HTMLInputElement | null = null;

  export function collapse() {
    expanded = false;
    query = "";
    onClear();
  }

  async function expand() {
    if (expanded) return collapseIfEmpty();
    expanded = true;
    await tick();
    inputEl?.focus();
  }

  function collapseIfEmpty() {
    if (query) return;
    expanded = false;
    onClear();
  }

  function handleInput() {
    if (query.trim().length >= 2) onSearch(query);
    else onClear();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Keystrokes here are text, not list navigation — the contents list behind
    // this listens for bare letters to jump, and must not also see these.
    e.stopPropagation();
    if (e.key === "Enter") onSearch(query);
    else if (e.key === "Escape") collapse();
  }

  function clear() {
    query = "";
    onClear();
    inputEl?.focus();
  }
</script>

<div class="search-area" role="search">
  <button class="search-icon-btn" on:click={expand} title="Search" aria-label="Search">
    <span class="icon-badge icon-badge-search"><MagnifyingGlass size={16} weight="bold" /></span>
  </button>
  <div class="search-expander" class:expanded>
    <div class="search-input-inner" class:focused>
      <input
        bind:this={inputEl}
        type="text"
        class="search-input"
        {placeholder}
        bind:value={query}
        on:input={handleInput}
        on:keydown={handleKeydown}
        on:focus={() => (focused = true)}
        on:blur={() => (focused = false)}
      />
      {#if searching}
        <div class="search-spinner-wrap"><BrandSpinner size={13} title="Searching…" /></div>
      {:else if query}
        <button class="clear-search" on:mousedown|preventDefault={clear} title="Clear search">
          <X size={11} weight="duotone" />
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .search-area {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .search-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-badge {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: white;
    line-height: 0;
  }
  .icon-badge-search {
    background: radial-gradient(circle, #fb7185 0%, #fb7185 20%, #000000 100%);
  }
  .icon-badge > :global(svg) {
    filter: drop-shadow(0 0 2px #000000) drop-shadow(0 0 2px #000000);
  }

  /* The collapse is a width transition on a clipping box, same as the navbar.
     Here the open width is a share of the header rather than a fixed 230px. */
  .search-expander {
    width: 0;
    overflow: hidden;
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    min-width: 0;
  }
  .search-expander.expanded {
    width: min(200px, 46vw);
  }

  .search-input-inner {
    display: flex;
    align-items: center;
    height: 26px;
    background: #141414;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    margin-left: 4px;
    width: calc(100% - 4px);
    box-sizing: border-box;
    transition: border-color 0.15s;
  }
  .search-input-inner.focused {
    border-color: #fb7185;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e0e0e0;
    font-size: 13px;
    padding: 0 8px;
    min-width: 0;
    font-family: inherit;
  }
  .search-input::placeholder {
    color: #555;
  }

  .clear-search {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #666;
    cursor: pointer;
    padding: 0 6px;
    flex-shrink: 0;
    height: 100%;
    transition: color 0.15s;
  }
  .clear-search:hover {
    color: #ccc;
  }

  /* BrandSpinner turns itself, so this only positions it — a rotation here
     would spin the gem twice over. */
  .search-spinner-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    flex-shrink: 0;
  }
</style>
