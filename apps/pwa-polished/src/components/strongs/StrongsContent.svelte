<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import WorkTabs from "../WorkTabs.svelte";
  import LibraryFace from "../library/LibraryFace.svelte";
  import LibraryNavButtons from "../library/LibraryNavButtons.svelte";
  import IndexList from "../library/IndexList.svelte";
  import { ArrowsDownUp } from "phosphor-svelte";
  import GetPacksCard from "../GetPacksCard.svelte";
  import StrongsEntry from "./StrongsEntry.svelte";
  import SpeakWord, { type SpeakStatus } from "./SpeakWord.svelte";
  import { canSpeakGreek } from "../../lib/tts/speakWord";
  import { firstForm } from "../../lib/strongs/collate";
  import { packInstallFinished } from "../../adapters/db-manager";
  import { resolveWorks, EMPTY_WORKS, type WorksResolution, type LibraryRow } from "../../adapters/lexicon-lookup.js";
  import { openWorkSubject, openWorkIndex, carriedWorks, type WorkKey } from "../../lib/openWork";
  import { windowStore } from "../../lib/stores/windowStore";
  import { navigationStore } from "../../stores/navigationStore";
  import { strongsModalStore } from "../../stores/strongsModalStore";
  import { libraryPrefsStore } from "../../stores/libraryPrefsStore";
  import { testamentOf } from "../../lib/strongsUsage";
  import {
    strongsSource,
    savedSort,
    saveSort,
    nextSort,
    sortLabel,
    sortName,
    langOf,
    type StrongsLang,
    type StrongsSort,
  } from "../../lib/strongs/source";
  import {
    loadStrongsEntry,
    languageColor,
    languageName,
    partOfSpeechText,
    glossTerm,
    isRtl,
    displayId,
    classicId,
    shelfName,
    type StrongsEntryData,
    type EntryTab,
  } from "../../lib/strongs/entry";

  /**
   * Strong's, as a work of its own beside the encyclopedia, Nave's, the people
   * and the dictionary. Same two hosts as the others: the lookup card, and a
   * docked window pinned beside the reader. `windowId` tells them apart.
   *
   * Two sides, like the encyclopedia: the contents (every classic number, in
   * the order you pick) and one entry. The page turns between them.
   */
  export let strongsId: string | null = null;
  export let windowId: string | null = null;
  /** The host's own close. Docked, Window.svelte supplies the ×. */
  export let onClose: (() => void) | null = null;
  export let onPopOut: ((snap: Snapshot) => void) | null = null;
  /** Reports the view on the way out, so switching tabs and coming back lands
   *  where you left rather than at the top. */
  export let onSnapshot: ((snap: Snapshot) => void) | null = null;
  export let initialTab: EntryTab | null = null;
  export let initialScrollTop = 0;
  /** Entries walked through on the way to this one, for Back. */
  export let initialTrail: TrailStop[] = [];
  /** Open on the contents already searched for this — an English word that
   *  more than one Strong's entry translates. */
  export let search: string | null = null;

  type TrailStop = { id: string; name: string };
  type Snapshot = { strongsId: string; tab: EntryTab; scrollTop: number; trail: TrailStop[] };

  $: docked = !!windowId;

  let entry: StrongsEntryData | null = null;
  let loading = false;
  let activeTab: EntryTab = initialTab ?? "definition";
  let bodyEl: HTMLDivElement | null = null;
  /** The saved scroll belongs to the first entry shown, not to the next one. */
  let restoreScroll = initialScrollTop;

  /** Which side is up: the contents, or an entry. */
  let showContents = strongsId == null;
  /** Entries left by following a link inside one, newest last. */
  let trail: TrailStop[] = [...initialTrail];

  // Reload whenever the id changes: a related word, a row from the contents,
  // or the host swapping it. No id means the contents.
  let loadedId: string | null | undefined = undefined;
  $: if (strongsId !== loadedId) {
    loadedId = strongsId;
    showContents = strongsId == null;
    loadEntry();
  }

  async function loadEntry() {
    const id = strongsId;
    entry = null;
    if (!id) return;
    loading = true;
    const found = await loadStrongsEntry(id);
    // A slower lookup must not land over a word opened since.
    if (strongsId !== id) return;
    entry = found;
    loading = false;
    await tick();
    if (bodyEl) bodyEl.scrollTop = restoreScroll;
    restoreScroll = 0;
  }

  $: rtl = isRtl(entry?.language);

  // --- Saying it ---------------------------------------------------------
  // Greek only: there is no Hebrew voice. The line under the header belongs to
  // the word on screen, so a new word clears it.
  let speaker: SpeakWord | null = null;
  let speakStatus: SpeakStatus = null;
  $: canSay = !!entry && entry.language === "greek" && canSpeakGreek();
  $: entry, (speakStatus = null);
  $: subtitle = entry
    ? [languageName(entry), entry.transliteration, entry.partOfSpeech ? partOfSpeechText(entry.partOfSpeech) : ""]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  // --- Recents -----------------------------------------------------------
  let rememberedId: string | null = null;
  $: if (entry && entry.id !== rememberedId) {
    rememberedId = entry.id;
    libraryPrefsStore.markRead("strongs", {
      id: entry.id,
      name: shelfName(entry.id, entry.lemma, entry.shortDefinition),
      sortKey: entry.id,
    });
  }

  // --- The contents ------------------------------------------------------
  // One language at a time, since Greek and Hebrew can't share an alphabet. It
  // opens on the language of what you're looking at — the entry, or else the
  // testament you're reading — and the order is the one you last left it in.
  let lang: StrongsLang = strongsId ? langOf(strongsId) : readerLang();
  let sort: StrongsSort = savedSort();
  /** The search the contents open with. Spent once the language or order
   *  changes, since that starts the list afresh. */
  let listSearch: string | null = search;
  let seenSearch = search;
  $: if (search !== seenSearch) {
    seenSearch = search;
    listSearch = search;
  }
  $: source = strongsSource(lang, sort);
  /** The row to land on and keep marked: the entry's classic number. */
  $: contentsRowId = entry ? classicId(entry.id) : null;

  function readerLang(): StrongsLang {
    return testamentOf(get(navigationStore).book) === "OT" ? "hebrew" : "greek";
  }

  function cycleSort() {
    sort = nextSort(sort);
    saveSort(sort);
    listSearch = null;
  }

  function setLang(next: StrongsLang) {
    if (next === lang) return;
    lang = next;
    listSearch = null;
  }

  // --- Back and flip -----------------------------------------------------
  $: lastRead = $libraryPrefsStore.strongs.lastRead;
  $: canGoBack = !showContents && (trail.length > 0 || !!entry);
  $: canFlip = showContents ? !!entry || !!lastRead : true;

  /** The page under the work tabs; moving between the contents and an entry
   *  turns it over. */
  let face: { turn(toEntry: boolean, apply: () => void): void } | null = null;

  function turnTo(toEntry: boolean, apply: () => void) {
    if (face) face.turn(toEntry, apply);
    else apply();
  }

  /** To the contents, in the entry's own language so its row is there. */
  function showList() {
    if (entry) lang = langOf(entry.id);
    showContents = true;
  }

  /** Back walks out one step at a time: an entry off the trail, then the
   *  contents. */
  function goBack() {
    if (trail.length) return popTrailTo(trail.length - 1);
    turnTo(false, showList);
  }

  /** Back to an entry on the trail, dropping it and everything after it. */
  function popTrailTo(index: number) {
    const stop = trail[index];
    if (!stop) return;
    trail = trail.slice(0, index);
    openEntry(stop.id);
  }

  /** Follow a link inside the entry, leaving this one on the trail. */
  function followEntry(id: string) {
    if (entry && id !== entry.id) {
      trail = [...trail, { id: entry.id, name: `${displayId(entry.id)} ${firstForm(entry.lemma)}` }];
    }
    openEntry(id);
  }

  /** Escape comes here before the host closes — see IsbeContent.handleBack. */
  export function handleBack(): boolean {
    if (!canGoBack) return false;
    goBack();
    return true;
  }

  function flip() {
    if (!showContents) {
      turnTo(false, showList);
      return;
    }
    // Nothing open this time — flip to whatever you last had open.
    if (!entry && lastRead) {
      const id = String(lastRead.id);
      turnTo(true, () => openEntry(id));
      return;
    }
    turnTo(true, () => (showContents = false));
  }

  /** Open from the contents — a fresh start, no trail. */
  function openFromContents(row: LibraryRow) {
    const id = String(row.id);
    turnTo(true, () => {
      trail = [];
      openEntry(id);
    });
  }

  // --- The other four works ----------------------------------------------
  // They are all indexed in English, so they are asked about the gloss: "love"
  // rather than ἀγάπη. Arriving from the Dictionary's view of a tapped word, the
  // resolution it carried comes along instead, so its tab still leads back to
  // that word's grammar.
  let works: WorksResolution | null = null;
  let worksFor = "";

  $: if (entry) checkWorks(entry);

  async function checkWorks(e: StrongsEntryData) {
    if (worksFor === e.id) return;
    worksFor = e.id;
    const inherited = carriedWorks("strongs", e.id);
    // A resolution that came with its English term already has the other works
    // in it. One that came from the ring carries only the tapped word, which
    // is kept for the Dictionary tab while the rest are looked up here.
    if (inherited?.term) {
      works = inherited;
      return;
    }
    const own = inherited?.strongs ?? { id: e.id };
    works = { ...EMPTY_WORKS, strongs: own };
    const term = glossTerm(e.shortDefinition ?? "") || e.transliteration || "";
    if (!term) return;
    try {
      const found = await resolveWorks(term);
      // A slower lookup must not light up a tab for the previous word.
      if (worksFor !== e.id) return;
      works = { ...found, strongs: own };
    } catch {
      // The tabs simply stay gray.
    }
  }

  /**
   * The work tabs. Docked, this swaps what the window is showing and the window
   * stays put; otherwise the card keeps its frame with another work inside it.
   */
  function selectWork(work: WorkKey) {
    // Over the contents the tabs move between contents; there's no subject.
    if (showContents || !entry) {
      openWorkIndex(work, windowId);
      return;
    }
    openWorkSubject(work, works, glossTerm(entry.shortDefinition ?? "") || entry.lemma, windowId);
  }

  // --- Navigation --------------------------------------------------------
  /** Another entry: a row from the contents, or a related word. */
  function openEntry(id: string) {
    // Set here as well as by the reload, because opening the entry that is
    // already loaded changes no id.
    showContents = false;
    if (windowId) {
      windowStore.updateContentState(windowId, { strongsId: id, trail });
      return;
    }
    strongsModalStore.open({ strongsId: id });
  }

  function persistTab(tab: EntryTab) {
    if (windowId) windowStore.updateContentState(windowId, { tab });
  }

  /**
   * Follow a verse into the reader, keeping the translation you are reading.
   * The entry rides along on the crumb, so walking back reopens it where you
   * left it. Docked there is nothing to reopen — the study stays up beside the
   * passage, which is the whole point of pinning it.
   */
  function goToVerse(target: { book: string; chapter: number; verse: number }) {
    const current = get(navigationStore);
    const snap = docked ? null : viewSnapshot();
    navigationStore.pushHistory(current, "library", snap ? { surface: "strongs", snapshot: snap } : undefined);
    navigationStore.navigateToVerse(current.translation, target.book, target.chapter, target.verse);
    if (!docked) onClose?.();
  }

  function popOut() {
    const snap = viewSnapshot();
    if (snap) onPopOut?.(snap);
  }

  /** Everything needed to put this entry back exactly as it is now. */
  function viewSnapshot(): Snapshot | null {
    if (!entry) return null;
    return { strongsId: entry.id, tab: activeTab, scrollTop: bodyEl?.scrollTop ?? 0, trail };
  }

  onDestroy(() => {
    const snap = viewSnapshot();
    if (snap) onSnapshot?.(snap);
  });
