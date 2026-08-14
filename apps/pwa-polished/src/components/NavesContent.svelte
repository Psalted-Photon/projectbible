<script lang="ts">
  import { get } from "svelte/store";
  import { getBookColor, BIBLE_BOOKS, normalizeBookName } from "../lib/bibleData.js";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { renderVersePreviewHtml } from "../lib/verseRendering";
  import { parseOsisRef } from "../lib/parseRefString";
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { navesModalStore } from "../stores/navesModalStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { personModalStore } from "../stores/personModalStore";
  import { libraryPrefsStore } from "../stores/libraryPrefsStore";
  import IndexList from "./library/IndexList.svelte";
  import LibraryNavButtons from "./library/LibraryNavButtons.svelte";
  import WorkTabs, { type WorkKey } from "./WorkTabs.svelte";
  import { navesSource } from "../lib/library/source";
  import {
    getNavesTopic,
    getNavesVerses,
    getNavesNeighbors,
    getNavesTopicName,
    resolveWorks,
    libraryLetterOf,
    type NavesTopicRecord,
    type NavesPoint,
    type NavesLink,
    type WorksResolution,
    type VerseRef,
    type LibraryRow,
  } from "../adapters/lexicon-lookup.js";

  /**
   * A Nave's topic — the outline of where Scripture speaks about something,
   * and the verses it cites. Same two hosts as the encyclopedia article:
   * a centered card, and a docked window pinned beside the reader.
   */
  export let topicId: number | null = null;
  export let primaryName = "";

  export let initialTab: "outline" | "verses" | null = null;
  export let initialExpanded: Record<string, boolean> = {};
  export let initialExpandedBooks: string[] = [];
  export let initialScrollTop = 0;
  export let initialTrail: TrailStop[] = [];

  export let windowId: string | null = null;
  export let onClose: (() => void) | null = null;
  export let onPopOut: ((snap: PopOutSnapshot) => void) | null = null;

  type Tab = "outline" | "verses";
  type TrailStop = { topicId: number; name: string };
  type PopOutSnapshot = {
    topicId: number;
    primaryName: string;
    tab: Tab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    scrollTop: number;
    trail: TrailStop[];
  };

  $: docked = !!windowId;

  let topic: NavesTopicRecord | null = null;
  let verses: VerseRef[] = [];
  let loading = false;
  let activeTab: Tab = "outline";
  let expanded: Record<string, boolean> = {};
  let bodyEl: HTMLDivElement | null = null;

  let showContents = topicId == null;
  let trail: TrailStop[] = [...initialTrail];

  const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
  const verseTextStore = new IndexedDBTextStore();

  // Reload whenever the target changes. Docked, that also fires when following
  // a cross-reference rewrites the window's contentState.
  let loadedKey = "";
  $: {
    const key = String(topicId);
    if (key !== loadedKey) {
      loadedKey = key;
      loadTopic();
    }
  }

  async function loadTopic() {
    topic = null;
    verses = [];
    expanded = {};
    expandedBooks = new Set();
    versePreviews = {};
    if (topicId == null) return;

    loading = true;
    const id = topicId;
    const [record, refs] = await Promise.all([getNavesTopic(id), getNavesVerses(id)]);
    // Guard a slower load landing after you've moved on.
    if (topicId !== id) return;
    topic = record;
    verses = refs;
    loading = false;

    // Reopen where we left off — same tab, same points open, same scroll spot.
    expanded = { ...initialExpanded };
    if (initialExpandedBooks.length) expandedBooks = new Set(initialExpandedBooks);
    if (initialTab) {
      activeTab = initialTab;
      for (const book of expandedBooks) await loadBookText(book);
      if (initialScrollTop && bodyEl) bodyEl.scrollTop = initialScrollTop;
    }
  }

  $: title = topic?.primaryName || primaryName;
  $: hasVerses = verses.length > 0;

  function persistView() {
    if (!windowId) return;
    windowStore.updateContentState(windowId, {
      tab: activeTab,
      expanded,
      expandedBooks: [...expandedBooks],
      trail,
    });
  }

  // --- Outline -----------------------------------------------------------
  // The points come back flat, each carrying its own depth. A top-level point
  // owns the sub-points that follow it, which is how Nave's reads on paper: a
  // line with no references of its own is a heading for the lines beneath it.
  type Section = { point: NavesPoint; children: NavesPoint[] };

  $: sections = (() => {
    const out: Section[] = [];
    for (const p of topic?.points ?? []) {
      if (p.depth === 0 || !out.length) out.push({ point: p, children: [] });
      else out[out.length - 1].children.push(p);
    }
    return out;
  })();

  $: allExpanded = sections.length > 0 && sections.every((s, i) => !s.children.length || expanded[`${i}`]);

  function toggleSection(key: string) {
    expanded = { ...expanded, [key]: !expanded[key] };
    persistView();
  }

  function toggleAll() {
    if (allExpanded) {
      expanded = {};
    } else {
      const next: Record<string, boolean> = {};
      sections.forEach((s, i) => {
        if (s.children.length) next[`${i}`] = true;
      });
      expanded = next;
    }
    persistView();
  }

  async function selectTab(t: Tab) {
    activeTab = t;
    persistView();
  }

  // --- Verses tab --------------------------------------------------------
  let expandedBooks = new Set<string>();
  let versePreviews: Record<string, string> = {};

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

  // Books start collapsed, so a topic like Prayer never pays for all 1,170
  // verses at once.
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

  // --- Navigation --------------------------------------------------------
  function navigateToVerse(book: string, chapter: number, verse: number) {
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    navigationStore.navigateToVerse(current.translation, book, chapter, verse);
    // A pinned topic stays open across the jump — reading the passage beside
    // the outline is the whole point of pinning it.
    if (!docked) onClose?.();
  }

  /** A scripture chip. Ranges land on their first verse. */
  function openRef(osis: string) {
    const target = parseOsisRef(osis);
    if (!target) return;
    navigateToVerse(target.book, target.chapter, target.verse ?? 1);
  }

  /**
   * The colour of the book a chip points at — the same palette the Verses tab
   * and the nav bar's reference dropdown use. A ref we can't read falls through
   * to getBookColor's own neutral grey.
   */
  function refColor(osis: string): string {
    return getBookColor(parseOsisRef(osis)?.book ?? "");
  }

  function openTopic(id: number, name: string) {
    showContents = false;
    if (windowId) {
      windowStore.updateContentState(windowId, {
        topicId: id,
        primaryName: name,
        tab: null,
        expanded: {},
        expandedBooks: [],
        trail,
      });
    } else {
      navesModalStore.open({ topicId: id, primaryName: name });
    }
  }

  /** Follow a "See OTHER TOPIC" link, leaving this one on the trail. */
  async function followLink(link: NavesLink) {
    if (link.topicId == null) return;
    if (topic) trail = [...trail, { topicId: topic.topicId, name: title }];
    const display = (await getNavesTopicName(link.topicId)) ?? link.name;
    openTopic(link.topicId, display);
  }

  /** Open from the contents or an arrow — a fresh start, no trail. */
  function jumpToTopic(id: number, name: string) {
    trail = [];
    openTopic(id, name);
  }

  function openFromContents(row: LibraryRow) {
    jumpToTopic(Number(row.id), row.name);
  }

  function popTrailTo(index: number) {
    const stop = trail[index];
    if (!stop) return;
    trail = trail.slice(0, index);
    openTopic(stop.topicId, stop.name);
  }

  // --- Page turns --------------------------------------------------------
  let neighbors: { prev: LibraryRow | null; next: LibraryRow | null } = { prev: null, next: null };

  $: {
    const key = (topic?.primaryName || "").toLowerCase();
    if (key) loadNeighbors(key);
    else neighbors = { prev: null, next: null };
  }

  async function loadNeighbors(sortKey: string) {
    const found = await getNavesNeighbors(sortKey);
    if ((topic?.primaryName || "").toLowerCase() === sortKey) neighbors = found;
  }

  $: contentsLetter = title ? libraryLetterOf(title.toLowerCase()) : null;

  /** Which row to land on and keep marked — by id, since names can repeat. */
  $: contentsRowId = topic?.topicId ?? topicId;

  // --- Back and flip -----------------------------------------------------
  // Back walks out one step at a time: a crumb off the trail, then the topic,
  // then the index. Flip turns the page over between the two, either way.
  $: canGoBack = !showContents && (trail.length > 0 || !!topic);
  $: lastRead = $libraryPrefsStore.naves.lastRead;
  $: canFlip = showContents ? !!topic || !!lastRead : true;

  function goBack() {
    if (trail.length) return popTrailTo(trail.length - 1);
    showContents = true;
  }

  /** Escape comes here before the host closes — see IsbeContent.handleBack. */
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
    // Nothing loaded this session — flip to whatever you last had open.
    if (!topic && lastRead) {
      jumpToTopic(Number(lastRead.id), lastRead.name);
      return;
    }
    showContents = false;
  }

  // --- Recents -----------------------------------------------------------
  let rememberedId: number | null = null;
  $: if (topic && topic.topicId !== rememberedId) {
    rememberedId = topic.topicId;
    libraryPrefsStore.markRead("naves", {
      id: topic.topicId,
      name: title,
      sortKey: title.toLowerCase(),
    });
  }

  // --- The other three works ---------------------------------------------
  // One resolver answers all of them at once and hands back ids rather than
  // booleans, so a control that lights up is guaranteed to open something.
  let works: WorksResolution | null = null;
  let worksCheckedFor = "";

  $: if (topic) checkWorks(topic.primaryName);

  async function checkWorks(name: string) {
    const key = name.trim().toLowerCase();
    if (worksCheckedFor === key) return;
    worksCheckedFor = key;
    works = null;
    if (!key) return;
    try {
      const found = await resolveWorks(name);
      // Guard a slower lookup landing after you've moved on.
      if (worksCheckedFor !== key) return;
      works = found;
    } catch {
      works = null;
    }
  }

  // The dictionary files single words, so a topic titled "Abomination, Birds
  // Of" is looked up on its first word — resolveWorks hands back the term it
  // actually used so opening matches what lit the control up.
  $: dictWord = works?.dict ? (works.term ?? "") : "";
  $: isbeMatch = works?.entry ?? null;

  function openEncyclopedia() {
    if (!isbeMatch) return;
    const m = isbeMatch;
    // Docked, the topic stays put and the article opens beside it.
    if (!docked) onClose?.();
    isbeModalStore.open({
      kind: m.kind,
      entryId: m.entryId,
      placeId: m.placeId ?? null,
      primaryName: m.primaryName,
    });
  }

  function openDictionary() {
    const term = dictWord;
    if (!term) return;
    if (!docked) onClose?.();
    lexicalModalStore.open({
      selectedText: term,
      strongsId: undefined,
      morphologyData: null,
      lexicalEntries: null,
    });
  }

  function openPeople() {
    const found = works?.person;
    if (!found) return;
    if (!docked) onClose?.();
    personModalStore.open({
      lookup: found,
      primaryName: found.person.displayTitle || found.person.name,
      clickedWord: title,
    });
  }

  /**
   * The work tabs. Over the index these move you between indexes rather than
   * between views of a subject, since there is no subject.
   */
  function selectWork(work: WorkKey) {
    if (showContents) {
      if (!docked) onClose?.();
      if (work === "encyclopedia") isbeModalStore.open({ kind: "entry", entryId: null, placeId: null, primaryName: "" });
      else if (work === "people") personModalStore.open({});
      return;
    }
    if (work === "dictionary") openDictionary();
    else if (work === "encyclopedia") openEncyclopedia();
    else if (work === "people") openPeople();
  }

  function popOut() {
    if (!topic) return;
    onPopOut?.({
      topicId: topic.topicId,
      primaryName: title,
      tab: activeTab,
      expanded,
      expandedBooks: [...expandedBooks],
      scrollTop: bodyEl?.scrollTop ?? 0,
      trail,
    });
  }
