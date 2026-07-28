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
    expanded = {};

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

  // --- Article structure -------------------------------------------------
  // An ISBE article is a flat run of <p> elements: first the article's own
  // table of contents (headings only, duplicated verbatim), then the body,
  // whose sections are marked by heading paragraphs — "I. The Name." for a
  // roman section, "1. In Cuneiform:" for its subsections. We rebuild that
  // into a two-level tree so the article can render collapsed: the contents
  // list and the article become the same thing, and each heading opens its own
  // text in place rather than scrolling somewhere else.
  type Section = { title: string; html: string; children: Section[] };
  type ArticleTree = { preamble: string; sections: Section[] };

  const P_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  // Same heading shape buildOutline uses in scripts/build-isbe-pack.mjs, minus
  // its 120-item cap (which left Jerusalem's last three sections unreachable).
  const HEAD_RE = /^((?:[IVXLC]+|\d+)\.)\s+(.{1,70}?)(?:[.:]|$)/;

  function paraText(inner: string): string {
    return inner
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function headingOf(text: string): { level: 1 | 2; title: string } | null {
    // Headings occupy a paragraph of their own, so anything long is prose that
    // merely happens to open with a number.
    if (text.length > 100) return null;
    const m = text.match(HEAD_RE);
    if (!m || !/[A-Za-z]/.test(m[2]) || m[2] !== m[2].replace(/\s{2,}/g, " ")) return null;
    return { level: /^\d/.test(m[1]) ? 2 : 1, title: `${m[1]} ${m[2].trim()}` };
  }

  // Titles differ in case and trailing punctuation between the contents block
  // ("I. THE NAME") and the body ("I. The Name."), so compare them loosely.
  function normTitle(t: string): string {
    return t.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  }

  function buildArticle(bodyHtml: string): ArticleTree | null {
    const paras = [...bodyHtml.matchAll(P_RE)].map((m) => {
      let text = paraText(m[1]);
      let html = m[0];
      // Stray leading pipes are markup residue: "|| I. INTRODUCTORY".
      if (/^\|+\s*/.test(text)) {
        text = text.replace(/^\|+\s*/, "");
        html = html.replace(/\|+\s*/, "");
      }
      // The contents block's last line can be glued to the first real heading:
      // "LITERATURE I. The Name." Split the prefix off or section I is lost.
      if (/^LITERATURE\s+(?:[IVXLC]+|\d+)\.\s/i.test(text)) {
        text = text.replace(/^LITERATURE\s+/i, "");
        html = html.replace(/LITERATURE\s+/i, "");
      }
      return { html, text, head: headingOf(text) };
    });
    if (paras.length < 8) return null;

    // Does this heading's title turn up again further down? Only the contents
    // block echoes; a body heading is the last mention of itself. That test is
    // what keeps us from deleting real content off an article that merely opens
    // with several headings in a row.
    const lastAt = new Map<string, number>();
    paras.forEach((p, i) => {
      if (p.head) lastAt.set(normTitle(p.head.title), i);
    });
    const echoes = paras.map(
      (p, i) => !!p.head && (lastAt.get(normTitle(p.head.title)) ?? i) > i,
    );

    // Walk the contents block from the article's first heading. Short
    // non-heading lines are its annotations ("Its Divisions", "(1) The
    // Scribes") and stay inside it; the first real paragraph of prose ends it,
    // as does a heading with no echo — that one already belongs to the body.
    let tocStart = -1;
    let tocEnd = -1;
    const first = paras.findIndex((p) => p.head);
    if (first >= 0 && first <= 3) {
      let last = -1;
      let n = 0;
      for (let i = first; i < paras.length; i++) {
        if (paras[i].text.length > 200) break;
        if (!paras[i].head) continue;
        if (echoes[i]) {
          last = i;
          n++;
        } else if (!echoes.slice(i + 1, i + 4).some(Boolean)) break;
      }
      if (n >= 8) {
        tocStart = first;
        tocEnd = last;
        // A bare "LITERATURE" often tails the contents block; the real
        // bibliography under that name sits at the far end of the article.
        if (paras[tocEnd + 1]?.text.toUpperCase() === "LITERATURE") tocEnd++;
      }
    }
    const kept =
      tocStart < 0 ? paras : [...paras.slice(0, tocStart), ...paras.slice(tocEnd + 1)];

    const preamble: string[] = [];
    const sections: Section[] = [];
    let cur1: Section | null = null;
    let cur2: Section | null = null;
    let headings = 0;

    for (const p of kept) {
      if (p.head?.level === 1) {
        cur1 = { title: p.head.title, html: "", children: [] };
        cur2 = null;
        sections.push(cur1);
        headings++;
      } else if (p.head?.level === 2) {
        cur2 = { title: p.head.title, html: "", children: [] };
        // Articles with no roman level at all (most of them) flatten to a
        // single-level accordion.
        (cur1 ? cur1.children : sections).push(cur2);
        headings++;
      } else if (cur2) cur2.html += p.html;
      else if (cur1) cur1.html += p.html;
      else preamble.push(p.html);
    }

    if (headings < 3) return null;
    return { preamble: preamble.join(""), sections };
  }

  $: article = entry?.bodyHtml ? buildArticle(entry.bodyHtml) : null;

  // Which sections are open, keyed "0" for a top section and "0.2" for a child.
  let expanded: Record<string, boolean> = {};
  function toggleSection(key: string) {
    expanded = { ...expanded, [key]: !expanded[key] };
  }

  $: sectionCount = article
    ? article.sections.reduce((n, s) => n + 1 + s.children.length, 0)
    : 0;
  $: allExpanded =
    sectionCount > 0 && Object.values(expanded).filter(Boolean).length >= sectionCount;

  function toggleAll() {
    if (allExpanded) {
      expanded = {};
      return;
    }
    const next: Record<string, boolean> = {};
    article?.sections.forEach((s, i) => {
      next[`${i}`] = true;
      s.children.forEach((_, j) => {
        next[`${i}.${j}`] = true;
      });
    });
    expanded = next;
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
          <div class="article" on:click={onArticleClick} role="presentation">
            {#if article}
              {#if article.preamble}
                <div class="prose">{@html article.preamble}</div>
              {/if}
              <button class="expand-all" on:click={toggleAll}>
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
              {#each article.sections as s, i}
                <div class="sec">
                  <button
                    class="sec-head"
                    class:open={expanded[`${i}`]}
                    on:click={() => toggleSection(`${i}`)}
                  >
                    <svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span>{s.title}</span>
                  </button>
                  {#if expanded[`${i}`]}
                    <div class="sec-body">
                      {#if s.html}<div class="prose">{@html s.html}</div>{/if}
                      {#each s.children as c, j}
                        <div class="sec">
                          <button
                            class="sec-head sub"
                            class:open={expanded[`${i}.${j}`]}
                            on:click={() => toggleSection(`${i}.${j}`)}
                          >
                            <svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                              <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            <span>{c.title}</span>
                          </button>
                          {#if expanded[`${i}.${j}`]}
                            <div class="sec-body">
                              <div class="prose">{@html c.html}</div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              {@html entry.bodyHtml}
            {/if}
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
    flex-shrink: 0;
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
    flex-wrap: wrap;
    gap: 2px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--border-color, #333);
    /* Must not shrink: the body's flex-basis resolves to its full content
       height (the container has no definite height), so a tall tab — 955 verse
       chips, a 193k-char article — makes flexbox squash every shrinkable row.
       Wrapping instead of scrolling keeps all four tabs reachable when narrow. */
    flex-shrink: 0;
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
    min-height: 0;
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
  .expand-all {
    background: none;
    border: 1px solid var(--border-color, #333);
    color: var(--text-muted, #999);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    margin-bottom: 6px;
  }
  .expand-all:hover {
    color: var(--color-primary, #4a90e2);
    border-color: var(--color-primary, #4a90e2);
  }
  .sec-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-color, #333);
    color: var(--text-color, #fff);
    font-family: inherit;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.35;
    text-align: left;
    padding: 10px 0 8px;
    cursor: pointer;
  }
  .sec-head:hover {
    color: var(--color-primary, #4a90e2);
  }
  .sec-head .caret {
    flex-shrink: 0;
    color: var(--text-muted, #999);
    transition: transform 0.15s ease;
  }
  .sec-head.open .caret {
    transform: rotate(90deg);
  }
  .sec-head.sub {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary, #ccc);
    border-bottom: none;
    padding: 6px 0;
  }
  .sec-body {
    padding: 8px 0 10px 18px;
  }
  .sec-head.sub + .sec-body {
    padding: 2px 0 8px 18px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
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
    flex-shrink: 0;
  }
  .src {
    font-size: 10px;
    color: var(--text-muted, #888);
  }
</style>
