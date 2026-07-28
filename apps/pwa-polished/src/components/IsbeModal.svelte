<script lang="ts">
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import L from "leaflet";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { isbeReturnStore } from "../stores/isbeReturnStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { navigationStore } from "../stores/navigationStore";
  import { getBookColor, BIBLE_BOOKS, normalizeBookName } from "../lib/bibleData.js";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import {
    getIsbeEntry,
    getIsbePlace,
    getIsbePlaceByEntryId,
    getIsbePlaceVerses,
    getIsbePlaceNames,
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

  // Keyed on the book NAME — keying on the BookInfo object silently made every
  // lookup miss, which turned the canonical sort below into a no-op.
  const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
  const verseTextStore = new IndexedDBTextStore();

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
    placeNames = [];
    activeTab = "overview";
    expanded = {};
    expandedBooks = new Set();
    versePreviews = {};

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
    if (place) placeNames = await getIsbePlaceNames(place.placeId);
    loading = false;

    // The back arrow reopens the modal straight onto the tab you left, with the
    // books you had open still open. The nav bar leaves the return context in
    // place for us to consume here.
    if (state.tab) {
      const restore = get(isbeReturnStore);
      isbeReturnStore.set(null);
      if (restore) expandedBooks = new Set(restore.expandedBooks);
      await selectTab(state.tab);
      // versesByBook is derived from `verses`, assigned moments ago — let the
      // reactive pass land before loadBookText reads it.
      await tick();
      for (const book of expandedBooks) await loadBookText(book);
    }
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

  // Verses grouped by book, in canonical order, for the Verses tab. Book names
  // are normalized first so an alias spelling from the pack joins its real
  // group instead of forming its own with the grey fallback color.
  $: versesByBook = (() => {
    const groups = new Map<string, VerseRef[]>();
    for (const v of verses) {
      const book = normalizeBookName(v.book);
      if (!groups.has(book)) groups.set(book, []);
      groups.get(book)!.push({ ...v, book });
    }
    return [...groups.entries()]
      .map(([book, refs]) => ({
        book,
        color: getBookColor(book),
        refs: refs.sort((a, b) => a.chapter - b.chapter || a.verse - b.verse),
      }))
      .sort((a, b) => (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999));
  })();

  // --- Verses tab --------------------------------------------------------
  // Same shape as search results: books collapse, expanding one loads its verse
  // text, and the place's own name is highlighted so you can read down the
  // column and see how it's used across every passage at once.
  let placeNames: string[] = [];
  let expandedBooks = new Set<string>();
  let versePreviews: Record<string, string> = {}; // "Book chapter:verse" -> text

  async function toggleBook(book: string) {
    const next = new Set(expandedBooks);
    if (next.has(book)) {
      next.delete(book);
      expandedBooks = next;
      return;
    }
    next.add(book);
    expandedBooks = next;
    await loadBookText(book);
  }

  // Verse text for one book, in the reader's current translation. Books start
  // collapsed, so a place like Jerusalem never pays for all 955 verses at once.
  async function loadBookText(book: string) {
    const refs = versesByBook.find((g) => g.book === book)?.refs ?? [];
    const translation = get(navigationStore).translation;
    const loaded = await Promise.all(
      refs.map(async (r) => {
        const key = `${book} ${r.chapter}:${r.verse}`;
        if (versePreviews[key] !== undefined) return [key, versePreviews[key]] as const;
        const text = (await verseTextStore.getVerse(translation, book, r.chapter, r.verse)) ?? "";
        return [key, text] as const;
      }),
    );
    versePreviews = { ...versePreviews, ...Object.fromEntries(loaded) };
  }

  // One pattern for every name the place goes by, longest first so "daughter of
  // judah" wins over the bare "judah". Names are stored space-normalized
  // ("beth shemesh") but translations punctuate them differently — Beth-shemesh
  // in BSB/KJV, Beth Shemesh in NET/WEB, Bethshemesh in places — so a space in a
  // stored name matches any separator, or none.
  $: highlightRe = (() => {
    const alt = [...placeNames]
      .sort((a, b) => b.length - a.length)
      .filter((n) => n.length >= 2)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "[\\s\\-\u2010-\u2015']*"))
      .join("|");
    return alt ? new RegExp(`(${alt})`, "gi") : null;
  })();

  function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Trim a long verse to a window around the first name match, the way search
  // snippets do. Short verses come through whole.
  function snippet(text: string): string {
    const MAX = 150;
    if (text.length <= MAX) return text;
    // search() ignores the /g flag's lastIndex, so this stays reentrant.
    const at = highlightRe ? text.search(highlightRe) : -1;
    if (at < 0) return text.slice(0, MAX).replace(/\s\S*$/, "") + "…";
    let start = Math.max(0, at - 60);
    let end = Math.min(text.length, start + MAX);
    if (start > 0) start = text.indexOf(" ", start) + 1 || start;
    if (end < text.length) end = text.lastIndexOf(" ", end);
    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }

  // Escape first, then inject <mark> — same order as the search results
  // highlighter, which is what makes the {@html} below safe.
  function highlight(text: string): string {
    if (!text) return "";
    const safe = escapeHtml(text);
    return highlightRe ? safe.replace(highlightRe, "<mark>$1</mark>") : safe;
  }

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

  // Jumping from the Verses tab leaves a breadcrumb so the nav back arrow can
  // bring this modal back, on the same tab with the same books open — you can
  // work down a long verse list one passage at a time.
  function navigateFromVerseList(book: string, chapter: number, verse: number) {
    isbeReturnStore.set({
      modal: {
        kind: state.kind,
        entryId: state.entryId,
        placeId: state.placeId,
        primaryName: state.primaryName,
        tab: "verses",
      },
      expandedBooks: [...expandedBooks],
      at: { book, chapter, verse },
    });
    navigateToVerse(book, chapter, verse);
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

  // Tint each scripture link with the color of the book it points at, the same
  // way the Verses tab colors its chips. Done as an inline style because the
  // article is injected with {@html} and the color varies per link.
  function colorScriptureLinks(html: string): string {
    return html.replace(
      /<a class="isbe-scripture" data-osis="([^".]*)[^"]*"/g,
      (tag, code) => {
        const book = osisBook(code);
        return book ? `${tag} style="color:${getBookColor(book)}"` : tag;
      },
    );
  }

  function buildArticle(rawHtml: string): ArticleTree | null {
    const bodyHtml = colorScriptureLinks(rawHtml);
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
  // Short articles skip the accordion and render straight through, but their
  // scripture links still need tinting.
  $: flatHtml = entry?.bodyHtml ? colorScriptureLinks(entry.bodyHtml) : "";

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
              {@html flatHtml}
            {/if}
          </div>
        {:else if activeTab === "verses"}
          <div class="verses">
            {#each versesByBook as group}
              <div class="vb-group">
                <button class="vb-header" on:click={() => toggleBook(group.book)}>
                  <span class="vb-caret" style="color:{group.color}">
                    {expandedBooks.has(group.book) ? "▼" : "▶"}
                  </span>
                  <span class="vb-name" style="color:{group.color}">{group.book}</span>
                  <span class="vb-count">({group.refs.length})</span>
                </button>
                {#if expandedBooks.has(group.book)}
                  <div class="vb-refs">
                    {#each group.refs as r}
                      {@const key = `${group.book} ${r.chapter}:${r.verse}`}
                      <button
                        class="vb-ref"
                        style="border-left-color:{group.color}"
                        on:click={() => navigateFromVerseList(group.book, r.chapter, r.verse)}
                      >
                        <span class="vb-ref-label" style="color:{group.color}">
                          {group.book} {r.chapter}:{r.verse}
                        </span>
                        {#if versePreviews[key]}
                          <span class="vb-ref-text">{@html highlight(snippet(versePreviews[key]))}</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}
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
  /* Scripture links carry an inline color from getBookColor; this is the
     fallback for a reference whose OSIS book code we don't recognize, and
     matches getBookColor's own fallback. */
  .article :global(a.isbe-scripture) {
    color: #8a8f98;
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
  /* Cross-references point at other encyclopedia entries, not verses, so they
     get one fixed accent — the violet the nav bar uses for its refs pill. */
  .article :global(a.isbe-link) {
    color: #a78bfa;
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
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
  }
  .vb-ref:hover {
    background: rgba(255, 255, 255, 0.09);
  }
  .vb-ref-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .vb-ref-text {
    display: block;
    color: #c2c6cd;
    font-size: 12.5px;
    line-height: 1.45;
  }
  /* Same mark styling as search results, so a verse list reads identically
     whether you got here from search or from the encyclopedia. */
  .vb-ref-text :global(mark) {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
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
