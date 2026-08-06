<script lang="ts">
  import { get } from "svelte/store";
  import { BIBLE_BOOKS, normalizeBookName, getBookColor } from "../lib/bibleData.js";
  import { IndexedDBTextStore } from "../lib/adapters";
  import { renderVersePreviewHtml } from "../lib/verseRendering";
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { navesModalStore } from "../stores/navesModalStore";
  import { libraryPrefsStore } from "../stores/libraryPrefsStore";
  import IndexList from "./library/IndexList.svelte";
  import { peopleSource } from "../lib/library/source";
  import {
    getPersonVerses,
    getPersonById,
    getPeopleNeighbors,
    relationId,
    resolveIsbeClick,
    resolveNavesTopicId,
    getNavesTopicName,
    lookupEnglishWord,
    libraryLetterOf,
    type PersonRecord,
    type PersonLookupResult,
    type PersonRelation,
    type IsbeResolution,
    type LibraryRow,
  } from "../adapters/lexicon-lookup.js";

  /**
   * A person's bio, independent of what is holding it. Three hosts: the word-study
   * modal (where a clicked name lands), a docked window pinned beside the reader,
   * and the People contents list. Same arrangement as IsbeContent, and for the
   * same reason — a bio should read the same wherever you opened it.
   */

  /** Modal path: the resolution a clicked word produced, homonyms and all. */
  export let lookup: PersonLookupResult | null = null;
  /** Library/window path: open this person directly. */
  export let personId: string | null = null;
  /** The word that was clicked, for the "multiple people named X" wording. */
  export let clickedWord = "";

  export let windowId: string | null = null;
  export let onClose: (() => void) | null = null;
  export let onPopOut: ((snap: { personId: string; primaryName: string }) => void) | null = null;
  /** Hosts that draw their own header (the word-study modal) suppress ours. */
  export let showHeader = true;
  /** Lets a host with its own title bar follow which homonym is showing. */
  export let onPersonChange: ((p: PersonRecord | null) => void) | null = null;
  /** Set by the word-study modal, which can show the definition in place —
   *  better than the header's Dictionary button, which opens a second card. */
  export let onShowDefinition: (() => void) | null = null;

  $: docked = !!windowId;

  let loaded: PersonRecord | null = null;
  let loading = false;
  /** Which homonym is on screen, when a clicked name matched several. */
  let chosenId: string | null = null;

  // A fresh lookup drops any homonym you had picked from the previous one.
  $: lookup, (chosenId = null);

  $: candidates = lookup ? [lookup.person, ...lookup.alternates] : [];
  $: person = lookup
    ? (candidates.find((p) => p.id === chosenId) ?? lookup.person)
    : loaded;

  // Contents open when there is nobody to show — which is how the People tile
  // starts — and the header's ☰ swaps between the two thereafter.
  let showContents = !lookup && !personId;

  // Load by id for the library path. The modal path arrives with its record.
  let loadedFor = "";
  $: if (personId && personId !== loadedFor) loadById(personId);

  async function loadById(id: string) {
    loadedFor = id;
    loading = true;
    loaded = await getPersonById(id);
    // Guard a slower load landing after you've moved on.
    if (loadedFor === id) loading = false;
  }

  $: title = person ? person.displayTitle || person.name : peopleSource.label;
  $: onPersonChange?.(person);

  function formatYear(y: number | null | undefined): string {
    if (y === null || y === undefined) return "";
    return y < 0 ? `${-y} BC` : `${y} AD`;
  }
  function lifespan(p: PersonRecord | null): string {
    const b = formatYear(p?.birthYear);
    const d = formatYear(p?.deathYear);
    if (b && d) return `c. ${b} – ${d}`;
    if (b) return `b. c. ${b}`;
    if (d) return `d. c. ${d}`;
    return "";
  }

  /** Strip the markdown link/emphasis syntax from Easton's prose. */
  function cleanBio(text: string | undefined): string[] {
    if (!text) return [];
    return text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  /** Parents come from two fields but read as one row. */
  $: parents = [...(person?.father ?? []), ...(person?.mother ?? [])];

  // --- Walking the family ------------------------------------------------
  /** Open a relative. The pack stores their id as `slug`, so the tree walks. */
  function openRelation(rel: PersonRelation) {
    const id = relationId(rel);
    if (!id) return;
    openPerson(id, rel.name);
  }

  function openPerson(id: string, name: string) {
    showContents = false;
    if (windowId) {
      windowStore.updateContentState(windowId, { personId: id, primaryName: name });
    } else {
      // In the modal the record is what drives the view, so swapping person
      // means swapping the record rather than re-resolving the clicked word.
      lookup = null;
      personId = id;
    }
  }

  function openFromContents(row: LibraryRow) {
    openPerson(String(row.id), row.name);
  }

  // --- Page turns --------------------------------------------------------
  let neighbors: { prev: LibraryRow | null; next: LibraryRow | null } = { prev: null, next: null };

  $: if (person) loadNeighbors(person);
  else neighbors = { prev: null, next: null };

  async function loadNeighbors(p: PersonRecord) {
    const found = await getPeopleNeighbors(p.name.toLowerCase(), p.id);
    if (person?.id === p.id) neighbors = found;
  }

  $: contentsLetter = person ? libraryLetterOf(person.name.toLowerCase()) : null;

  // --- Recents -----------------------------------------------------------
  let rememberedId: string | null = null;
  $: if (person && person.id !== rememberedId) {
    rememberedId = person.id;
    libraryPrefsStore.markRead("people", {
      id: person.id,
      name: title,
      sortKey: person.name.toLowerCase(),
    });
  }

  // --- Bridges -----------------------------------------------------------
  // Same row of buttons every article carries, showing only what actually
  // exists for this name. The encyclopedia one used to be suppressed for
  // people; there was never a reason for that beyond the modal having nowhere
  // to put the bio while it was gone.
  let isbeMatch: IsbeResolution | null = null;
  let navesTopicId: number | null = null;
  let navesName = "";
  let hasDictionary = false;
  let bridgeCheckedFor = "";

  $: if (person) checkBridges(person.name);

  async function checkBridges(name: string) {
    const key = name.trim().toLowerCase();
    if (bridgeCheckedFor === key) return;
    bridgeCheckedFor = key;
    isbeMatch = null;
    navesTopicId = null;
    hasDictionary = false;
    try {
      isbeMatch = await resolveIsbeClick({ word: name });
    } catch {
      isbeMatch = null;
    }
    try {
      const id = await resolveNavesTopicId(name);
      if (bridgeCheckedFor !== key) return;
      navesTopicId = id;
      navesName = id != null ? ((await getNavesTopicName(id)) ?? name) : "";
    } catch {
      navesTopicId = null;
    }
    try {
      const e = await lookupEnglishWord(key);
      hasDictionary = !!(e && (e.modern?.length || e.historic?.length || e.wordset?.length));
    } catch {
      hasDictionary = false;
    }
  }

  function openTopical() {
    if (navesTopicId == null) return;
    if (!docked) onClose?.();
    navesModalStore.open({ topicId: navesTopicId, primaryName: navesName });
  }

  function openEncyclopedia() {
    if (!isbeMatch) return;
    const m = isbeMatch;
    // Docked, the bio stays put and the article opens beside it. In the modal
    // there is only one card, so this one has to give way.
    if (!docked) onClose?.();
    isbeModalStore.open({
      kind: m.kind,
      entryId: m.entryId,
      placeId: m.placeId ?? null,
      primaryName: m.primaryName,
    });
  }

  function openDictionary() {
    if (!person) return;
    const term = person.name.trim().toLowerCase();
    if (!docked) onClose?.();
    lexicalModalStore.open({
      selectedText: term,
      strongsId: undefined,
      morphologyData: null,
      lexicalEntries: null,
    });
  }

  // --- Verse list --------------------------------------------------------
  let personVerses: { book: string; chapter: number; verse: number }[] = [];
  let versesLoaded = false;
  let versesLoading = false;
  let showVerseList = false;
  let expandedBooks = new Set<string>();
  let versePreviews: Record<string, string> = {};
  const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
  const verseTextStore = new IndexedDBTextStore();

  // Start the list over whenever the person changes, new lookup or homonym.
  $: person?.id, resetVerseList();
  function resetVerseList() {
    showVerseList = false;
    versesLoaded = false;
    versesLoading = false;
    personVerses = [];
    expandedBooks = new Set();
    versePreviews = {};
  }

  async function toggleVerseList() {
    showVerseList = !showVerseList;
    if (showVerseList && !versesLoaded && person) {
      versesLoading = true;
      personVerses = await getPersonVerses(person.id);
      versesLoaded = true;
      versesLoading = false;
    }
  }

  async function toggleBook(book: string, refs: { chapter: number; verse: number }[]) {
    const next = new Set(expandedBooks);
    if (next.has(book)) {
      next.delete(book);
      expandedBooks = next;
      return;
    }
    next.add(book);
    expandedBooks = next;
    const translation = get(navigationStore).translation;
    const loadedText = await Promise.all(
      refs.map(async (r) => {
        const key = `${book} ${r.chapter}:${r.verse}`;
        if (versePreviews[key] !== undefined) return [key, versePreviews[key]] as const;
        const text = (await verseTextStore.getVerse(translation, book, r.chapter, r.verse)) ?? "";
        return [key, text] as const;
      }),
    );
    versePreviews = { ...versePreviews, ...Object.fromEntries(loadedText) };
  }

  $: versesByBook = (() => {
    const map = new Map<string, { chapter: number; verse: number }[]>();
    for (const v of personVerses) {
      const book = normalizeBookName(v.book);
      if (!map.has(book)) map.set(book, []);
      map.get(book)!.push({ chapter: v.chapter, verse: v.verse });
    }
    return [...map.entries()]
      .map(([book, refs]) => ({
        book,
        color: getBookColor(book),
        refs: refs.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse),
      }))
      .sort((a, b) => (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999));
  })();

  function navigateToVerse(book: string, chapter: number, verse: number) {
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    navigationStore.navigateToVerse(current.translation, book, chapter, verse);
    // A pinned bio stays open across the jump — reading the passage beside the
    // person is the whole point of pinning it.
    if (!docked) onClose?.();
  }

  function popOut() {
    if (!person) return;
    onPopOut?.({ personId: person.id, primaryName: title });
  }