</script>

<div class="naves-content" class:docked>
  <WorkTabs {works} current="topical" onIndex={showContents} onSelect={selectWork} />
  <div class="naves-header">
    <LibraryNavButtons {canGoBack} {canFlip} onIndex={showContents} onBack={goBack} onFlip={flip} />
    <div class="head-text">
      <h2>{showContents ? navesSource.label : title}</h2>
      <div class="sub">
        {#if showContents}
          {navesSource.subtitle}
        {:else if topic}
          {topic.pointCount} point{topic.pointCount === 1 ? "" : "s"}
          {#if topic.refCount}· {topic.refCount} reference{topic.refCount === 1 ? "" : "s"}{/if}
        {/if}
      </div>
    </div>
    <div class="head-actions">
      {#if !showContents && topic}
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

  {#if showContents}
    <IndexList
      source={navesSource}
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
      <button class:active={activeTab === "outline"} on:click={() => selectTab("outline")}>Outline</button>
      {#if hasVerses}
        <button class:active={activeTab === "verses"} on:click={() => selectTab("verses")}>Verses</button>
      {/if}
    </div>

    <div class="naves-body" bind:this={bodyEl}>
      {#if loading}
        <div class="muted">Loading…</div>
      {:else if !topic}
        <div class="muted">No topic here. Install the Encyclotopical pack to read Nave's.</div>
      {:else if activeTab === "outline"}
        {#if sections.some((s) => s.children.length)}
          <button class="expand-all" on:click={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        {/if}
        {#each sections as section, i}
          <div class="sec">
            {#if section.children.length}
              <button class="sec-head" class:open={expanded[`${i}`]} on:click={() => toggleSection(`${i}`)}>
                <svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span class="sec-title">{section.point.text}</span>
                <span class="sec-count">({section.children.length})</span>
              </button>
              {#if section.point.refs.length || section.point.links.length}
                <div class="chips indent">
                  {#each section.point.refs as r}
                    <button class="ref-chip" style="color:{refColor(r.osis)}" on:click={() => openRef(r.osis)}>{r.label}</button>
                  {/each}
                  {#each section.point.links as l}
                    {#if l.topicId != null}
                      <button class="link-chip" on:click={() => followLink(l)}>{l.name}</button>
                    {:else}
                      <span class="link-dead" title="Nave's names this topic but the module has no entry for it">{l.name}</span>
                    {/if}
                  {/each}
                </div>
              {/if}
              {#if expanded[`${i}`]}
                <div class="sec-body">
                  {#each section.children as child}
                    <div class="point">
                      {#if child.text}<div class="point-text">{child.text}</div>{/if}
                      {#if child.refs.length || child.links.length}
                        <div class="chips">
                          {#each child.refs as r}
                            <button class="ref-chip" style="color:{refColor(r.osis)}" on:click={() => openRef(r.osis)}>{r.label}</button>
                          {/each}
                          {#each child.links as l}
                            {#if l.topicId != null}
                              <button class="link-chip" on:click={() => followLink(l)}>{l.name}</button>
                            {:else}
                              <span class="link-dead">{l.name}</span>
                            {/if}
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              <!-- A point with nothing under it is just a line, so it isn't
                   dressed up as a collapsible heading. -->
              <div class="point top">
                {#if section.point.text}<div class="point-text">{section.point.text}</div>{/if}
                {#if section.point.refs.length || section.point.links.length}
                  <div class="chips">
                    {#each section.point.refs as r}
                      <button class="ref-chip" style="color:{refColor(r.osis)}" on:click={() => openRef(r.osis)}>{r.label}</button>
                    {/each}
                    {#each section.point.links as l}
                      {#if l.topicId != null}
                        <button class="link-chip" on:click={() => followLink(l)}>{l.name}</button>
                      {:else}
                        <span class="link-dead">{l.name}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
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
                      on:click={() => navigateToVerse(group.book, r.chapter, r.verse)}
                    >
                      <span class="vb-ref-label" style="color:{group.color}">
                        {group.book} {r.chapter}:{r.verse}
                      </span>
                      {#if versePreviews[key]}
                        <span class="vb-ref-text">{@html renderVersePreviewHtml(versePreviews[key], { maxLength: 150 })}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="naves-footer">
      {#if neighbors.prev || neighbors.next}
        <div class="turn">
          {#if neighbors.prev}
            {@const prev = neighbors.prev}
            <button class="turn-btn" on:click={() => jumpToTopic(Number(prev.id), prev.name)} title="Previous topic">
              ← <span class="turn-name">{prev.name}</span>
            </button>
          {:else}
            <span></span>
          {/if}
          {#if neighbors.next}
            {@const next = neighbors.next}
            <button class="turn-btn next" on:click={() => jumpToTopic(Number(next.id), next.name)} title="Next topic">
              <span class="turn-name">{next.name}</span> →
            </button>
          {/if}
        </div>
      {/if}
      <span class="src">Nave's Topical Bible (Orville J. Nave, public domain)</span>
    </div>
  {/if}
</div>

<style>
  /* flex:1 fills the modal card (a flex column); height:100% fills a docked
     window's panel-content. Both are set so the same component fills either. */
  .naves-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
  }
  .naves-content.docked {
    height: 100%;
  }

  .naves-header {
    display: flex;
    /* Wraps so a narrow pane drops the title onto its own line rather than
       crushing it into a column of single letters — see IsbeContent. */
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 10px;
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .head-text {
    flex: 1 1 180px;
    min-width: 0;
  }
  .head-text h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.15;
    /* Only split a word that genuinely cannot fit; `anywhere` broke mid-word as
       soon as the column got tight, stacking long names one letter per line. */
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

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--border-color, #333);
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
    font-family: inherit;
  }
  .tabs button.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
  }

  .naves-body {
    padding: 12px 18px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .muted {
    color: var(--text-muted, #999);
  }

  .expand-all {
    background: none;
    border: none;
    color: var(--color-primary, #4a90e2);
    font-family: inherit;
    font-size: 12px;
    padding: 0 0 8px;
    cursor: pointer;
  }

  .sec {
    margin-bottom: 2px;
  }
  .sec-head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--text-color, #fff);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    text-align: left;
    padding: 9px 2px;
    cursor: pointer;
  }
  .sec-head:hover {
    color: var(--color-primary, #4a90e2);
  }
  .sec-title {
    flex: 1;
    min-width: 0;
  }
  .sec-count {
    color: var(--text-muted, #999);
    font-size: 11px;
    font-weight: 400;
    flex-shrink: 0;
  }
  .caret {
    flex-shrink: 0;
    color: var(--color-primary, #4a90e2);
    transition: transform 0.15s;
  }
  .sec-head.open .caret {
    transform: rotate(90deg);
  }
  .sec-body {
    padding: 2px 0 8px 18px;
  }

  .point {
    padding: 5px 0;
  }
  .point.top {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding: 9px 2px;
  }
  .point-text {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-color, #e8e8e8);
  }

  /* Reference chips wrap under their line rather than stretching it, so a
     point citing thirty verses stays one readable sentence. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .chips.indent {
    padding-left: 17px;
    margin-bottom: 4px;
  }
  .ref-chip,
  .link-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    /* Scripture chips carry an inline colour for the book they point at, the
       same way the Verses tab colours its rows. This is only the fallback for a
       ref whose book we couldn't read, and matches getBookColor's own. */
    color: #8a8f98;
    font-family: inherit;
    font-size: 11.5px;
    padding: 2px 7px;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Follows whichever book colour the chip is wearing. */
  .ref-chip:hover {
    background: rgba(255, 255, 255, 0.1);
    background: color-mix(in srgb, currentColor 15%, transparent);
    border-color: currentColor;
  }
  .link-chip {
    color: var(--color-primary, #4a90e2);
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
    cursor: pointer;
    padding: 7px 4px;
    text-align: left;
  }
  .vb-header:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .vb-caret {
    font-size: 10px;
  }
  .vb-name {
    flex: 1;
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
    border-left: 3px solid #8bc34a;
    border-radius: 5px;
    cursor: pointer;
    padding: 6px 9px;
    font-family: inherit;
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
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #c2c6cd;
    font-size: 12.5px;
    line-height: 1.4;
  }

  .naves-footer {
    padding: 8px 18px 12px;
    border-top: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .src {
    font-size: 10px;
    color: var(--text-muted, #888);
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
