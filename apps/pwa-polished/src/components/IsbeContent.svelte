<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import L from "leaflet";
  import { isbeModalStore, type IsbeTab } from "../stores/isbeModalStore";
  import { isbeReturnStore, type IsbeReturn } from "../stores/isbeReturnStore";
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { openMapWindow } from "../lib/openMapWindow";
  import { getBookColor, BIBLE_BOOKS, normalizeBookName } from "../lib/bibleData.js";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { renderVersePreviewHtml } from "../lib/verseRendering";
  import {
    getIsbeEntry,
    getIsbePlace,
    getIsbePlaceByEntryId,
    getIsbePlaceVerses,
    getIsbePlaceNames,
    getIsbeEntryByName,
    resolveIsbeEntryNames,
    getIsbeNeighbors,
    resolveWorks,
    libraryLetterOf,
    type IsbeEntryRecord,
    type IsbePlaceRecord,
    type VerseRef,
    type LibraryRow,
    type WorksResolution,
  } from "../adapters/lexicon-lookup.js";
  import IndexList from "./library/IndexList.svelte";
  import LibraryNavButtons from "./library/LibraryNavButtons.svelte";
  import WorkTabs from "./WorkTabs.svelte";
  import { openWorkSubject, openWorkIndex, carriedWorks, type WorkKey } from "../lib/openWork";
  import { isbeSource } from "../lib/library/source";
  import { libraryPrefsStore } from "../stores/libraryPrefsStore";

  // The encyclopedia article itself, independent of what is holding it. Two
  // hosts: IsbeModal, a centered card over the reader; and a docked window,
  // which is the same article pinned to an edge with the reader still readable
  // beside it. `windowId` is what tells the two apart.
  export let kind: "place" | "entry" = "entry";
  export let entryId: number | null = null;
  export let placeId: string | null = null;
  export let primaryName = "";

  /** Where to reopen: the tab, what was left expanded, which refs were already
   *  followed, and how far down the body was scrolled. Set both by the nav back
   *  arrow's round trip and by popping the article out into a window. */
  export let initialTab: IsbeTab | null = null;
  export let initialExpanded: Record<string, boolean> = {};
  export let initialExpandedBooks: string[] = [];
  export let initialVisited: string[] = [];
  export let initialScrollTop = 0;
  /** Articles walked through to reach this one, oldest first — the back trail. */
  export let initialTrail: TrailStop[] = [];

  /** Set when docked: the id of the window hosting this article. */
  export let windowId: string | null = null;
  /** Modal only — the shell's own close. Docked, Window.svelte supplies the ×. */
  export let onClose: (() => void) | null = null;
  /** Modal only — hands the live view up so the window opens where you left off. */
  export let onPopOut: ((snap: PopOutSnapshot) => void) | null = null;
  /** Reports the view on the way out, so switching tabs and coming back lands
   *  where you left rather than at the top. */
  export let onSnapshot: ((snap: PopOutSnapshot) => void) | null = null;

  type PopOutSnapshot = {
    primaryName: string;
    tab: IsbeTab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    visited: string[];
    scrollTop: number;
    trail: TrailStop[];
  };

  /** One step of the back trail: enough to reopen that article exactly. */
  type TrailStop = { entryId: number | null; placeId: string | null; name: string };

  $: docked = !!windowId;

  type Tab = IsbeTab;
  let activeTab: Tab = "overview";

  // --- Contents ----------------------------------------------------------
  // The article and the contents list share this component: the header's back
  // and flip buttons swap between them, so both the popup and a pinned window
  // can browse. Opened with nothing to show — which the Encyclopedia tile does
  // whenever you last closed it more than half an hour ago — the contents are
  // what you land on.
  let showContents = entryId == null && placeId == null;
  let trail: TrailStop[] = [...initialTrail];
  let neighbors: { prev: LibraryRow | null; next: LibraryRow | null } = { prev: null, next: null };

  let entry: IsbeEntryRecord | null = null;
  let place: IsbePlaceRecord | null = null;
  let verses: VerseRef[] = [];
  let loading = false;

  let mapEl: HTMLDivElement | null = null;
  let map: L.Map | null = null;
  let mapObserver: ResizeObserver | null = null;

  // The scroll container — bound so a jump can remember where you were and the
  // article can be put back on the same line.
  let bodyEl: HTMLDivElement | null = null;
  let articleEl: HTMLDivElement | null = null;

  // Refs already tapped, dimmed so a long list shows what you've worked through.
  // Cleared on a fresh open; carried across a back-arrow round trip.
  let visitedRefs = new Set<string>();

  // Entry body with prose cross-references linked (see linkifyCrossRefs).
  let articleHtml = "";

  // Keyed on the book NAME — keying on the BookInfo object silently made every
  // lookup miss, which turned the canonical sort below into a no-op.
  const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
  const verseTextStore = new IndexedDBTextStore();

  // Load full data whenever the article target changes. Docked, that also fires
  // when a cross-reference rewrites the window's contentState.
  let loadedKey = "";
  $: {
    const key = `${kind}:${entryId}:${placeId}`;
    if (key !== loadedKey) {
      loadedKey = key;
      loadData();
    }
  }

  onDestroy(() => {
    destroyMap();
    onSnapshot?.(viewSnapshot());
  });

  /** Everything needed to put this article back exactly as it is now. */
  function viewSnapshot(): PopOutSnapshot {
    return {
      primaryName: title,
      tab: activeTab,
      expanded,
      expandedBooks: [...expandedBooks],
      visited: [...visitedRefs],
      scrollTop: bodyEl?.scrollTop ?? 0,
      trail,
    };
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
    visitedRefs = new Set();
    articleHtml = "";
    worksCheckedFor = "";
    rememberedId = null;
    destroyMap();

    if (placeId) {
      place = await getIsbePlace(placeId);
      if (place) verses = await getIsbePlaceVerses(place.placeId);
      if (place?.entryId != null) entry = await getIsbeEntry(place.entryId);
    } else if (entryId != null) {
      entry = await getIsbeEntry(entryId);
      // Opened by entry (e.g. from search). If it's a place, pull a representative
      // location so the Map and Verses tabs light up too.
      if (entry?.isPlace) {
        place = await getIsbePlaceByEntryId(entryId);
        if (place) verses = await getIsbePlaceVerses(place.placeId);
      }
    }
    if (place) placeNames = await getIsbePlaceNames(place.placeId);
    // Cross-reference linkification hits the name index, so it has to finish
    // before the article renders — otherwise the links would pop in late.
    articleHtml = entry?.bodyHtml ? await linkifyCrossRefs(entry.bodyHtml) : "";
    loading = false;

    // Reopen where we left off — same tab, same things open, same refs dimmed,
    // same scroll spot. This is what makes popping out feel like the article
    // moved rather than restarted, and it's the same path the back arrow takes.
    expanded = { ...initialExpanded };
    visitedRefs = new Set(initialVisited);
    if (initialExpandedBooks.length) expandedBooks = new Set(initialExpandedBooks);
    if (initialTab) {
      await selectTab(initialTab);
      // versesByBook is derived from `verses`, assigned moments ago — let the
      // reactive pass land before loadBookText reads it.
      await tick();
      for (const book of expandedBooks) await loadBookText(book);
      // Verse previews and expanded sections both change the content height, so
      // the offset is only meaningful once they're all on the page.
      await tick();
      applyVisitedMarks();
      if (initialScrollTop && bodyEl) bodyEl.scrollTop = initialScrollTop;
    }
  }

  $: title = place?.primaryName || entry?.primaryName || primaryName;

  // Docked, the tab and what's open live in the window's own contentState, so
  // the article comes back as you left it after a reload. Written on the user
  // action rather than from a reactive block — a reactive write would feed the
  // store update back in as a prop change and loop.
  function persistView() {
    if (!windowId) return;
    windowStore.updateContentState(windowId, {
      tab: activeTab,
      expanded,
      expandedBooks: [...expandedBooks],
      visited: [...visitedRefs],
      trail,
    });
  }

  // --- Walking the shelf -------------------------------------------------
  // The entry either side of this one alphabetically, for the footer arrows.
  // Recomputed whenever the article changes; the lookup is two index hops, so
  // it can just follow the article rather than being prefetched.
  $: {
    const key = (entry?.primaryName || "").toLowerCase();
    if (key) loadNeighbors(key);
    else neighbors = { prev: null, next: null };
  }

  async function loadNeighbors(sortKey: string) {
    const found = await getIsbeNeighbors(sortKey);
    // Guard against a slower lookup landing after you've moved on.
    if ((entry?.primaryName || "").toLowerCase() === sortKey) neighbors = found;
  }

  /** Remember what was opened, so the contents can offer it back later. */
  let rememberedId: number | null = null;

  function rememberRead() {
    const id = entry?.entryId ?? place?.entryId ?? null;
    const name = title;
    // Once per article. The reactive pass below re-runs on any invalidation,
    // and recents are a history of what you opened, not of how often Svelte
    // recomputed it.
    if (id == null || !name || id === rememberedId) return;
    rememberedId = id;
    libraryPrefsStore.markRead("isbe", { id, name, sortKey: name.toLowerCase() });
  }

  $: if (!loading && (entry || place)) rememberRead();

  /** Open an article from the contents or an arrow — a fresh start, no trail. */
  function jumpToEntry(id: number, name: string) {
    trail = [];
    showContents = false;
    openEntryTarget(id, name);
  }

  function openFromContents(row: LibraryRow) {
    jumpToEntry(Number(row.id), row.name);
  }

  /** Step back to an article you came through. */
  function popTrailTo(index: number) {
    const stop = trail[index];
    if (!stop) return;
    trail = trail.slice(0, index);
    showContents = false;
    if (windowId) {
      windowStore.updateContentState(windowId, {
        kind: stop.placeId ? "place" : "entry",
        entryId: stop.entryId,
        placeId: stop.placeId,
        primaryName: stop.name,
        tab: null,
        expanded: {},
        expandedBooks: [],
        visited: [],
        trail,
      });
    } else if (stop.placeId) {
      isbeModalStore.open({
        kind: "place",
        entryId: stop.entryId,
        placeId: stop.placeId,
        primaryName: stop.name,
      });
    } else if (stop.entryId != null) {
      isbeModalStore.openEntry(stop.entryId, stop.name);
    }
  }

  /** Which letter the contents should open on — the one you're reading. Keyed
   *  off the encyclopedia name rather than `title`, because a place-opened
   *  article titles itself with OpenBible's spelling while its contents row is
   *  filed under the entry name; going by title could open a letter that
   *  doesn't hold the row. Same reasoning as loadNeighbors above. */
  $: contentsLetter = (() => {
    const name = entry?.primaryName || title;
    return name ? libraryLetterOf(name.toLowerCase()) : null;
  })();

  /** Which row to land on and keep marked — by id, since names repeat. */
  $: contentsRowId = entry?.entryId ?? place?.entryId ?? entryId;

  // --- Back and flip -----------------------------------------------------
  // Back walks out one step at a time: a crumb off the trail, then the article,
  // then the index. Flip turns the page over between the two, either way.
  $: canGoBack = !showContents && (trail.length > 0 || !!entry || !!place);
  $: lastRead = $libraryPrefsStore.isbe.lastRead;
  $: canFlip = showContents ? !!entry || !!place || !!lastRead : true;

  function goBack() {
    if (trail.length) return popTrailTo(trail.length - 1);
    showContents = true;
  }

  /** Escape comes here before the host closes: walk out a step if there is
   *  one, and only let it close when there isn't. True means consumed. */
  export function handleBack(): boolean {
    if (!canGoBack) return false;
    goBack();
    return true;
  }

  function flip() {
    if (!showContents) {
      showContents = true;
      return;
    }
    // Nothing loaded this session — flip to whatever you last had open, which
    // is what a stale window leaves on the other side of the card.
    if (!entry && !place && lastRead) {
      jumpToEntry(Number(lastRead.id), lastRead.name);
      return;
    }
    showContents = false;
  }

  // --- Dictionary bridge -------------------------------------------------
  // --- The other three works ---------------------------------------------
  // One resolver answers all of them at once and hands back ids rather than
  // booleans, so a control that lights up is guaranteed to open something.
  // Where the encyclopedia explains what a thing is, Nave's says where
  // Scripture speaks about it; the dictionary gives the plain sense of the
  // word. A pack that isn't installed simply contributes nothing.
  let works: WorksResolution | null = null;
  let worksCheckedFor = "";

  async function checkWorks(name: string) {
    const key = name.trim().toLowerCase();
    if (worksCheckedFor === key) return;
    worksCheckedFor = key;
    works = null;
    if (!key) return;
    // Arrived here from another tab? Inherit the resolution we were opened from
    // rather than deriving a new one from the article title, which cannot tell
    // three men called Herod apart and so returns the wrong one to People.
    const inherited = carriedWorks("encyclopedia", `${placeId ?? ""}|${entryId ?? ""}`);
    if (inherited) {
      works = inherited;
      return;
    }
    try {
      const found = await resolveWorks(name);
      // Guard a slower lookup landing after you've moved on.
      if (worksCheckedFor !== key) return;
      works = found;
    } catch {
      works = null;
    }
  }

  $: if (!loading && title) checkWorks(title);

  // "HEBREWS, EPISTLE TO THE" -> "hebrews" — the dictionary files single words,
  // and resolveWorks hands back the term it actually used so opening matches.

  /**
   * The work tabs. Docked, this swaps what the window is showing and the window
   * stays put; otherwise it opens that work's card. Over the index there is no
   * subject to carry across, so the sibling opens on its own contents instead.
   */
  function selectWork(work: WorkKey) {
    const opened = showContents
      ? openWorkIndex(work, windowId)
      : openWorkSubject(work, works, title, windowId);
    // Nothing there — leave what's on screen alone rather than closing onto it.
    if (!opened) return;
    // Nothing closes: a window changed in place, and the card keeps the same
    // frame with a different work inside it. That is what makes these tabs.
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
      persistView();
      return;
    }
    next.add(book);
    expandedBooks = next;
    persistView();
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

  // Stored verse text carries markup the reader's renderer handles and a
  // preview row must not show raw — BSB footnotes, KJV pilcrows, NET <b>.
  function versePreview(text: string): string {
    return renderVersePreviewHtml(text, { highlight: highlightRe, maxLength: 150 });
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
    await tick();
    // Each tab is its own view, so it starts at the top. Carrying the last
    // tab's offset across leaves the short tabs part-scrolled off the top —
    // Map most of all, since it is barely taller than the map itself. That is
    // what made its corner button come back clipped, or seem to vanish, by an
    // amount that depended on how far down the previous tab you happened to be.
    if (bodyEl) bodyEl.scrollTop = 0;
    persistView();
    if (t === "map" && hasMap) renderMap();
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
    // Leaflet never watches its own container, and docked that container resizes
    // every time the window's handle is dragged. The observer also fires once on
    // observe, which covers the initial "container just became visible" pass.
    mapObserver?.disconnect();
    mapObserver = new ResizeObserver(() => map?.invalidateSize());
    mapObserver.observe(mapEl);
  }

  function destroyMap() {
    mapObserver?.disconnect();
    mapObserver = null;
    if (map) {
      map.remove();
      map = null;
    }
  }

  /** Returns the back-stack depth this jump occupies, for the return crumb. */
  function navigateToVerse(book: string, chapter: number, verse: number): number {
    const current = get(navigationStore);
    const depth = navigationStore.pushHistory(current, 'library');
    navigationStore.navigateToVerse(current.translation, book, chapter, verse);
    // A docked article stays open across the jump — reading the passage beside
    // the article is the whole point of pinning it.
    if (!docked) close();
    return depth;
  }

  // Everything the back arrow needs to put the modal back the way it was.
  // Captured before navigating, because close() wipes the store state.
  function crumb(tab: Tab): Omit<IsbeReturn, "depth"> {
    return {
      modal: { kind, entryId, placeId, primaryName, tab },
      expandedBooks: [...expandedBooks],
      expandedSections: { ...expanded },
      visited: [...visitedRefs],
      scrollTop: bodyEl?.scrollTop ?? 0,
    };
  }

  // Jumping from the Verses tab leaves a breadcrumb so the nav back arrow can
  // bring this modal back, on the same tab with the same books open and the
  // same scroll spot — you can work down a long verse list one passage at a time.
  function navigateFromVerseList(book: string, chapter: number, verse: number) {
    visitedRefs = new Set(visitedRefs).add(`${book} ${chapter}:${verse}`);
    persistView();
    // Docked there is nothing to come back to: the crumb only exists because the
    // modal closes behind you, and a stale one would reopen it uninvited.
    if (docked) {
      navigateToVerse(book, chapter, verse);
      return;
    }
    const here = crumb("verses");
    const depth = navigateToVerse(book, chapter, verse);
    isbeReturnStore.set({ ...here, depth });
  }

  // A cross-reference to another article replaces what's on screen. Docked that
  // means rewriting the window's own contentState, which flows back in as props.
  function openEntryTarget(id: number, name: string) {
    if (windowId) {
      windowStore.updateContentState(windowId, {
        kind: "entry",
        entryId: id,
        placeId: null,
        primaryName: name,
        tab: null,
        expanded: {},
        expandedBooks: [],
        visited: [],
        trail,
      });
    } else {
      isbeModalStore.openEntry(id, name);
    }
  }

  /** Follow a cross-reference, leaving the current article on the trail so the
   *  way back out is one tap per step rather than a fresh search. */
  function followCrossRef(id: number, name: string) {
    if (entry || place) {
      trail = [
        ...trail,
        { entryId: entry?.entryId ?? null, placeId: place?.placeId ?? null, name: title },
      ];
    }
    openEntryTarget(id, name);
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
      if (!book) return;
      visitedRefs = new Set(visitedRefs).add(`osis:${osis}`);
      a.classList.add("visited");
      persistView();
      if (docked) {
        navigateToVerse(book, parseInt(ch, 10), parseInt(vs, 10) || 1);
        return;
      }
      // Article scripture links get the same round trip as the verse list.
      const here = crumb("article");
      const depth = navigateToVerse(book, parseInt(ch, 10), parseInt(vs, 10) || 1);
      isbeReturnStore.set({ ...here, depth });
      return;
    }
    const target = a.getAttribute("data-entry");
    if (target) {
      const next = await getIsbeEntryByName(target);
      if (next) followCrossRef(next.entryId, next.primaryName);
    }
  }

  // The article is injected with {@html}, so its links can't carry a Svelte
  // class — they're marked directly instead, and remarked after any re-render.
  function applyVisitedMarks() {
    if (!articleEl) return;
    articleEl.querySelectorAll<HTMLAnchorElement>("a[data-osis]").forEach((a) => {
      a.classList.toggle("visited", visitedRefs.has(`osis:${a.getAttribute("data-osis")}`));
    });
  }

  // Opening a section brings fresh link elements onto the page, which need the
  // marks applied again — they only live in the DOM.
  $: if (activeTab === "article") {
    void expanded;
    void articleHtml;
    tick().then(applyVisitedMarks);
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

  // --- Cross-reference linkification -------------------------------------
  // The pack only links cross-references the source tagged as <ref target>;
  // most are written as bare prose — "(see KIDRON)", "compare GEOLOGY OF
  // PALESTINE". They're reliably ALL CAPS, but caps alone is far too loose: an
  // article's own contents block is caps too, and NAME, CITY, GATE and WATER
  // are all real entries, so every heading would turn into a link. Only caps
  // introduced by "see" / "compare" / "cf." are treated as references.

  // Runs of two or more caps letters, joined into a phrase across single spaces
  // ("GEOLOGY OF PALESTINE") and inner hyphens/apostrophes ("BETH-SHEMESH").
  const CAPS = "[A-Z]{2,}(?:['’-][A-Z]{2,})*(?: [A-Z]{2,}(?:['’-][A-Z]{2,})*)*";
  const CAPS_RE = new RegExp(CAPS, "g");
  // Case-folded by hand rather than with the i flag, which would defeat CAPS.
  const INTRO = "(?:[Ss][Ee][Ee](?:\\s+[Aa][Ll][Ss][Oo])?|[Cc][Oo][Mm][Pp][Aa][Rr][Ee]|[Cc][Ff]\\.)";
  const XREF_RE = new RegExp(`${INTRO}\\s+(${CAPS}(?:\\s*[,;]\\s*${CAPS})*)`, "g");

  // Never a cross-reference, even after "see": the scholarly abbreviations ISBE
  // leans on, and the roman numerals of a "see JERUSALEM, II, 5" style pointer.
  const CAPS_SKIP = new Set(
    ("AV RV RVM AVM ERV ARV ARVM KJV EV EVV LXX MT NT OT HEB GR ARAM SYR VULG TR"
      + " WH HDB EB DB DCG ICC EGT SBOT PRE RE CE BC AD ETC IE EG CF FF THE AND OF"
    ).split(" "),
  );

  function isCapsCandidate(s: string): boolean {
    return !CAPS_SKIP.has(s) && !/^[IVXLCDM]+$/.test(s);
  }

  async function linkifyCrossRefs(rawHtml: string): Promise<string> {
    // Only text outside a tag and outside an existing <a> is eligible — the
    // pack's own links and every attribute value must be left alone.
    const parts: { text: string; eligible: boolean }[] = [];
    let aDepth = 0;
    let last = 0;
    const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    for (const m of rawHtml.matchAll(TAG_RE)) {
      parts.push({ text: rawHtml.slice(last, m.index), eligible: aDepth === 0 });
      parts.push({ text: m[0], eligible: false });
      if (m[1].toLowerCase() === "a") aDepth = m[0][1] === "/" ? Math.max(0, aDepth - 1) : aDepth + 1;
      last = m.index + m[0].length;
    }
    parts.push({ text: rawHtml.slice(last), eligible: aDepth === 0 });

    // A pointer may name several articles at once ("see ARABAH; DEAD SEA"), so
    // each run in the list is a candidate — but only whole. Falling back to the
    // individual words of a run that isn't an article sends you somewhere the
    // text never pointed: "DEAD SEA" is no entry, and DEAD alone is one.
    const candidates = new Set<string>();
    for (const p of parts) {
      if (!p.eligible) continue;
      for (const m of p.text.matchAll(XREF_RE)) {
        for (const run of m[1].match(CAPS_RE) ?? []) {
          if (isCapsCandidate(run)) candidates.add(run);
        }
      }
    }
    if (!candidates.size) return rawHtml;

    const real = await resolveIsbeEntryNames([...candidates]);
    // An article never links to itself.
    const own = (entry?.primaryName || primaryName || "").toUpperCase();
    for (const name of real.keys()) if (own.includes(name)) real.delete(name);
    if (!real.size) return rawHtml;

    // The link carries the name that actually resolved — "PSALMS" reads as
    // written but points at "psalms, book of".
    const link = (run: string) =>
      `<a class="isbe-link" data-entry="${real.get(run)}">${run}</a>`;
    return parts
      .map((p) =>
        p.eligible
          ? p.text.replace(XREF_RE, (whole, list: string) => {
              const linked = list.replace(CAPS_RE, (run) => (real.has(run) ? link(run) : run));
              // The list is the tail of the match; the introducer stays as written.
              return whole.slice(0, whole.length - list.length) + linked;
            })
          : p.text,
      )
      .join("");
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

  // Built from articleHtml — the body with prose cross-references linked —
  // rather than the raw entry, so both render paths get them.
  $: article = articleHtml ? buildArticle(articleHtml) : null;
  // Short articles skip the accordion and render straight through, but their
  // scripture links still need tinting.
  $: flatHtml = articleHtml ? colorScriptureLinks(articleHtml) : "";

  // Which sections are open, keyed "0" for a top section and "0.2" for a child.
  let expanded: Record<string, boolean> = {};
  function toggleSection(key: string) {
    expanded = { ...expanded, [key]: !expanded[key] };
    persistView();
  }

  $: sectionCount = article
    ? article.sections.reduce((n, s) => n + 1 + s.children.length, 0)
    : 0;
  $: allExpanded =
    sectionCount > 0 && Object.values(expanded).filter(Boolean).length >= sectionCount;

  function toggleAll() {
    if (allExpanded) {
      expanded = {};
      persistView();
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
    persistView();
  }

  function close() {
    destroyMap();
    onClose?.();
  }

  function popOut() {
    onPopOut?.(viewSnapshot());
  }

  /**
   * Hand this place to the map window.
   *
   * Not the same move as popOut above: that scoots this article into a docked
   * window unchanged, whereas this swaps surfaces entirely. The map tab here is
   * one marker and nothing else; the map window has the layer control, the
   * historical overlays and the place search, which is the whole reason to go
   * there. So the article does not travel — the place does.
   *
   * The centre card gets out of the way once the map has somewhere to appear.
   * A docked article stays where the reader put it, and the map opens alongside.
   */
  function openInMapWindow() {
    if (!place || place.latitude == null || place.longitude == null) return;
    const name = place.primaryName || title;
    const opened = openMapWindow(name, [
      {
        name,
        latitude: place.latitude,
        longitude: place.longitude,
        modernName: place.modernName,
        placeType: place.type,
      },
    ]);
    // Turned down at the six-window cap. Leave the card up rather than closing
    // it onto nothing.
    if (opened && !docked) close();
  }
</script>

<div class="isbe-content" class:docked>
  <WorkTabs {works} current="encyclopedia" onIndex={showContents} inWindow={docked} onSelect={selectWork} />
  <div class="isbe-header">
    <LibraryNavButtons {canGoBack} {canFlip} onIndex={showContents} onBack={goBack} onFlip={flip} />
    <div class="head-text">
      <h2>{showContents ? isbeSource.label : title}</h2>
      {#if showContents}
        <div class="sub">{isbeSource.subtitle}</div>
      {:else if !loading}
        <div class="sub">{subtitle()}</div>
      {/if}
    </div>
    <div class="head-actions">
      {#if onPopOut}
        <button
          class="pop-btn"
          on:click={popOut}
          title="Pin beside the reader"
          aria-label="Pin beside the reader"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.8" />
            <path d="M14 4v16" stroke-width="1.8" />
            <path d="M6.2 9.6L8.6 12l-2.4 2.4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
      {#if onClose}
        <button class="close-btn" on:click={close} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M18 6L6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  {#if showContents}
    <IndexList
      source={isbeSource}
      onOpen={openFromContents}
      initialLetter={contentsLetter}
      initialRowId={contentsRowId}
    />
  {:else}
    {#if trail.length}
      <nav class="trail" aria-label="Back trail">
        {#each trail as stop, i}
          <button class="crumb" on:click={() => popTrailTo(i)}>{stop.name}</button>
          <span class="crumb-sep">›</span>
        {/each}
        <span class="crumb here">{title}</span>
      </nav>
    {/if}

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

  <div class="isbe-body" bind:this={bodyEl}>
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
      <div class="article" bind:this={articleEl} on:click={onArticleClick} role="presentation">
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
                    class:visited={visitedRefs.has(key)}
                    style="border-left-color:{group.color}"
                    on:click={() => navigateFromVerseList(group.book, r.chapter, r.verse)}
                  >
                    <span class="vb-ref-label" style="color:{group.color}">
                      {group.book} {r.chapter}:{r.verse}
                    </span>
                    {#if versePreviews[key]}
                      <span class="vb-ref-text">{@html versePreview(versePreviews[key])}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else if activeTab === "map" && hasMap}
      <div class="map-tab">
        <div class="map" bind:this={mapEl}></div>
        <button
          class="map-pop"
          on:click={openInMapWindow}
          title="Open in the map window"
          aria-label="Open in the map window"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.8" />
            <path d="M14 4v16" stroke-width="1.8" />
            <path d="M6.2 9.6L8.6 12l-2.4 2.4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        {#if place}
          <div class="map-meta">
            {place.latitude?.toFixed(5)}, {place.longitude?.toFixed(5)}
            {#if place.modernName}· near {place.modernName}{/if}
          </div>
        {/if}
      </div>
    {/if}
    </div>
  {/if}

  <div class="isbe-footer">
    {#if !showContents && (neighbors.prev || neighbors.next)}
      <!-- The page-turn. Deliberately quiet: it's for drifting one entry over,
           not a main way around. -->
      <div class="turn">
        {#if neighbors.prev}
          {@const prev = neighbors.prev}
          <button class="turn-btn" on:click={() => jumpToEntry(prev.id, prev.name)} title="Previous entry">
            ← <span class="turn-name">{prev.name}</span>
          </button>
        {:else}
          <span></span>
        {/if}
        {#if neighbors.next}
          {@const next = neighbors.next}
          <button class="turn-btn next" on:click={() => jumpToEntry(next.id, next.name)} title="Next entry">
            <span class="turn-name">{next.name}</span> →
          </button>
        {/if}
      </div>
    {/if}
    <span class="src">International Standard Bible Encyclopedia (1915, public domain) · place data © OpenBible.info CC BY 4.0</span>
  </div>
</div>

<style>
  /* flex:1 fills the modal card (a flex column); height:100% fills a docked
     window's panel-content (which isn't one). Both are set so the same
     component fills either host. */
  .isbe-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
  }
  .isbe-content.docked {
    height: 100%;
  }
  .isbe-header {
    display: flex;
    /* Wraps so that a pane too narrow to hold the controls and a readable title
       side by side drops the title onto its own line, rather than crushing it
       into a column of single letters. */
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  /* Takes the slack between the nav buttons and the actions, and is allowed to
     shrink — a long article title must not push the close button off a narrow
     docked window. */
  /* A basis rather than 0, so the header wraps before the title is squeezed
     narrower than this. It still shrinks below it once wrapped. */
  .head-text {
    flex: 1 1 180px;
    min-width: 0;
  }
  .head-text h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.15;
    /* break-word, not anywhere: only split a word that genuinely cannot fit.
       The longest single word in the encyclopedia is "Anthropomorphism" at 16
       characters, so in practice titles now wrap between words and read left to
       right. `anywhere` used to break mid-word the moment the column got tight,
       which is what stacked long names one letter per line. */
    overflow-wrap: break-word;
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
  .pop-btn {
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
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
  }
  .isbe-body {
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
  /* Already followed — lightened rather than recolored, so the book color a
     scripture link carries still reads. Resets when the article is reopened. */
  .article :global(a.visited) {
    opacity: 0.5;
  }
  .vb-ref.visited .vb-ref-label,
  .vb-ref.visited .vb-ref-text {
    opacity: 0.5;
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
  /* Fixed height in the modal card, which sizes to its content. Docked, the
     window is resizable and the map should take whatever height is going. */
  .map-tab {
    display: flex;
    flex-direction: column;
    position: relative;
  }
  /* Over the tiles, top right. Leaflet's own zoom control sits top left, so the
     two don't collide, and z-index clears Leaflet's control panes at 800. */
  .map-pop {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px;
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    background: var(--background-color, #1e1e1e);
    color: var(--text-muted, #999);
    cursor: pointer;
  }
  .map-pop:hover {
    color: var(--color-primary, #4a90e2);
  }
  .docked .map-tab {
    height: 100%;
  }
  .map {
    width: 100%;
    height: 360px;
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
  }
  .docked .map {
    flex: 1;
    height: auto;
    min-height: 200px;
  }
  .map-meta {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted, #999);
    flex-shrink: 0;
  }
  .isbe-footer {
    padding: 8px 18px 12px;
    border-top: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .src {
    font-size: 10px;
    color: var(--text-muted, #888);
  }

  /* Back trail — one row, scrolling sideways rather than wrapping, so following
     cross-references deep never pushes the article itself down the page. */
  .trail {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 18px 0;
    overflow-x: auto;
    white-space: nowrap;
    flex-shrink: 0;
    scrollbar-width: none;
  }
  .trail::-webkit-scrollbar {
    display: none;
  }
  .crumb {
    background: none;
    border: none;
    color: var(--color-primary, #4a90e2);
    font-family: inherit;
    font-size: 11px;
    padding: 0;
    cursor: pointer;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crumb.here {
    color: var(--text-muted, #999);
    cursor: default;
  }
  .crumb-sep {
    color: var(--text-muted, #666);
    font-size: 11px;
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
</style>
