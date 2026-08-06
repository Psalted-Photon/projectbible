<script lang="ts">
  import { onMount, tick } from "svelte";
  import AlphabetRail from "./AlphabetRail.svelte";
  import RefSearchBar from "./RefSearchBar.svelte";
  import { navigationStore } from "../../stores/navigationStore";
  import { libraryPrefsStore, isStarred, type LibraryMark } from "../../stores/libraryPrefsStore";
  import { libraryLetterOf } from "../../adapters/lexicon-lookup.js";
  import type { LibraryBadge, LibrarySourceAdapter, LibraryRow } from "../../lib/library/source";

  /**
   * The contents list — the table of contents for one reference work. Draws an
   * A–Z rail, one letter's rows at a time, and the small personal shelf on top
   * of it (starred, recently read).
   *
   * A letter can run past a thousand rows, so they go in a chunk at a time as
   * you scroll rather than all at once.
   */
  export let source: LibrarySourceAdapter;
  export let onOpen: (row: LibraryRow) => void;
  /** Letter to open on — where you left off, or the letter of the current entry. */
  export let initialLetter: string | null = null;

  const CHUNK = 150;
  /** How long a burst of typing stays one search term. */
  const TYPEAHEAD_MS = 900;

  let letterCounts: Record<string, number> = {};
  let letter = "";
  let rows: LibraryRow[] = [];
  let loading = true;
  let visibleCount = CHUNK;

  let filterKey = "all";
  let searchResults: LibraryRow[] | null = null;
  let searching = false;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  let chapterRows: LibraryRow[] | null = null;
  let chapterLoading = false;

  let showStarred = false;
  let showRecent = false;

  let listEl: HTMLDivElement | null = null;
  let searchBar: RefSearchBar;

  let typeahead = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  $: prefs = $libraryPrefsStore[source.key];
  $: nav = $navigationStore;
  /** Each work marks only the dots that tell you something new about its rows. */
  $: shows = (badge: LibraryBadge) => source.badges.includes(badge);

  // The rows actually on screen: a search wins over the chapter filter, which
  // wins over the letter you're browsing. Chips narrow whichever it landed on.
  $: activeRows = searchResults ?? chapterRows ?? rows;
  $: filterFn = source.filters.find((f) => f.key === filterKey)?.test ?? (() => true);
  $: filteredRows = activeRows.filter(filterFn);
  $: shownRows = filteredRows.slice(0, visibleCount);
  $: browsing = !searchResults && !chapterRows;

  onMount(async () => {
    letterCounts = await source.getLetterCounts();
    const first = Object.keys(letterCounts)[0] ?? "A";
    await selectLetter(initialLetter || prefs.lastLetter || first, false);
  });

  async function selectLetter(next: string, remember = true) {
    if (!next) return;
    loading = true;
    letter = next;
    visibleCount = CHUNK;
    clearSearch();
    chapterRows = null;

    const loaded = await source.getRowsForLetter(next);
    // A slower letter's rows must not land after you've already moved on.
    if (letter !== next) return;
    rows = loaded;
    loading = false;
    if (remember) libraryPrefsStore.setLastLetter(source.key, next);
    if (listEl) {
      listEl.scrollTop = 0;
      prevScrollTop = 0;
    }

    // Badges hit other packs, so they resolve after the names are already
    // readable rather than holding the list back.
    if (source.annotateBadges) {
      const annotated = await source.annotateBadges([...loaded], next);
      if (letter === next) rows = annotated;
    }
  }

  /** Step to the next letter that has anything in it. */
  function adjacentLetter(step: 1 | -1): string | null {
    const letters = Object.keys(letterCounts);
    const i = letters.indexOf(letter);
    if (i < 0) return null;
    return letters[i + step] ?? null;
  }

  let prevScrollTop = 0;

  function handleScroll() {
    if (!listEl) return;
    const { scrollTop, clientHeight, scrollHeight } = listEl;
    // Only ever act on a downward scroll. Sending the list back to the top on a
    // letter change fires a scroll event of its own, and treating that as "you
    // reached the bottom" would walk the rest of the alphabet on its own.
    const goingDown = scrollTop > prevScrollTop;
    prevScrollTop = scrollTop;
    if (!goingDown) return;
    // A list that doesn't overflow was never scrolled through.
    if (scrollHeight <= clientHeight + 40) return;
    if (scrollTop + clientHeight < scrollHeight - 240) return;

    if (visibleCount < filteredRows.length) {
      visibleCount += CHUNK;
    } else if (browsing) {
      // Everything in this letter is on the page and you're still going —
      // roll into the next one rather than stopping dead.
      const next = adjacentLetter(1);
      if (next) selectLetter(next);
    }
  }

  // --- Search ------------------------------------------------------------
  function runSearch(query: string) {
    if (searchDebounce) clearTimeout(searchDebounce);
    searching = true;
    searchDebounce = setTimeout(async () => {
      const results = await source.search(query);
      searchResults = results;
      visibleCount = CHUNK;
      searching = false;
      if (listEl) listEl.scrollTop = 0;
      if (source.annotateBadges && results.length) {
        // Results span the alphabet, so badges are gathered per letter present.
        const byLetter = new Map<string, LibraryRow[]>();
        for (const r of results) {
          const l = libraryLetterOf(r.sortKey);
          byLetter.set(l, [...(byLetter.get(l) ?? []), r]);
        }
        await Promise.all([...byLetter].map(([l, rs]) => source.annotateBadges!(rs, l)));
        searchResults = [...results];
      }
    }, 180);
  }

  function clearSearch() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchResults = null;
    searching = false;
    visibleCount = CHUNK;
  }

  // --- In this chapter ---------------------------------------------------
  async function toggleChapter() {
    if (chapterRows) {
      chapterRows = null;
      return;
    }
    if (!source.getRowsInChapter) return;
    chapterLoading = true;
    searchBar?.collapse();
    const found = await source.getRowsInChapter(nav.book, nav.chapter);
    chapterRows = found;
    visibleCount = CHUNK;
    chapterLoading = false;
    if (listEl) listEl.scrollTop = 0;
  }

  // --- Type to jump ------------------------------------------------------
  // Typing plain letters with the list focused runs to the nearest name, the
  // way typing in a file list does. Anything with a modifier is left alone so
  // browser and app shortcuts still work.
  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
    e.preventDefault();

    typeahead += e.key.toLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => (typeahead = ""), TYPEAHEAD_MS);
    jumpTo(typeahead);
  }

  async function jumpTo(prefix: string) {
    const target = libraryLetterOf(prefix);
    if (browsing && target !== letter) {
      await selectLetter(target);
      // The new letter's rows have to exist before we can look inside them.
      await tick();
    }
    const i = filteredRows.findIndex((r) => r.sortKey.startsWith(prefix));
    if (i < 0) return;
    // Make sure the row is rendered before trying to scroll it into view.
    if (i >= visibleCount) {
      visibleCount = Math.ceil((i + 1) / CHUNK) * CHUNK;
      await tick();
    }
    listEl?.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: "center" });
  }

  // --- Rows --------------------------------------------------------------
  const markOf = (row: LibraryRow): LibraryMark => ({
    id: row.id,
    name: row.name,
    sortKey: row.sortKey,
  });

  function open(row: LibraryRow) {
    libraryPrefsStore.markRead(source.key, markOf(row));
    onOpen(row);
  }

  function toggleStar(e: MouseEvent, row: LibraryRow) {
    e.stopPropagation();
    libraryPrefsStore.toggleStar(source.key, markOf(row));
  }

  /** Reopen something from the starred/recent shelves, which hold only a mark. */
  function openMark(mark: LibraryMark) {
    open({ id: mark.id, name: mark.name, sortKey: mark.sortKey, isPlace: false });
  }
