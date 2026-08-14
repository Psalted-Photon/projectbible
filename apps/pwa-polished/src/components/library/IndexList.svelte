<script lang="ts">
  import { onMount, tick } from "svelte";
  import AlphabetRail from "./AlphabetRail.svelte";
  import RefSearchBar from "./RefSearchBar.svelte";
  import { navigationStore } from "../../stores/navigationStore";
  import { libraryPrefsStore, isStarred, type LibraryMark } from "../../stores/libraryPrefsStore";
  import { libraryLetterOf, getIsbePlaceByEntryId } from "../../adapters/lexicon-lookup.js";
  import { isTextEntry } from "../../lib/isTextEntry";
  import type { LibraryBadge, LibrarySourceAdapter, LibraryRow } from "../../lib/library/source";
  import { isbeModalStore } from "../../stores/isbeModalStore";
  import { navesModalStore } from "../../stores/navesModalStore";
  import { personModalStore } from "../../stores/personModalStore";
  import { lexicalModalStore } from "../../stores/lexicalModalStore";

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
  /**
   * The row to land on, by id. A name can't identify a row — the encyclopedia
   * files "NOAH (1)" and "NOAH (2)" both under the name "Noah", and 166 names
   * collide that way — so the id is what pins the position. The row also stays
   * marked while the contents are open, so you can see where you came from.
   */
  export let initialRowId: string | number | null = null;

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
  /** The row you flipped in from. Ids are numbers here and strings for people,
   *  so both sides are stringified before comparing. */
  $: isCurrentRow = (row: LibraryRow) =>
    initialRowId != null && String(row.id) === String(initialRowId);

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
    if (initialRowId != null) {
      // filteredRows is derived, so it only settles on the next flush — same
      // reason jumpTo ticks after changing letter.
      await tick();
      const i = filteredRows.findIndex((r) => String(r.id) === String(initialRowId));
      // Not found — a letter that doesn't hold it, or nothing open — leaves you
      // at the top of the list, which is where you used to arrive anyway.
      if (i >= 0) await revealRow(i);
    }
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
    // Letters typed into a field are text, not list navigation. The search box
    // stops these before they get here, but not every field that might sit
    // inside the list will remember to, and preventDefault below would silently
    // eat the keystroke.
    if (isTextEntry(e.target)) return;
    if (e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
    e.preventDefault();

    typeahead += e.key.toLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => (typeahead = ""), TYPEAHEAD_MS);
    jumpTo(typeahead);
  }

  /** Scroll row `i` of the current list into view, paging it in first if it
   *  hasn't been rendered yet. Shared by the typeahead and by the landing jump
   *  when the contents open on the entry you were reading. */
  async function revealRow(i: number) {
    // Make sure the row is rendered before trying to scroll it into view.
    if (i >= visibleCount) {
      visibleCount = Math.ceil((i + 1) / CHUNK) * CHUNK;
      await tick();
    }
    listEl?.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: "center" });
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
    await revealRow(i);
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

  /**
   * Tapping a badge goes to that work rather than opening the row.
   *
   * The ids come from annotateLibraryBadges, which keeps them alongside the
   * flags it sets — so this navigates straight there and can't disagree with
   * the dot that invited the tap.
   */
  /**
   * Only one lookup card is meant to be open at a time — the work tabs close
   * the one they leave. Two at once would also put two Escape handlers on the
   * same key. A docked window isn't a store, so it survives this untouched,
   * which is the same asymmetry the tabs have.
   */
  function soloCard(keep: "isbe" | "naves" | "person" | "lexical") {
    if (keep !== "isbe") isbeModalStore.close();
    if (keep !== "naves") navesModalStore.close();
    if (keep !== "person") personModalStore.close();
    if (keep !== "lexical") lexicalModalStore.close();
  }

  async function openBadge(e: MouseEvent, row: LibraryRow, badge: LibraryBadge) {
    e.stopPropagation();

    if (badge === "bio" && row.bioId) {
      soloCard("person");
      personModalStore.open({ personId: row.bioId, primaryName: row.name, clickedWord: row.name });
      return;
    }
    if (badge === "topic" && row.topicId != null) {
      soloCard("naves");
      navesModalStore.open({ topicId: row.topicId, primaryName: row.name });
      return;
    }
    if (badge === "dict" && row.dictTerm) {
      soloCard("lexical");
      lexicalModalStore.open({
        selectedText: row.dictTerm,
        strongsId: undefined,
        morphologyData: null,
        lexicalEntries: null,
      });
      return;
    }
    if (badge === "entry" && row.badgeEntryId != null) {
      soloCard("isbe");
      isbeModalStore.open({ kind: "entry", entryId: row.badgeEntryId, placeId: null, primaryName: row.name });
      return;
    }
    if (badge === "place") {
      // The pin marks a geographic entry, which is not the same as having a
      // point to put on a map — plenty of places were never given coordinates.
      // Open the article's Map tab only when there is one, otherwise land on
      // the overview rather than on an empty map.
      const entryId = row.badgeEntryId ?? (source.key === "isbe" ? Number(row.id) : null);
      if (entryId == null || Number.isNaN(entryId)) return;
      const place = await getIsbePlaceByEntryId(entryId);
      const mappable = !!place && place.latitude != null && place.longitude != null;
      soloCard("isbe");
      isbeModalStore.open({
        kind: mappable ? "place" : "entry",
        entryId,
        placeId: mappable ? place!.placeId : null,
        primaryName: row.name,
        tab: mappable ? "map" : null,
      });
    }
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
          <div class="row-wrap" class:is-current={isCurrentRow(row)} data-row={i}>
            <button class="row" on:click={() => open(row)}>
              <span class="label">
                <span class="name">{row.name}</span>
                {#if row.detail}<span class="detail">{row.detail}</span>{/if}
              </span>
            </button>
            <!-- A sibling of the row rather than inside it: these are buttons,
                 and a button inside a button is invalid and would fire both. -->
            <span class="badges">
              {#if shows("place") && row.isPlace}
                <button class="emoji" title="Show on the map" aria-label="Show {row.name} on the map" on:click={(e) => openBadge(e, row, "place")}>📍</button>
              {/if}
              {#if shows("bio") && row.hasBio}
                <button class="emoji" title="Read the bio" aria-label="Bio of {row.name}" on:click={(e) => openBadge(e, row, "bio")}>👤</button>
              {/if}
              {#if shows("entry") && row.hasEntry}
                <button class="emoji" title="Read the encyclopedia article" aria-label="Encyclopedia article on {row.name}" on:click={(e) => openBadge(e, row, "entry")}>📕</button>
              {/if}
              {#if shows("topic") && row.hasTopic}
                <button class="emoji" title="Open the topic in Nave's" aria-label="Nave's topic {row.name}" on:click={(e) => openBadge(e, row, "topic")}>📚</button>
              {/if}
              {#if shows("dict") && row.hasDict}
                <button class="emoji" title="Look it up in the dictionary" aria-label="Dictionary entry for {row.name}" on:click={(e) => openBadge(e, row, "dict")}>📖</button>
              {/if}
            </span>
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
  /* The entry you flipped in from. An inset shadow rather than a left border,
     so marking a row doesn't nudge its text sideways. */
  .row-wrap.is-current {
    background: rgba(74, 144, 226, 0.1);
    box-shadow: inset 3px 0 0 var(--color-primary, #4a90e2);
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
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }
  /* Each dot is its own button now, so tapping one goes to that work instead of
     opening the row. Padded out to something a thumb can hit without making the
     glyph itself any bigger. */
  .emoji {
    background: none;
    border: none;
    padding: 4px 3px;
    font-size: 10px;
    line-height: 1;
    opacity: 0.75;
    cursor: pointer;
    transition:
      opacity 0.12s,
      transform 0.12s;
  }
  .emoji:hover {
    opacity: 1;
    transform: scale(1.3);
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