</script>

<div class="person-content" class:docked class:hosted={!showHeader}>
  {#if showHeader}
    <div class="person-header">
      <button
        class="contents-btn"
        class:on={showContents}
        on:click={() => (showContents = !showContents)}
        title={showContents ? "Back to the bio" : "Contents"}
        aria-label={showContents ? "Back to the bio" : "Contents"}
      >
        ☰
      </button>
      <div class="head-text">
        <h2>{title}</h2>
        <div class="sub">
          {#if showContents}
            {peopleSource.subtitle}
          {:else if person?.verseCount}
            {person.verseCount} verse{person.verseCount === 1 ? "" : "s"}
          {/if}
        </div>
      </div>
      <div class="head-actions">
        {#if !showContents && person}
          {#if isbeMatch}
            <button class="bridge-btn" on:click={openEncyclopedia}>Encyclopedia</button>
          {/if}
          {#if navesTopicId != null}
            <button class="bridge-btn" on:click={openTopical}>Topical</button>
          {/if}
          {#if hasDictionary}
            <button class="bridge-btn" on:click={openDictionary}>Dictionary</button>
          {/if}
          {#if onPopOut}
            <button class="pop-btn" on:click={popOut} title="Pin beside the reader" aria-label="Pin beside the reader">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.8" />
                <path d="M14 4v16" stroke-width="1.8" />
                <path d="M6.2 9.6L8.6 12l-2.4 2.4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          {/if}
        {/if}
        {#if onClose}
          <button class="close-btn" on:click={() => onClose?.()} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if showContents}
    <IndexList source={peopleSource} onOpen={openFromContents} initialLetter={contentsLetter} />
  {:else if loading}
    <div class="person-body"><p class="muted">Loading…</p></div>
  {:else if !person}
    <div class="person-body"><p class="muted">No bio for this name.</p></div>
  {:else}
    <div class="person-body">
      <div class="character-view">
        {#if person.nameMeaning}
          <p class="char-meaning">“{person.nameMeaning}”</p>
        {/if}
        {#if person.alsoCalled}
          <p class="char-aka">Also called: {person.alsoCalled}</p>
        {/if}

        <dl class="char-facts">
          {#if lifespan(person)}
            <dt>Lived</dt><dd>{lifespan(person)}</dd>
          {/if}
          {#if person.gender}
            <dt>Gender</dt><dd>{person.gender}</dd>
          {/if}
          {#if person.birthPlace?.name}
            <dt>Born</dt><dd>{person.birthPlace.name}</dd>
          {/if}
          {#if person.deathPlace?.name}
            <dt>Died</dt><dd>{person.deathPlace.name}</dd>
          {/if}
          {#if person.memberOf && person.memberOf.length}
            <dt>Member of</dt><dd>{person.memberOf.join(", ")}</dd>
          {/if}
          <!-- Relatives are links now: the pack has always carried their ids,
               it was only ever the name that got printed. -->
          {#if parents.length}
            <dt>Parents</dt>
            <dd class="rel-list">
              {#each parents as rel}
                <button class="rel" on:click={() => openRelation(rel)}>{rel.name}</button>
              {/each}
            </dd>
          {/if}
          {#if person.partners?.length}
            <dt>Partner{person.partners.length > 1 ? "s" : ""}</dt>
            <dd class="rel-list">
              {#each person.partners as rel}
                <button class="rel" on:click={() => openRelation(rel)}>{rel.name}</button>
              {/each}
            </dd>
          {/if}
          {#if person.children?.length}
            <dt>Children</dt>
            <dd class="rel-list">
              {#each person.children as rel}
                <button class="rel" on:click={() => openRelation(rel)}>{rel.name}</button>
              {/each}
            </dd>
          {/if}
          {#if person.siblings?.length}
            <dt>Siblings</dt>
            <dd class="rel-list">
              {#each person.siblings as rel}
                <button class="rel" on:click={() => openRelation(rel)}>{rel.name}</button>
              {/each}
            </dd>
          {/if}
        </dl>

        {#if person.verseCount}
          <div class="char-verses">
            <button class="char-verses-toggle" on:click={toggleVerseList}>
              <span class="char-verses-caret">{showVerseList ? "▼" : "▶"}</span>
              Appears in {person.verseCount} verse{person.verseCount === 1 ? "" : "s"}
            </button>
            {#if showVerseList}
              {#if versesLoading}
                <p class="char-verses-loading">Loading…</p>
              {:else}
                <div class="char-verses-books">
                  {#each versesByBook as { book, refs, color }}
                    <div class="cv-book-group">
                      <button class="cv-book-header" on:click={() => toggleBook(book, refs)}>
                        <span class="cv-book-caret" style="color:{color}">{expandedBooks.has(book) ? "▼" : "▶"}</span>
                        <span class="cv-book-name" style="color:{color}">{book}</span>
                        <span class="cv-book-count">({refs.length})</span>
                      </button>
                      {#if expandedBooks.has(book)}
                        <div class="cv-book-refs">
                          {#each refs as r}
                            <button
                              class="cv-ref"
                              style="border-left-color:{color}"
                              on:click={() => navigateToVerse(book, r.chapter, r.verse)}
                            >
                              <span class="cv-ref-label" style="color:{color}">{book} {r.chapter}:{r.verse}</span>
                              {#if versePreviews[`${book} ${r.chapter}:${r.verse}`]}
                                <span class="cv-ref-text">
                                  {@html renderVersePreviewHtml(versePreviews[`${book} ${r.chapter}:${r.verse}`])}
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
            {/if}
          </div>
        {/if}

        {#if cleanBio(person.dictText).length}
          <div class="char-bio">
            {#each cleanBio(person.dictText) as para}
              <p>{para}</p>
            {/each}
          </div>
        {/if}

        {#if onShowDefinition}
          <div class="char-footer">
            <button class="char-toggle" on:click={() => onShowDefinition?.()}>
              Show dictionary definition →
            </button>
          </div>
        {/if}

        {#if candidates.length > 1}
          <div class="char-alternates">
            <p class="char-alternates-label">
              {lookup?.matchedByVerse
                ? `Other people named “${clickedWord}”:`
                : `Multiple people named “${clickedWord}” — pick one:`}
            </p>
            <div class="char-alt-buttons">
              {#each candidates as cand}
                <button
                  class="char-alt-btn"
                  class:active={cand.id === person.id}
                  on:click={() => (chosenId = cand.id)}
                >
                  {cand.displayTitle || cand.name}
                  {#if cand.verseCount}<span class="char-alt-count">({cand.verseCount})</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="person-footer">
      {#if neighbors.prev || neighbors.next}
        <div class="turn">
          {#if neighbors.prev}
            {@const prev = neighbors.prev}
            <button class="turn-btn" on:click={() => openPerson(String(prev.id), prev.name)} title="Previous person">
              ← <span class="turn-name">{prev.name}</span>
            </button>
          {:else}
            <span></span>
          {/if}
          {#if neighbors.next}
            {@const next = neighbors.next}
            <button class="turn-btn next" on:click={() => openPerson(String(next.id), next.name)} title="Next person">
              <span class="turn-name">{next.name}</span> →
            </button>
          {/if}
        </div>
      {/if}
      <p class="char-attribution">
        Character data: Theographic Bible Metadata (CC BY-SA 4.0); name meaning: Hitchcock's (public domain)
      </p>
    </div>
  {/if}
</div>

<style>
  .person-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
  }
  .person-content.docked {
    height: 100%;
  }
  /* Inside the word-study modal the surrounding card paints the background and
     draws the header, so this one contributes neither. */
  .person-content.hosted {
    background: none;
  }

  .person-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .head-text {
    flex: 1;
    min-width: 0;
  }
  .head-text h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .head-text .sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted, #999);
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .contents-btn {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 3px 6px 3px 0;
    flex-shrink: 0;
  }
  .contents-btn:hover,
  .contents-btn.on {
    color: var(--color-primary, #4a90e2);
  }
  .bridge-btn {
    background: var(--surface-2, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-color, #333);
    color: var(--color-primary, #4a90e2);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  .bridge-btn:hover {
    border-color: var(--color-primary, #4a90e2);
  }
  .pop-btn,
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .pop-btn:hover {
    color: var(--color-primary, #4a90e2);
  }
  .close-btn:hover {
    color: var(--text-color, #fff);
  }

  .person-body {
    padding: 12px 18px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .person-content.hosted .person-body {
    padding: 0;
    overflow: visible;
  }
  .muted {
    color: var(--text-muted, #999);
  }

  .person-footer {
    padding: 8px 18px 12px;
    border-top: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .person-content.hosted .person-footer {
    padding: 12px 0 0;
  }
  .turn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .turn-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--text-muted, #999);
    font-family: inherit;
    font-size: 11px;
    padding: 0;
    cursor: pointer;
    min-width: 0;
  }
  .turn-btn:hover {
    color: var(--color-primary, #4a90e2);
  }
  .turn-btn.next {
    justify-content: flex-end;
    text-align: right;
  }
  .turn-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 12ch;
  }

  /* Everything below is the bio exactly as it looked inside the word-study
     modal, moved rather than restyled. */
  .character-view {
    padding: 4px 2px;
  }
  .char-meaning {
    font-size: 16px;
    font-style: italic;
    color: #d8dbe0;
    margin: 0 0 8px;
  }
  .char-aka {
    font-size: 13px;
    color: #9aa0aa;
    margin: 0 0 12px;
  }
  .char-facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 9px 16px;
    margin: 0 0 16px;
    line-height: 1.5;
  }
  .char-facts dt {
    font-weight: 600;
    color: #b8bdc6;
    font-size: 14.5px;
  }
  .char-facts dd {
    margin: 0;
    color: #ececf0;
    font-size: 14.5px;
  }
  .rel-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .rel {
    background: none;
    border: none;
    padding: 0;
    color: #8bc34a;
    font-family: inherit;
    font-size: 14.5px;
    cursor: pointer;
    text-align: left;
  }
  .rel:hover {
    text-decoration: underline;
  }
  .char-bio p {
    color: #dfe2e8;
    font-size: 14px;
    line-height: 1.6;
    margin: 0 0 10px;
  }
  .char-alternates {
    margin: 14px 0 4px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .char-alternates-label {
    font-size: 12px;
    color: #9aa0aa;
    margin: 0 0 6px;
  }
  .char-alt-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .char-alt-btn {
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.06);
    color: #dfe2e8;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .char-alt-btn.active {
    background: #4caf50;
    border-color: #4caf50;
    color: #fff;
  }
  .char-alt-count {
    opacity: 0.7;
    margin-left: 3px;
  }
  .char-attribution {
    margin: 0;
    font-size: 11px;
    color: #888;
  }
  .char-footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .char-toggle {
    background: none;
    border: none;
    color: #8bc34a;
    font-size: 13px;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }
  .char-verses {
    margin: 0 0 16px;
  }
  .char-verses-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    color: #ececf0;
    font-size: 14.5px;
    font-weight: 600;
    cursor: pointer;
    padding: 4px 0;
    text-align: left;
    font-family: inherit;
  }
  .char-verses-caret {
    color: #8bc34a;
    font-size: 11px;
  }
  .char-verses-loading {
    color: #9aa0aa;
    font-size: 13px;
    margin: 6px 0 0 18px;
  }
  .char-verses-books {
    margin: 6px 0 0;
  }
  .cv-book-group {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .cv-book-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: #dfe2e8;
    font-size: 13.5px;
    cursor: pointer;
    padding: 7px 4px;
    text-align: left;
    font-family: inherit;
  }
  .cv-book-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .cv-book-caret {
    color: #8bc34a;
    font-size: 10px;
  }
  .cv-book-name {
    flex: 1;
  }
  .cv-book-count {
    color: #9aa0aa;
    font-size: 12px;
  }
  .cv-book-refs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 4px 10px 24px;
  }
  .cv-ref {
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
  .cv-ref:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .cv-ref-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .cv-ref-text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #c2c6cd;
    font-size: 12.5px;
    line-height: 1.4;
  }
</style>