</script>

<div class="index">
  <div class="index-bar">
    <div class="chips">
      <!-- A lone "All" chip filters nothing, so it isn't drawn. -->
      {#if source.filters.length > 1}
        {#each source.filters as f}
          <button class="chip" class:on={filterKey === f.key} on:click={() => (filterKey = f.key)}>
            {f.label}
          </button>
        {/each}
      {/if}
      {#if source.getRowsInChapter}
        <button
          class="chip chapter"
          class:on={!!chapterRows}
          on:click={toggleChapter}
          title="Only entries appearing in {nav.book} {nav.chapter}"
        >
          {chapterLoading ? "…" : `In ${nav.book} ${nav.chapter}`}
        </button>
      {/if}
    </div>
    <RefSearchBar
      bind:this={searchBar}
      placeholder={source.searchPlaceholder}
      {searching}
      onSearch={runSearch}
      onClear={clearSearch}
    />
  </div>

  <div class="index-main">
    {#if browsing}
      <AlphabetRail counts={letterCounts} active={letter} onSelect={selectLetter} />
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={listEl}
      class="rows"
      role="listbox"
      tabindex="0"
      aria-label="{source.label} contents"
      on:scroll={handleScroll}
      on:keydown={handleKeydown}
    >
      {#if browsing && prefs.starred.length}
        <button class="shelf-head" on:click={() => (showStarred = !showStarred)}>
          <span class="caret">{showStarred ? "▼" : "▶"}</span>
          <span class="star-on">★</span> Starred
          <span class="count">({prefs.starred.length})</span>
        </button>
        {#if showStarred}
          {#each prefs.starred as mark}
            <button class="row shelf-row" on:click={() => openMark(mark)}>
              <span class="name">{mark.name}</span>
            </button>
          {/each}
        {/if}
      {/if}

      {#if browsing && prefs.recent.length}
        <button class="shelf-head" on:click={() => (showRecent = !showRecent)}>
          <span class="caret">{showRecent ? "▼" : "▶"}</span>
          Recently viewed
          <span class="count">({prefs.recent.length})</span>
        </button>
        {#if showRecent}
          {#each prefs.recent as mark}
            <button class="row shelf-row" on:click={() => openMark(mark)}>
              <span class="name">{mark.name}</span>
            </button>
          {/each}
        {/if}
      {/if}

      <div class="section-head">
        {#if searchResults}
          {filteredRows.length} result{filteredRows.length === 1 ? "" : "s"}
        {:else if chapterRows}
          {filteredRows.length} in {nav.book} {nav.chapter}
        {:else}
          {letter}<span class="count">({filteredRows.length})</span>
        {/if}
      </div>

      {#if loading}
        <div class="muted pad">Loading…</div>
      {:else if !filteredRows.length}
        <div class="muted pad">
          {searchResults ? "Nothing found." : chapterRows ? "Nothing from this chapter." : "Nothing here."}
        </div>
      {:else}
        {#each shownRows as row, i (row.id)}
          <div class="row-wrap" data-row={i}>
            <button class="row" on:click={() => open(row)}>
              <span class="label">
                <span class="name">{row.name}</span>
                {#if row.detail}<span class="detail">{row.detail}</span>{/if}
              </span>
              <span class="badges">
                {#if shows("place") && row.isPlace}<span class="emoji" title="Place">📍</span>{/if}
                {#if shows("bio") && row.hasBio}<span class="emoji" title="Has a bio">👤</span>{/if}
                {#if shows("entry") && row.hasEntry}<span class="emoji" title="In the encyclopedia">📕</span>{/if}
                {#if shows("dict") && row.hasDict}<span class="emoji" title="In the dictionary">📖</span>{/if}
              </span>
            </button>
            <button
              class="star"
              class:on={isStarred($libraryPrefsStore, source.key, row.id)}
              on:click={(e) => toggleStar(e, row)}
              title={isStarred($libraryPrefsStore, source.key, row.id) ? "Unstar" : "Star"}
              aria-label="Star {row.name}"
            >
              {isStarred($libraryPrefsStore, source.key, row.id) ? "★" : "☆"}
            </button>
          </div>
        {/each}
        {#if visibleCount < filteredRows.length}
          <div class="muted pad small">
            {filteredRows.length - visibleCount} more — keep scrolling
          </div>
        {:else if browsing && adjacentLetter(1)}
          <button class="next-letter" on:click={() => selectLetter(adjacentLetter(1)!)}>
            Continue into {adjacentLetter(1)} ↓
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .index {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .index-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .chip {
    background: var(--surface-2, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-color, #333);
    color: var(--text-muted, #999);
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  .chip.on {
    color: var(--color-primary, #4a90e2);
    border-color: var(--color-primary, #4a90e2);
  }
  .chip.chapter {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .index-main {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .rows {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    outline: none;
    padding-bottom: 12px;
  }

  .section-head {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--background-color, #1e1e1e);
    padding: 8px 12px 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-primary, #4a90e2);
    border-bottom: 1px solid var(--border-color, #333);
  }
  .count {
    color: var(--text-muted, #999);
    font-weight: 400;
    font-size: 11px;
    margin-left: 5px;
  }

  .shelf-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-color, #333);
    color: var(--text-muted, #999);
    font-size: 12px;
    font-family: inherit;
    padding: 7px 12px;
    cursor: pointer;
    text-align: left;
  }
  .shelf-head:hover {
    color: var(--text-color, #fff);
  }
  .caret {
    font-size: 9px;
  }
  .star-on {
    color: #fde047;
  }

  .row-wrap {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .row-wrap:hover {
    background: var(--surface-2, rgba(255, 255, 255, 0.06));
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: var(--text-color, #fff);
    font-family: inherit;
    font-size: 14px;
    text-align: left;
    padding: 9px 4px 9px 12px;
    cursor: pointer;
  }
  .label {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
  }
  .row .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Name meanings run long, so the detail gives up its width first and the
     name itself stays readable. */
  .detail {
    font-size: 11px;
    color: var(--text-muted, #999);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .shelf-row {
    padding-left: 26px;
    font-size: 13px;
    color: var(--text-muted, #999);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .shelf-row:hover {
    color: var(--text-color, #fff);
  }

  .badges {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
    font-size: 10px;
    opacity: 0.75;
  }

  .star {
    background: none;
    border: none;
    color: #555;
    font-size: 14px;
    cursor: pointer;
    padding: 0 10px;
    flex-shrink: 0;
  }
  .star:hover {
    color: #fde047;
  }
  .star.on {
    color: #fde047;
  }

  .next-letter {
    display: block;
    width: 100%;
    background: none;
    border: none;
    color: var(--color-primary, #4a90e2);
    font-family: inherit;
    font-size: 12px;
    padding: 12px;
    cursor: pointer;
  }

  .muted {
    color: var(--text-muted, #999);
  }
  .pad {
    padding: 14px 12px;
    font-size: 13px;
  }
  .small {
    font-size: 11px;
    text-align: center;
  }
</style>
