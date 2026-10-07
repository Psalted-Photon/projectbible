<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { get } from "svelte/store";
  import WorkTabs from "../WorkTabs.svelte";
  import LibraryFace from "../library/LibraryFace.svelte";
  import GetPacksCard from "../GetPacksCard.svelte";
  import StrongsEntry from "./StrongsEntry.svelte";
  import { packInstallFinished } from "../../adapters/db-manager";
  import { resolveWorks, EMPTY_WORKS, type WorksResolution } from "../../adapters/lexicon-lookup.js";
  import { openWorkSubject, openWorkIndex, carriedWorks, type WorkKey } from "../../lib/openWork";
  import { windowStore } from "../../lib/stores/windowStore";
  import { navigationStore } from "../../stores/navigationStore";
  import { strongsModalStore } from "../../stores/strongsModalStore";
  import { libraryPrefsStore } from "../../stores/libraryPrefsStore";
  import {
    loadStrongsEntry,
    languageColor,
    languageName,
    partOfSpeechText,
    glossTerm,
    isRtl,
    type StrongsEntryData,
    type EntryTab,
  } from "../../lib/strongs/entry";

  /**
   * Strong's, as a work of its own beside the encyclopedia, Nave's, the people
   * and the dictionary. Same two hosts as the others: the lookup card, and a
   * docked window pinned beside the reader. `windowId` tells them apart.
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

  type Snapshot = { strongsId: string; tab: EntryTab; scrollTop: number };

  $: docked = !!windowId;

  let entry: StrongsEntryData | null = null;
  let loading = false;
  let activeTab: EntryTab = initialTab ?? "definition";
  let bodyEl: HTMLDivElement | null = null;
  /** The saved scroll belongs to the first entry shown, not to the next one. */
  let restoreScroll = initialScrollTop;

  // Reload whenever the id changes: a related word, or the host swapping it.
  let loadedId: string | null | undefined = undefined;
  $: if (strongsId !== loadedId) {
    loadedId = strongsId;
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
      name: entry.shortDefinition ? `${entry.lemma} · ${entry.shortDefinition}` : entry.lemma,
      sortKey: entry.id,
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
    if (inherited) {
      works = inherited;
      return;
    }
    const own = { id: e.id };
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
    if (!entry) {
      openWorkIndex(work, windowId);
      return;
    }
    openWorkSubject(work, works, glossTerm(entry.shortDefinition ?? "") || entry.lemma, windowId);
  }

  // --- Navigation --------------------------------------------------------
  /** Another entry, from a related word. */
  function openEntry(id: string) {
    if (windowId) {
      windowStore.updateContentState(windowId, { strongsId: id });
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
    return { strongsId: entry.id, tab: activeTab, scrollTop: bodyEl?.scrollTop ?? 0 };
  }

  onDestroy(() => {
    const snap = viewSnapshot();
    if (snap) onSnapshot?.(snap);
  });
</script>

<div class="strongs-content" class:docked>
  <WorkTabs {works} current="strongs" inWindow={docked} onSelect={selectWork} />
  <LibraryFace>
    <div class="strongs-header">
      <div class="head-text">
        <h2>
          {#if entry}
            <span class="lemma" dir={rtl ? "rtl" : "ltr"}>{entry.lemma}</span>
            <span class="strongs-id" style="color: {languageColor(entry.language)}">{entry.id}</span>
          {:else}
            Strong’s
          {/if}
        </h2>
        <div class="sub">{entry ? subtitle : "Strong’s Hebrew and Greek dictionary"}</div>
      </div>
      <div class="head-actions">
        {#if entry && onPopOut}
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

    <div class="strongs-body" bind:this={bodyEl}>
      {#if loading}
        <div class="muted show-late">Loading…</div>
      {:else if entry}
        <StrongsEntry
          {entry}
          bind:activeTab
          onVerse={goToVerse}
          onOpenEntry={openEntry}
          onTab={persistTab}
        />
      {:else if strongsId}
        {#await packInstallFinished("lexical").catch(() => false) then installed}
          {#if installed}
            <div class="muted">Strong’s {strongsId} isn’t in the dictionary.</div>
          {:else}
            <GetPacksCard
              packs={["lexical"]}
              title="Get Strong’s"
              note="Strong’s Hebrew and Greek dictionary: every word of the original Bible, with its meaning, forms and every place it’s used."
            />
          {/if}
        {/await}
      {:else}
        <div class="muted">Tap a Greek or Hebrew word, then its Strong’s number, to open an entry here.</div>
      {/if}
    </div>
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
