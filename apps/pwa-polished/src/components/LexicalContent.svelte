<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import {
    englishLexicalService,
    type WordInfo,
  } from "../../../../packages/core/src/search/englishLexicalService";
  import {
    lookupEnglishWord,
    resolveWorks,
    EMPTY_WORKS,
    type WorksResolution,
  } from "../adapters/lexicon-lookup.js";
  import WorkTabs from "./WorkTabs.svelte";
  import { openWorkSubject, carriedWorks, type WorkKey } from "../lib/openWork";
  import { windowStore } from "../lib/stores/windowStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { expandRmacCode, expandOshbCode } from "../lib/morphologyExpander";
  import { languageColor, glossTerm } from "../lib/strongs/entry";
  import { openDB } from "../adapters/db";
  import GetPacksCard from "./GetPacksCard.svelte";

  /**
   * The dictionary: an English word's definitions, or a tapped Greek or Hebrew
   * word's grammar. The original word's full Strong's entry is the Strong's
   * work's now, one tab over. Two hosts: the lookup card, and a docked window
   * pinned beside the reader — `windowId` is what tells them apart.
   */
  export let selectedText = "";
  export let strongsId: string | undefined = undefined;
  export let morphologyData: any = null;
  export let lexicalEntries: any = null;
  /** Set when docked: the id of the window hosting this word study. */
  export let windowId: string | null = null;
  /** The host's own close. Docked, Window.svelte supplies the ×. */
  export let onClose: (() => void) | null = null;
  /** How far down it was, restored when you come back. */
  export let initialScrollTop = 0;
  /** Reports the view on the way out, so switching tabs and coming back lands
   *  where you left rather than at the top. */
  export let onSnapshot: ((snap: { scrollTop: number }) => void) | null = null;

  $: docked = !!windowId;

  /** Hand what's on screen to a docked window, so it can sit beside the
   *  passage. Same edge convention as the encyclopedia's pop-out. */
  function popOut() {
    const edge = window.innerHeight > window.innerWidth ? "bottom" : "right";
    const id = windowStore.createWindow(edge, 50);
    // At the six-window cap. Leave the card up rather than closing onto nothing.
    if (!id) return;
    // A window's details are written to storage on every change, which has no
    // place for a word's grammar — so a tapped word is pinned as its Strong's
    // entry, which a window can hold, and an English word as itself.
    const tapped = morphologyData?.strongsId;
    if (tapped) {
      windowStore.setWindowContent(id, "strongs", { strongsId: tapped });
    } else {
      windowStore.setWindowContent(id, "wordstudy", { selectedText, primaryName: selectedText });
    }
    close();
  }

  let loading = false;
  let error = "";
  let bodyEl: HTMLDivElement | null = null;

  onDestroy(() => onSnapshot?.({ scrollTop: bodyEl?.scrollTop ?? 0 }));

  // English lexical data
  let englishWordInfo: WordInfo | null = null;
  let englishPOS: string[] = [];
  let isEnglishWord = false;
  let hasOfflineDefinitions = false;
  let localLexicalEntries: any = null;

  let mounted = false;
  onMount(async () => {
    mounted = true;
    if (initialScrollTop) {
      // Only meaningful once the body has something in it to scroll.
      await tick();
      if (bodyEl) bodyEl.scrollTop = initialScrollTop;
    }
  });

  // Reload whenever the subject changes. Mounted fresh per open today; keyed so
  // it also re-reads when the host swaps the word underneath it.
  let loadedKey = "";
  $: if (mounted) {
    const key = `${selectedText}|${strongsId ?? ""}`;
    if (key !== loadedKey) {
      loadedKey = key;
      loadLexicalData();
    }
  }

  $: effectiveLexicalEntries = localLexicalEntries ?? lexicalEntries;
  $: hasOfflineDefinitions = Boolean(
    effectiveLexicalEntries?.modern?.length || effectiveLexicalEntries?.historic?.length || effectiveLexicalEntries?.wordset?.length,
  );

  let isDictionaryInstalled = false;
  onMount(() => {
    openDB().then((db) => {
      const tx = db.transaction('packs', 'readonly');
      const req = tx.objectStore('packs').get('dictionary-en');
      req.onsuccess = () => { isDictionaryInstalled = !!req.result; };
      req.onerror = () => { isDictionaryInstalled = false; };
    }).catch(() => { isDictionaryInstalled = false; });
  });

  // --- The other works ----------------------------------------------------
  // What the other works have for this term. One resolver answers all of them
  // at once and hands back ids rather than booleans, so a control that lights
  // up is guaranteed to open something. Plural-folded by the shared resolvers
  // underneath; silent when a pack isn't installed.
  let works: WorksResolution | null = null;
  let worksCheckedFor = "";

  /**
   * The term to ask the other works about.
   *
   * They are all indexed in English — the encyclopedia has "Abraham", not
   * Ἀβραάμ — so on a tapped original word the word on screen was never going
   * to match anything. The gloss is the English handle; the transliteration
   * is the fallback for words that have no gloss.
   */
  $: worksTerm = ((): string => {
    if (!morphologyData) return selectedText;
    const m = morphologyData as any;
    return glossTerm(m?.gloss_en ?? m?.gloss ?? "") || m?.transliteration || "";
  })();

  $: if (worksTerm) checkWorks(worksTerm);

  /**
   * The tabs' subject. A tapped word also has a Strong's entry, and carries
   * itself along so the Dictionary tab can come back to this view of it.
   */
  $: tabWorks = morphologyData?.strongsId
    ? {
        ...(works ?? EMPTY_WORKS),
        strongs: { id: String(morphologyData.strongsId), word: selectedText, morph: morphologyData },
      }
    : works;

  /**
   * The gloss is the English word behind the original one, so it behaves like
   * any other English word in the app: tapping it opens the dictionary on it.
   */
  function openGloss(gloss: string) {
    const word = glossTerm(gloss);
    if (!word) return;
    if (windowId) {
      windowStore.updateContentState(windowId, { selectedText: word, strongsId: null });
      return;
    }
    lexicalModalStore.open({
      selectedText: word,
      strongsId: undefined,
      morphologyData: null,
      lexicalEntries: null,
    });
  }

  /** The tapped word's full entry, in the Strong's tab. */
  function openStrongs(id: string) {
    const subject: WorksResolution = {
      ...(tabWorks ?? EMPTY_WORKS),
      strongs: { id, word: selectedText, morph: morphologyData },
    };
    openWorkSubject("strongs", subject, selectedText, windowId);
  }

  async function checkWorks(text: string) {
    const key = text.trim().toLowerCase();
    if (worksCheckedFor === key) return;
    worksCheckedFor = key;
    works = null;
    if (!key) return;
    // Arrived here from another tab? Inherit the resolution we were opened from
    // rather than deriving a new one from the word, which cannot tell three men
    // called Herod apart and so returns the wrong one to People.
    const inherited = carriedWorks("dictionary", key);
    if (inherited) {
      works = inherited;
      return;
    }
    try {
      const found = await resolveWorks(text);
      // A slower lookup must not light up a button for the previous word.
      if (worksCheckedFor !== key) return;
      works = found;
    } catch {
      works = null;
    }
  }

  /** The work tabs. Nothing closes: the card keeps its frame and swaps the
   *  work inside it, and a window changes in place. */
  function selectWork(work: WorkKey) {
    openWorkSubject(work, tabWorks, worksTerm || selectedText, windowId);
  }

  async function loadLexicalData() {
    loading = true;
    error = "";
    englishWordInfo = null;
    englishPOS = [];
    isEnglishWord = false;
    localLexicalEntries = null;

    try {
      // Check if we already have lexical entries from the new lookup system
      if (lexicalEntries) {
        isEnglishWord = true;
        englishWordInfo = {
          word: lexicalEntries.word,
          ipa_us: lexicalEntries.ipa_us ?? undefined,
        };
        if (lexicalEntries.pos) {
          englishPOS = Array.isArray(lexicalEntries.pos) ? lexicalEntries.pos : [lexicalEntries.pos];
        }
        return;
      }

      // A tapped word: its grammar is all this view shows, and it came with it.
      if (morphologyData) return;

      // A bare Strong's number is the Strong's work's to show now.
      if (strongsId) {
        openStrongs(strongsId);
        return;
      }

      if (selectedText) {
        const searchText = selectedText.trim().toLowerCase();

        try {
          const offlineEntry = await lookupEnglishWord(searchText);
          if (offlineEntry) {
            localLexicalEntries = offlineEntry;
            isEnglishWord = true;
            englishWordInfo = {
              word: offlineEntry.word,
              ipa_us: offlineEntry.ipa_us ?? undefined,
            };
            if (offlineEntry.pos) {
              englishPOS = Array.isArray(offlineEntry.pos)
                ? offlineEntry.pos
                : [offlineEntry.pos];
            }
            return;
          }
        } catch (err) {
          console.log("Offline dictionary lookup failed:", err);
        }

        try {
          await englishLexicalService.initialize();
          englishWordInfo = await englishLexicalService.getPronunciation(searchText);
          if (englishWordInfo) {
            isEnglishWord = true;
            englishPOS = await englishLexicalService.getPOSTags(searchText).catch(() => []);
            return;
          }
        } catch (err) {
          console.log("English lexical lookup failed:", err);
        }

        error = `No lexical entries found for "${selectedText}"`;
      }
    } catch (err) {
      console.error("Error loading lexical data:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      error = `Failed to load lexical data: ${errorMessage}`;
    } finally {
      loading = false;
    }
  }

  function close() {
    error = "";
    onClose?.();
  }

  /** "noah" -> "Noah". Same title-casing IsbeContent does for place types. */
  function titleCase(t: string): string {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * The gray line under the title. Encyclopedia and Topical both read as
   * "what it is  ·  how many", and this mirrors them so the headers sit at the
   * same height.
   */
  $: headerSubtitle = ((): string => {
    const bits: string[] = [];
    if (isEnglishWord && englishWordInfo) {
      bits.push("Dictionary");
      if (englishPOS.length) bits.push(englishPOS.join(", "));
    }
    return bits.join("  ·  ");
  })();
</script>

<div class="lexical-content" class:docked>
  <WorkTabs
    works={tabWorks}
    current="dictionary"
    inWindow={docked}
    onSelect={selectWork}
  />
  <div class="modal-header">
    <div class="head-text">
      <h2>
        {#if selectedText}
          <!-- The word itself is the title, as it is in the other three
               cards. Title-cased because bridging in from them forces the
               term lowercase, so it would otherwise read "noah". -->
          {titleCase(selectedText)}
        {:else}
          Word Study
        {/if}
      </h2>
      {#if headerSubtitle}
        <div class="sub">{headerSubtitle}</div>
      {/if}
    </div>
    <div class="head-actions">
      <!-- Docked already: Window.svelte supplies the chrome, so neither of
           these belongs here. -->
      {#if !docked}
        <button class="pop-btn" on:click={popOut} title="Pin beside the reader" aria-label="Pin beside the reader">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke-width="1.8" />
            <path d="M14 4v16" stroke-width="1.8" />
            <path d="M6.2 9.6L8.6 12l-2.4 2.4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
      {#if !docked}
        <button class="close-btn" on:click={close} aria-label="Close">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="modal-body" bind:this={bodyEl}>
    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading lexical data...</p>
      </div>
    {:else if error}
      <div class="error">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="12" cy="12" r="10" stroke-width="2" />
          <path
            d="M12 8v4M12 16h.01"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <p>{error}</p>
        <p class="hint">Lexical packs may not be fully installed yet.</p>
      </div>
    {:else if morphologyData}
      <!-- Original Language Morphology Display -->
      <div class="morphology-view">
        <div class="info-section">
          <h3>Morphology</h3>
          <dl>
            <dt>Word:</dt>
            <dd class="morph-text" dir={morphologyData.language === 'hebrew' ? 'rtl' : 'ltr'}>
              {morphologyData.text}
            </dd>

            {#if morphologyData.lemma}
              <dt>Lemma:</dt>
              <dd class="morph-lemma" dir={morphologyData.language === 'hebrew' ? 'rtl' : 'ltr'}>
                {#if morphologyData.lemma && !/^\d+$/.test(morphologyData.lemma) && !/^[a-z]\/\d/.test(morphologyData.lemma)}
                  {morphologyData.lemma}
                {:else}
                  {morphologyData.text}
                  <span class="hint-text">(lemma data unavailable)</span>
                {/if}
              </dd>
            {/if}

            {#if morphologyData.transliteration}
              <dt>Transliteration:</dt>
              <dd>{morphologyData.transliteration}</dd>
            {:else}
              <dt>Transliteration:</dt>
              <dd class="missing-data">Not available in legacy pack</dd>
            {/if}

            {#if morphologyData.strongsId}
              <dt>Strong's:</dt>
              <dd>
                <button
                  class="strongs-link"
                  style="color: {languageColor(morphologyData.language)}"
                  on:click={() => openStrongs(morphologyData.strongsId)}
                  title="Open in Strong’s"
                >
                  {morphologyData.strongsId}
                </button>
              </dd>
            {/if}

            {#if (morphologyData as any).gloss_en || (morphologyData as any).gloss}
              {@const gloss = (morphologyData as any).gloss_en ?? (morphologyData as any).gloss}
              <dt>English Gloss:</dt>
              <dd>
                <button
                  class="gloss"
                  on:click={() => openGloss(gloss)}
                  title="Look up “{glossTerm(gloss)}” in the dictionary"
                >
                  {gloss}
                </button>
              </dd>
            {/if}

            {#if (morphologyData as any).morph_code || (morphologyData as any).parsing}
              {@const _rawCode = (morphologyData as any).morph_code ?? (morphologyData as any).parsing}
              {@const _expanded = (morphologyData.language === 'hebrew' || morphologyData.language === 'aramaic')
                ? expandOshbCode(_rawCode)
                : expandRmacCode(_rawCode)}
              <dt>Parsing:</dt>
              <dd class="parsing">
                {_expanded || _rawCode}
                {#if _expanded && _expanded !== _rawCode}
                  <span class="code-raw">({_rawCode})</span>
                {/if}
              </dd>
            {/if}

            <dt>Language:</dt>
            <dd>
              <span style="color: {languageColor(morphologyData.language)}">
                {morphologyData.language.charAt(0).toUpperCase() + morphologyData.language.slice(1)}
              </span>
            </dd>
          </dl>
        </div>

        {#if morphologyData.strongsId}
          <div class="hint-section">
            <p class="hint">
              <span class="emoji">💡</span> Tap the Strong's number for its full entry in Strong's
            </p>
          </div>
        {/if}
      </div>
    {:else if isEnglishWord && englishWordInfo}
      <!-- English Word Information. No tab strip: definitions are the only
           thing this view shows now that synonyms are gone. -->
      <div class="tab-content">
          <div class="definition-view">
            <div class="info-section">
              <h3>Word Information</h3>
              <dl>
                <dt>Word:</dt>
                <dd class="lemma-text">{englishWordInfo.word}</dd>

                {#if englishPOS.length > 0}
                  <dt>Part of Speech:</dt>
                  <dd style="text-transform: capitalize;">
                    {englishPOS.join(", ")}
                  </dd>
                {/if}

                {#if englishWordInfo.ipa_us}
                  <dt>Pronunciation:</dt>
                  <dd class="ipa-text">{englishWordInfo.ipa_us}</dd>
                {/if}
              </dl>
            </div>

            {#if effectiveLexicalEntries && (effectiveLexicalEntries.wordset?.length > 0 || effectiveLexicalEntries.historic?.length > 0)}
              <!-- Offline Dictionary Definitions from Dictionary Pack. Both
                   layers come from the installed pack; there is no online
                   lookup. Wiktionary is deliberately absent from both — the
                   pack dropped it, and the api.dictionaryapi.dev call that
                   served it live has been removed. -->
              <div class="definitions-grid">
                <!-- Modern Definitions (Concise / Wordset) -->
                {#if effectiveLexicalEntries.wordset && effectiveLexicalEntries.wordset.length > 0}
                <div class="info-section">
                  <h3 style="color: #4a90e2; display: flex; align-items: center; gap: 8px;">
                    <span class="emoji">📖</span> Modern Definitions
                  </h3>
                  {#each effectiveLexicalEntries.wordset as def}
                    <div class="modern-def" style="margin-bottom: 12px;">
                      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
                        {#if def.pos}
                          <span class="pos-pill" style="background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 11px; text-transform: capitalize;">
                            {def.pos}
                          </span>
                        {/if}
                      </div>
                      <p class="definition-text" style="margin: 4px 0;">{def.definition}</p>
                      {#if def.example}
                        <p class="example-text" style="margin: 4px 0; color: #666; font-style: italic; font-size: 14px;">
                          "{def.example}"
                        </p>
                      {/if}
                    </div>
                  {/each}
                </div>
                {/if}

                <!-- Historic Definitions (GCIDE/Webster 1913) -->
                <div class="info-section">
                <h3 style="color: #8d6e63; display: flex; align-items: center; gap: 8px;">
                  <span class="emoji">📜</span> Historic Definitions
                  <span style="font-size: 12px; color: #666; font-weight: normal;">Webster 1913</span>
                </h3>
                {#if effectiveLexicalEntries.historic && effectiveLexicalEntries.historic.length > 0}
                  {#each effectiveLexicalEntries.historic as def}
                    <div class="historic-def" style="margin-bottom: 12px; border-left: 3px solid #d7ccc8; padding-left: 12px;">
                      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
                        {#if def.sense_number}
                          <span class="sense-badge" style="background: #d7ccc8; color: #5d4037;">{def.sense_number}</span>
                        {/if}
                        {#if def.pos}
                          <span class="pos-pill" style="background: #efebe9; color: #5d4037; padding: 2px 8px; border-radius: 12px; font-size: 11px; text-transform: capitalize;">
                            {def.pos}
                          </span>
                        {/if}
                      </div>
                      <p class="definition-text" style="margin: 4px 0;">{def.definition}</p>
                      {#if def.example}
                        <p class="example-text" style="margin: 4px 0; color: #666; font-style: italic; font-size: 14px;">
                          "{def.example}"
                        </p>
                      {/if}
                    </div>
                  {/each}
                {:else}
                  <p class="definition-text" style="margin: 6px 0 0; color: #777; font-size: 13px;">
                    No historic definitions available for this word.
                  </p>
                {/if}
                </div>
              </div>
            {/if}

            {#if !hasOfflineDefinitions}
              <!-- No offline definitions available -->
              <div class="info-section">
                <h3>About This Word</h3>
                <p class="full-def">
                  This is an English word from the Bible translation.
                  For deeper study, look up the original Greek or Hebrew word from an interlinear Bible.
                </p>
                {#if isDictionaryInstalled}
                  <p style="margin-top: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px; font-size: 13px; color: #555;">
                    No definition found for this word in the installed dictionary.
                  </p>
                {:else}
                  <div style="margin-top: 12px;">
                    <GetPacksCard
                      packs={["dictionary-en", "lexical"]}
                      title="Get the dictionaries"
                      note="Modern and Webster 1913 definitions for English words, and Strong's Hebrew and Greek for the original ones."
                    />
                  </div>
                {/if}
              </div>
            {/if}
          </div>
      </div>
    {:else}
      <div class="empty-state">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M12 6.5v10M7 11.5h10"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <circle cx="12" cy="12" r="10" stroke-width="1.5" />
        </svg>
        <p>No lexical data to display</p>
      </div>
    {/if}
  </div>
</div>

<style>
  /* flex:1 fills the card (a flex column); height:100% fills a docked window's
     panel-content (which isn't one). Both are set so the same component fills
     either host — same arrangement as IsbeContent. */
  .lexical-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--background-color, #1e1e1e);
    color: var(--text-color, #fff);
  }
  .lexical-content.docked {
    height: 100%;
  }

  /* .tab-content animates with this, and the card that used to own it now
     lives in LexicalModal. */
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }


  .modal-header {
    display: flex;
    /* Wraps so a very narrow phone drops the title onto its own line rather
       than crushing it — see IsbeContent. */
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: calc(12px * var(--bar-scale, 1));
    padding: calc(16px * var(--bar-scale, 1)) calc(18px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }

  /* Takes the slack and is allowed to shrink, so a long lemma can never push
     the bridge pills or the close button off a narrow card. */
  .head-text {
    flex: 1 1 180px;
    min-width: 0;
  }

  .modal-header h2 {
    margin: 0;
    font-size: calc(20px * var(--bar-scale, 1));
    line-height: 1.15;
    /* Only split a word that genuinely cannot fit; `anywhere` broke mid-word as
       soon as the column got tight, stacking long words one letter per line. */
    overflow-wrap: break-word;
    color: var(--text-color, #fff);
  }

  .head-text .sub {
    margin-top: calc(4px * var(--bar-scale, 1));
    font-size: calc(12px * var(--bar-scale, 1));
    color: var(--text-muted, #999);
  }


  .head-actions {
    display: flex;
    align-items: center;
    gap: calc(8px * var(--bar-scale, 1));
    flex-shrink: 0;
  }
  .pop-btn {
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
  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted, #999);
    cursor: pointer;
    padding: calc(2px * var(--bar-scale, 1));
    flex-shrink: 0;
  }

  .close-btn:hover {
    color: var(--text-color, #fff);
  }

  .modal-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(76, 175, 80, 0.2);
    border-top-color: #4caf50;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
    color: #ff6b6b;
  }

  .error svg {
    stroke: #ff6b6b;
  }

  .error p {
    margin: 0;
    text-align: center;
  }

  .hint {
    font-size: 14px;
    color: #888;
    margin-top: 8px;
  }



  .tab-content {
    animation: fadeIn 0.2s ease-out;
  }

  .definition-view {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .info-section h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #4caf50;
    border-bottom: 1px solid rgba(76, 175, 80, 0.2);
    padding-bottom: 8px;
  }

  .info-section dl {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 12px 16px;
    margin: 0;
  }

  .info-section dt {
    font-weight: 500;
    color: #888;
  }

  .info-section dd {
    margin: 0;
    color: var(--text-color, #fff);
  }

  .morph-text {
    font-size: 24px;
    font-weight: 600;
    font-family: "Times New Roman", serif;
  }

  .morph-lemma {
    font-size: 20px;
    font-weight: 500;
    font-family: "Times New Roman", serif;
    color: #4caf50;
  }

  .hint-text {
    font-size: 12px;
    color: #888;
    font-style: italic;
    margin-left: 8px;
    font-family: 'Milonga', cursive;
  }

  .missing-data {
    color: #888;
    font-style: italic;
  }

  .gloss {
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: 16px;
    color: #8bc34a;
    cursor: pointer;
    text-align: left;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .gloss:hover {
    text-decoration-style: solid;
  }

  .parsing {
    font-family: monospace;
    font-size: 14px;
    color: #999;
  }

  .code-raw {
    font-size: 0.8em;
    color: var(--text-muted, #888);
    margin-left: 0.3em;
    font-family: monospace;
    opacity: 0.7;
  }

  .strongs-link {
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    background: none;
    border: none;
    padding: 0;
    font-size: 16px;
  }

  .strongs-link:hover {
    opacity: 0.8;
  }


  .morphology-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .hint-section {
    padding: 12px 16px;
    background: rgba(76, 175, 80, 0.1);
    border-left: 3px solid #4caf50;
    border-radius: 4px;
  }

  .hint-section .hint {
    margin: 0;
    font-size: 14px;
    color: #8bc34a;
  }

  .lemma-text {
    font-size: 20px;
    font-weight: 600;
  }



  .ipa-text {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 18px;
    color: #4caf50;
  }

  .definitions-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  @media (max-width: 900px) {
    .definitions-grid {
      grid-template-columns: 1fr;
    }
  }

  .definition-text {
    margin: 0 0 8px 0;
    font-size: 15px;
    color: #e0e0e0;
  }

  .example-text {
    margin: 8px 0;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid #666;
    border-radius: 4px;
    font-size: 14px;
    color: #aaa;
  }


  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
    color: #666;
  }

  .empty-state svg {
    stroke: #666;
  }

  .empty-state p {
    margin: 0;
  }

  /* Scrollbar styling */
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }

  .modal-body::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }

  .modal-body::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }

  .modal-body::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* Responsive adjustments. The card itself is no longer overridden here — it
     uses the same min(720px, 100%) / min(86vh, 900px) sizing as Encyclopedia and
     Topical at every width, and the tab strip wraps instead of scrolling. */
  @media (max-width: 768px) {
    .info-section dl {
      grid-template-columns: 120px 1fr;
      gap: 8px 12px;
    }
  }


  /* Bar size: the header and tabs scale with --bar-scale (Settings →
     Appearance). The icons are sized by attribute, so they are resized here. */
  .modal-header .pop-btn svg {
    width: calc(18px * var(--bar-scale, 1));
    height: calc(18px * var(--bar-scale, 1));
  }
  .modal-header .close-btn svg {
    width: calc(24px * var(--bar-scale, 1));
    height: calc(24px * var(--bar-scale, 1));
  }
</style>
