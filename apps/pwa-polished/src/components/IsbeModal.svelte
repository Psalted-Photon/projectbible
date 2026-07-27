<script lang="ts">
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import L from "leaflet";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { navigationStore } from "../stores/navigationStore";
  import { getBookColor, BIBLE_BOOKS } from "../lib/bibleData.js";
  import {
    getIsbeEntry,
    getIsbePlace,
    getIsbePlaceByEntryId,
    getIsbePlaceVerses,
    getIsbeEntryByName,
    lookupEnglishWord,
    type IsbeEntryRecord,
    type IsbePlaceRecord,
    type VerseRef,
  } from "../adapters/lexicon-lookup.js";

  $: state = $isbeModalStore;
  $: isOpen = state.isOpen;

  type Tab = "overview" | "article" | "verses" | "map";
  let activeTab: Tab = "overview";

  let entry: IsbeEntryRecord | null = null;
  let place: IsbePlaceRecord | null = null;
  let verses: VerseRef[] = [];
  let loading = false;

  let mapEl: HTMLDivElement | null = null;
  let map: L.Map | null = null;

  const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b, i]));

  // Load full data whenever a new modal target opens.
  let loadedKey = "";
  $: if (isOpen) {
    const key = `${state.kind}:${state.entryId}:${state.placeId}`;
    if (key !== loadedKey) {
      loadedKey = key;
      loadData();
    }
  } else {
    loadedKey = "";
    destroyMap();
  }

  async function loadData() {
    loading = true;
    entry = null;
    place = null;
    verses = [];
    activeTab = "overview";

    if (state.placeId) {
      place = await getIsbePlace(state.placeId);
      if (place) verses = await getIsbePlaceVerses(place.placeId);
      if (place?.entryId != null) entry = await getIsbeEntry(place.entryId);
    } else if (state.entryId != null) {
      entry = await getIsbeEntry(state.entryId);
      // Opened by entry (e.g. from search). If it's a place, pull a representative
      // location so the Map and Verses tabs light up too.
      if (entry?.isPlace) {
        place = await getIsbePlaceByEntryId(state.entryId);
        if (place) verses = await getIsbePlaceVerses(place.placeId);
      }
    }
    loading = false;
  }

  $: title = place?.primaryName || entry?.primaryName || state.primaryName;

  // --- Dictionary bridge -------------------------------------------------
  // Offer a jump to the plain dictionary for this term, but only when the
  // dictionary actually has definitions for it (kept in sync as the entry loads).
  let dictWord = "";
  let hasDictionary = false;
  let dictCheckedFor = "";

  // "HEBREWS, EPISTLE TO THE" -> "hebrews"; "Hebrew (1)" -> "hebrew".
  function dictTermFor(name: string): string {
    return (name || "").split(/[;,(]/)[0].trim().split(/\s+/)[0].toLowerCase();
  }

  async function checkDictionary(name: string) {
    const term = dictTermFor(name);
    if (dictCheckedFor === term) return;
    dictCheckedFor = term;
    dictWord = term;
    hasDictionary = false;
    if (!term) return;
    try {
      const e = await lookupEnglishWord(term);
      hasDictionary = !!(e && (e.modern?.length || e.historic?.length || e.wordset?.length));
    } catch {
      hasDictionary = false;
    }
  }

  $: if (isOpen && !loading && title) checkDictionary(title);
  $: if (!isOpen) dictCheckedFor = "";

  function openDictionary() {
    const term = dictWord;
    close();
    lexicalModalStore.open({
      selectedText: term,
      strongsId: undefined,
      morphologyData: null,
      lexicalEntries: null,
    });
  }

  $: hasArticle = !!entry && !!entry.bodyHtml;
  $: hasMap = !!place && place.latitude != null && place.longitude != null;
  $: hasVerses = verses.length > 0;

  // Verses grouped by book, in canonical order, for the Verses tab.
  $: versesByBook = (() => {
    const groups = new Map<string, VerseRef[]>();
    for (const v of verses) {
      if (!groups.has(v.book)) groups.set(v.book, []);
      groups.get(v.book)!.push(v);
    }
    return [...groups.entries()]
      .map(([book, refs]) => ({
        book,
        color: getBookColor(book),
        refs: refs.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse),
      }))
      .sort((a, b) => (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999));
  })();

  function subtitle(): string {
    const bits: string[] = [];
    if (place?.type) bits.push(titleCaseType(place.type));
    else if (entry) bits.push("Encyclopedia");
    if (place?.modernName) bits.push(place.modernName);
    if (hasVerses) bits.push(`${verses.length} verse${verses.length === 1 ? "" : "s"}`);
    return bits.join("  ·  ");
  }

  function titleCaseType(t: string): string {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function selectTab(t: Tab) {
    activeTab = t;
    if (t === "map" && hasMap) {
      await tick();
      renderMap();
    }
  }

  function renderMap() {
    if (!mapEl || !place || place.latitude == null || place.longitude == null) return;
    destroyMap();
    map = L.map(mapEl, { attributionControl: true, zoomControl: true }).setView(
      [place.latitude, place.longitude],
      9,
    );
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18, attribution: "Esri" },
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 18 },
    ).addTo(map);
    // circleMarker avoids Leaflet's default PNG marker icons (which 404 with the
    // CDN stylesheet and offline).
    L.circleMarker([place.latitude, place.longitude], {
      radius: 8,
      color: "#e2574a",
      weight: 2,
      fillColor: "#e2574a",
      fillOpacity: 0.5,
    })
      .addTo(map)
      .bindPopup(title);
    // Leaflet needs a size recalculation once the container is visible.
    setTimeout(() => map?.invalidateSize(), 60);
  }

  function destroyMap() {
    if (map) {
      map.remove();
      map = null;
    }
  }

  function navigateToVerse(book: string, chapter: number, verse: number) {
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    navigationStore.navigateToVerse(current.translation, book, chapter, verse);
    close();
  }

  // Clicks inside the article body: scripture refs navigate, internal ISBE refs
  // open that entry. Both are delegated here so we don't wire per-link handlers.
  async function onArticleClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const osis = a.getAttribute("data-osis");
    if (osis) {
      const [bk, ch, vs] = osis.split(".");
      const book = osisBook(bk);
      if (book) navigateToVerse(book, parseInt(ch, 10), parseInt(vs, 10) || 1);
      return;
    }
    const target = a.getAttribute("data-entry");
    if (target) {
      const next = await getIsbeEntryByName(target);
      if (next) isbeModalStore.openEntry(next.entryId, next.primaryName);
    }
  }

  // OSIS book code -> canonical name for scripture-link navigation.
  const OSIS_BOOK: Record<string, string> = {
    Gen: "Genesis", Exod: "Exodus", Lev: "Leviticus", Num: "Numbers", Deut: "Deuteronomy",
    Josh: "Joshua", Judg: "Judges", Ruth: "Ruth", "1Sam": "1 Samuel", "2Sam": "2 Samuel",
    "1Kgs": "1 Kings", "2Kgs": "2 Kings", "1Chr": "1 Chronicles", "2Chr": "2 Chronicles",
    Ezra: "Ezra", Neh: "Nehemiah", Esth: "Esther", Job: "Job", Ps: "Psalms", Prov: "Proverbs",
    Eccl: "Ecclesiastes", Song: "Song of Solomon", Isa: "Isaiah", Jer: "Jeremiah",
    Lam: "Lamentations", Ezek: "Ezekiel", Dan: "Daniel", Hos: "Hosea", Joel: "Joel",
    Amos: "Amos", Obad: "Obadiah", Jonah: "Jonah", Mic: "Micah", Nah: "Nahum", Hab: "Habakkuk",
    Zeph: "Zephaniah", Hag: "Haggai", Zech: "Zechariah", Mal: "Malachi", Matt: "Matthew",
    Mark: "Mark", Luke: "Luke", John: "John", Acts: "Acts", Rom: "Romans",
    "1Cor": "1 Corinthians", "2Cor": "2 Corinthians", Gal: "Galatians", Eph: "Ephesians",
    Phil: "Philippians", Col: "Colossians", "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians",
    "1Tim": "1 Timothy", "2Tim": "2 Timothy", Titus: "Titus", Phlm: "Philemon", Heb: "Hebrews",
    Jas: "James", "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John",
    "3John": "3 John", Jude: "Jude", Rev: "Revelation",
  };
  function osisBook(code: string): string | null {
    return OSIS_BOOK[code] || null;
  }

  // Jump to a heading paragraph in the article (from the outline nav).
  let articleBody: HTMLDivElement | null = null;
  function jumpToParagraph(i: number) {
    const p = articleBody?.querySelectorAll("p")[i];
    if (p) p.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function close() {
    destroyMap();
    isbeModalStore.close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen) close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if isOpen}
  <div class="modal-backdrop" on:click={handleBackdropClick} role="presentation">
    <div class="modal-container">
      <div class="modal-header">
        <div class="head-text">
          <h2>{title}</h2>
          {#if !loading}<div class="sub">{subtitle()}</div>{/if}
        </div>
        <div class="head-actions">
          {#if hasDictionary}
            <button class="bridge-btn" on:click={openDictionary}>Dictionary</button>
          {/if}
          <button class="close-btn" on:click={close} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div class="tabs">
        <button class:active={activeTab === "overview"} on:click={() => selectTab("overview")}>Overview</button>
        {#if hasArticle}
          <button class:active={activeTab === "article"} on:click={() => selectTab("article")}>Article</button>
        {/if}
        {#if hasVerses}
          <button class:active={activeTab === "verses"} on:click={() => selectTab("verses")}>Verses</button>
        {/if}
        {#if hasMap}
          <button class:active={activeTab === "map"} on:click={() => selectTab("map")}>Map</button>
        {/if}
      </div>

      <div class="modal-body">
        {#if loading}
          <div class="muted">Loading…</div>
        {:else if activeTab === "overview"}
          <div class="facts">
            {#if place?.type}<div><span class="k">Type</span><span>{titleCaseType(place.type)}</span></div>{/if}
            {#if place?.modernName}<div><span class="k">Modern</span><span>{place.modernName}</span></div>{/if}
            {#if hasMap}<div><span class="k">Coordinates</span><span>{place.latitude?.toFixed(4)}, {place.longitude?.toFixed(4)}</span></div>{/if}
            {#if hasVerses}<div><span class="k">Appears in</span><span>{verses.length} verse{verses.length === 1 ? "" : "s"}</span></div>{/if}
          </div>
          {#if entry?.lead}
            <p class="lead">{entry.lead}</p>
          {/if}
          {#if hasArticle}
            <button class="link-btn" on:click={() => selectTab("article")}>
              Read the full article{entry ? ` (${(entry.charCount / 1000).toFixed(0)}k chars)` : ""} →
            </button>
          {:else if !place}
            <p class="muted">No encyclopedia article for this entry.</p>
          {/if}
        {:else if activeTab === "article" && entry}
          {#if entry.outline}
            <div class="outline">
              {#each entry.outline as h}
                <button on:click={() => jumpToParagraph(h.i)}>{h.t}</button>
              {/each}
            </div>
          {/if}
          <div class="article" bind:this={articleBody} on:click={onArticleClick} role="presentation">
            {@html entry.bodyHtml}
          </div>
        {:else if activeTab === "verses"}
          <div class="verses">
            {#each versesByBook as group}
              <div class="verse-group">
                <div class="verse-book" style="color:{group.color}">{group.book}</div>
                <div class="verse-refs">
                  {#each group.refs as r}
                    <button
                      class="verse-chip"
                      style="border-color:{group.color}"
                      on:click={() => navigateToVerse(r.book, r.chapter, r.verse)}
                    >
                      {r.chapter}:{r.verse}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else if activeTab === "map" && hasMap}
          <div class="map" bind:this={mapEl}></div>
          {#if place}
            <div class="map-meta">
              {place.latitude?.toFixed(5)}, {place.longitude?.toFixed(5)}
              {#if place.modernName}· near {place.modernName}{/if}
            </div>
          {/if}
        {/if}
      </div>

      <div class="modal-footer">
        <span class="src">International Standard Bible Encyclopedia (1915, public domain) · place data © OpenBible.info CC BY 4.0</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    padding: 16px;
    backdrop-filter: blur(3px);
  }
  .modal-container {
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
    border-radius: 10px;
    width: min(720px, 100%);
    max-height: min(86vh, 900px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .head-text h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.15;
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
  .bridge-btn {
    background: var(--surface-2, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-color, #333);
    color: var(--color-primary, #4a90e2);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .bridge-btn:hover {
    border-color: var(--color-primary, #4a90e2);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    padding: 2px;
    flex-shrink: 0;
  }
  .close-btn:hover {
    color: var(--text-color, #fff);
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--border-color, #333);
    overflow-x: auto;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #999);
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
  }
  .modal-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  }
  .muted {
    color: var(--text-muted, #999);
  }
  .facts {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }
  .facts > div {
    display: flex;
    gap: 10px;
    font-size: 14px;
  }
  .facts .k {
    color: var(--text-muted, #999);
    min-width: 96px;
  }
  .lead {
    line-height: 1.55;
    margin: 0 0 14px;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--color-primary, #4a90e2);
    cursor: pointer;
    padding: 0;
    font-size: 14px;
  }
  .outline {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .outline button {
    background: var(--surface-2, rgba(255, 255, 255, 0.06));
    border: none;
    color: var(--text-secondary, #ccc);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .outline button:hover {
    color: var(--color-primary, #4a90e2);
  }
  .article {
    line-height: 1.6;
    font-size: 15px;
  }
  .article :global(p) {
    margin: 0 0 12px;
  }
  .article :global(a.isbe-scripture) {
    color: var(--color-primary, #4a90e2);
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
  .article :global(a.isbe-link) {
    color: var(--color-accent, #b78be2);
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
  .verse-group {
    margin-bottom: 12px;
  }
  .verse-book {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 5px;
  }
  .verse-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .verse-chip {
    background: none;
    border: 1px solid;
    border-radius: 4px;
    color: var(--text-color, #fff);
    padding: 2px 7px;
    font-size: 12px;
    cursor: pointer;
  }
  .verse-chip:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .map {
    width: 100%;
    height: 360px;
    border-radius: 8px;
    overflow: hidden;
  }
  .map-meta {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted, #999);
  }
  .modal-footer {
    padding: 8px 18px 12px;
    border-top: 1px solid var(--border-color, #333);
  }
  .src {
    font-size: 10px;
    color: var(--text-muted, #888);
  }
</style>