</script>

<div class="strongs-content" class:docked>
  <WorkTabs {works} current="strongs" onIndex={showContents} inWindow={docked} onSelect={selectWork} />
  <LibraryFace bind:this={face}>
    <div class="strongs-header">
      <LibraryNavButtons {canGoBack} {canFlip} onIndex={showContents} onBack={goBack} onFlip={flip} />
      <div class="head-text">
        <h2>
          {#if !showContents && entry}
            <span class="lemma" dir={rtl ? "rtl" : "ltr"}>{entry.lemma}</span>
            <span class="strongs-id" style="color: {languageColor(entry.language)}">{displayId(entry.id)}</span>
            {#if canSay}
              <SpeakWord bind:this={speaker} bind:status={speakStatus} word={firstForm(entry.lemma)} />
            {/if}
          {:else}
            {source.label}
          {/if}
        </h2>
        <div class="sub">
          {#if showContents}
            {source.subtitle} · {sortName(sort, lang)}
          {:else}
            {subtitle}
          {/if}
        </div>
        {#if !showContents && speakStatus}
          <div class="speak-note" role="status">
            {#if speakStatus.kind === "voice-needed"}
              The Greek voice isn’t on this device yet.
              <button class="speak-get" on:click={() => speaker?.download()}>
                Download it (~{speakStatus.sizeMB} MB)
              </button>
            {:else if speakStatus.kind === "downloading"}
              Downloading the Greek voice… {speakStatus.percent}%
            {:else}
              {speakStatus.text}
            {/if}
          </div>
        {/if}
      </div>
      <div class="head-actions">
        {#if !showContents && entry && onPopOut}
          <button class="pop-btn" on:click={popOut} title="Pin beside the reader" aria-label="Pin beside the reader">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.8" />
              <path d="M14 4v16" stroke-width="1.8" />
              <path d="M6.2 9.6L8.6 12l-2.4 2.4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
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
      <!-- A new language or order is a new list: its sections, rail and rows
           all change, so it starts afresh rather than patching the old one. -->
      {#key source}
        <IndexList {source} onOpen={openFromContents} initialRowId={contentsRowId} initialSearch={listSearch}>
          <svelte:fragment slot="controls">
            <div class="lang-switch" role="group" aria-label="Language">
              <button class="ctl" class:on={lang === "greek"} on:click={() => setLang("greek")}>Greek</button>
              <button class="ctl" class:on={lang === "hebrew"} on:click={() => setLang("hebrew")}>Hebrew</button>
            </div>
            <button
              class="ctl sort"
              on:click={cycleSort}
              title="{sortName(sort, lang)} — tap for {sortName(nextSort(sort), lang).toLowerCase()}"
              aria-label="Order: {sortName(sort, lang)}. Tap for {sortName(nextSort(sort), lang).toLowerCase()}."
            >
              <ArrowsDownUp size={11} weight="bold" />
              {sortLabel(sort, lang)}
            </button>
          </svelte:fragment>
        </IndexList>
      {/key}
    {:else}
    {#if trail.length}
      <nav class="trail" aria-label="Back trail">
        {#each trail as stop, i}
          <button class="crumb" on:click={() => popTrailTo(i)}>{stop.name}</button>
          <span class="crumb-sep">›</span>
        {/each}
        {#if entry}<span class="crumb here">{displayId(entry.id)} {firstForm(entry.lemma)}</span>{/if}
      </nav>
    {/if}
    <div class="strongs-body" bind:this={bodyEl}>
      {#if loading}
        <div class="muted show-late">Loading…</div>
      {:else if entry}
        <StrongsEntry
          {entry}
          bind:activeTab
          onVerse={goToVerse}
          onOpenEntry={followEntry}
          onTab={persistTab}
        />
      {:else if strongsId}
        {#await packInstallFinished("lexical").catch(() => false) then installed}
          {#if installed}
            <div class="muted">Strong’s {displayId(strongsId)} isn’t in the dictionary.</div>
          {:else}
            <GetPacksCard
              packs={["lexical"]}
              title="Get Strong’s"
              note="Strong’s Hebrew and Greek dictionary: every word of the original Bible, with its meaning, forms and every place it’s used."
            />
          {/if}
        {/await}
      {/if}
    </div>
    {/if}
  </LibraryFace>
</div>

<style>
  /* flex:1 fills the modal card (a flex column); height:100% fills a docked
     window's panel-content. Both are set so the same component fills either. */
  .strongs-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
  }
  .strongs-content.docked {
    height: 100%;
  }

  .strongs-header {
    display: flex;
    /* Wraps so a narrow pane drops the title onto its own line rather than
       crushing it into a column of single letters — see IsbeContent. */
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: calc(12px * var(--bar-scale, 1));
    padding: calc(16px * var(--bar-scale, 1)) calc(18px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .head-text {
    flex: 1 1 180px;
    min-width: 0;
  }
  .head-text h2 {
    margin: 0;
    font-size: calc(20px * var(--bar-scale, 1));
    line-height: 1.15;
    /* Only split a word that genuinely cannot fit. */
    overflow-wrap: break-word;
    color: var(--text-color, #fff);
  }
  .head-text .sub {
    margin-top: calc(4px * var(--bar-scale, 1));
    font-size: calc(12px * var(--bar-scale, 1));
    color: var(--text-muted, #999);
  }
  /* The number sits beside the word as a badge in the language's color. */
  .strongs-id {
    display: inline-block;
    margin-left: calc(10px * var(--bar-scale, 1));
    font-size: calc(15px * var(--bar-scale, 1));
    font-weight: 500;
    padding: 2px 9px;
    background: rgba(76, 175, 80, 0.1);
    border-radius: 6px;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: calc(8px * var(--bar-scale, 1));
    flex-shrink: 0;
  }
  .pop-btn,
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    padding: calc(2px * var(--bar-scale, 1));
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

  .strongs-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px;
  }
  .muted {
    color: var(--text-muted, #999);
  }

  /* The speaker's line: the offer to fetch the voice, its progress, or why
     nothing played. */
  .speak-note {
    margin-top: calc(6px * var(--bar-scale, 1));
    font-size: calc(12px * var(--bar-scale, 1));
    color: var(--text-muted, #999);
  }
  .speak-get {
    background: none;
    border: none;
    padding: 0;
    margin-left: 4px;
    font: inherit;
    color: #34d399;
    text-decoration: underline;
    cursor: pointer;
  }

  /* Entries walked through by links, the way the encyclopedia shows its trail. */
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

  /* The contents' own controls, drawn like the list's chips beside them. */
  .lang-switch {
    display: flex;
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
  .ctl.on {
    color: var(--color-primary, #4a90e2);
    border-color: var(--color-primary, #4a90e2);
  }
  /* The two languages read as one switch: joined, square where they meet. */
  .lang-switch .ctl:first-child {
    border-radius: 999px 0 0 999px;
  }
  .lang-switch .ctl:last-child {
    border-radius: 0 999px 999px 0;
    margin-left: -1px;
  }
  .lang-switch .ctl.on {
    position: relative;
    z-index: 1;
  }

  /* Bar size: the header scales with --bar-scale (Settings → Appearance). The
     icons are sized by attribute, so they are resized here. */
  .strongs-header .pop-btn svg {
    width: calc(18px * var(--bar-scale, 1));
    height: calc(18px * var(--bar-scale, 1));
  }
  .strongs-header .close-btn svg {
    width: calc(24px * var(--bar-scale, 1));
    height: calc(24px * var(--bar-scale, 1));
  }
</style>
