<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { IndexedDBLexiconStore } from "../adapters/LexiconStore";
  import type { StrongEntry } from "@projectbible/core";
  import { getBookColor } from "../lib/bibleData.js";
  import StrongsVerseList from "./StrongsVerseList.svelte";
  import {
    loadStrongsUsage,
    buildVerseUses,
    buildFormGroups,
    sourcesByTestament,
    summarizeArc,
    refKey,
    type StrongsUsage,
    type VerseUse,
  } from "../lib/strongsUsage";
  import {
    englishLexicalService,
    type WordInfo,
  } from "../../../../packages/core/src/search/englishLexicalService";
  import {
    lookupEnglishWord,
    lookupStrongs,
    resolveWorks,
    type WorksResolution,
  } from "../adapters/lexicon-lookup.js";
  import WorkTabs from "./WorkTabs.svelte";
  import { openWorkSubject, carriedWorks, type WorkKey } from "../lib/openWork";
  import { windowStore } from "../lib/stores/windowStore";
  import { get } from "svelte/store";
  import { navigationStore } from "../stores/navigationStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { parseOsisRef } from "../lib/parseRefString";
  import { expandRmacCode, expandOshbCode, expandStepBiblePOS } from "../lib/morphologyExpander";
  import { openDB } from "../adapters/db";

  /**
   * The word study itself, independent of what is holding it. Two hosts: the
   * lookup card, and a docked window pinned beside the reader — the same
   * arrangement the encyclopedia, topical and bio views already use. `windowId`
   * is what tells the two apart.
   */
  export let selectedText = "";
  export let strongsId: string | undefined = undefined;
  export let morphologyData: any = null;
  export let lexicalEntries: any = null;
  /** Set when docked: the id of the window hosting this word study. */
  export let windowId: string | null = null;
  /** The host's own close. Docked, Window.svelte supplies the ×. */
  export let onClose: (() => void) | null = null;
  /** Which sub-tab was open and how far down, restored when you come back. */
  export let initialTab: "definition" | "forms" | "occurrences" | "arc" | "related" | null = null;
  export let initialScrollTop = 0;
  /** Reports the view on the way out, so switching tabs and coming back lands
   *  where you left rather than at the top. */
  export let onSnapshot: ((snap: { tab: string; scrollTop: number }) => void) | null = null;

  $: docked = !!windowId;

  // A clicked name that resolves to someone opens on the People tab, which is
  // its own view in the same card — this one is only ever the word study now.

  /** Hand what's on screen to a docked window, so it can sit beside the
   *  passage. Same edge convention as the encyclopedia's pop-out — and it pins
   *  whichever of the two views you're looking at. */
  function popOut() {
    const edge = window.innerHeight > window.innerWidth ? "bottom" : "right";
    const id = windowStore.createWindow(edge, 50);
    // At the six-window cap. Leave the card up rather than closing onto nothing.
    if (!id) return;
    // Only the term and the Strong's number go into the window: the rest is
    // re-resolved on mount anyway, and window state is written to storage on
    // every change — no place for a morphology blob.
    windowStore.setWindowContent(id, "wordstudy", {
      selectedText,
      strongsId: strongsId ?? null,
      primaryName: selectedText,
    });
    close();
  }

  let lexiconStore: IndexedDBLexiconStore;
  let strongEntry: StrongEntry | null = null;
  let searchResults: StrongEntry[] = [];
  let loading = false;
  let error = "";
  let activeTab: "definition" | "forms" | "occurrences" | "arc" | "related" = initialTab ?? "definition";
  let bodyEl: HTMLDivElement | null = null;

  onDestroy(() => onSnapshot?.({ tab: activeTab, scrollTop: bodyEl?.scrollTop ?? 0 }));

  // activeTab now belongs to the Strong's view alone
  // (Definition/Occurrences/Related). The English-word view has no tab strip:
  // definitions are all it shows.

  // English lexical data
  let englishWordInfo: WordInfo | null = null;
  let englishPOS: string[] = [];
  let isEnglishWord = false;
  let hasOfflineDefinitions = false;
  let localLexicalEntries: any = null;

  // --- Usage: the Forms and Occurrences tabs ------------------------------
  // Both tabs answer questions about the same set of tagged words, so they share
  // one scan of the morphology store rather than running one apiece.
  let usage: StrongsUsage | null = null;
  let usageLoading = false;
  let usageLoadedFor = "";
  /** Which edition is being studied. Null means all of them at once. */
  let source: string | null = null;
  /** Refs already followed, dimmed on return. Shared by both tabs, since they
   *  are two views of the same verses. */
  let visitedRefs = new Set<string>();
  /** Which inflected form is open. One at a time: the table is the index you
   *  scan, and several open at once buries it. */
  let openForm: string | null = null;

  $: verseUses = usage ? buildVerseUses(usage, source) : [];
  $: formGroups = usage ? buildFormGroups(usage, source) : [];
  $: variantBaseline = usage ? sourcesByTestament(usage) : { OT: [], NT: [] };
  /**
   * A badge says the editions disagree about a verse, which is only a question
   * worth asking when you are looking at all of them. Studying one edition,
   * every row would trivially be "only in" that edition and the badge would
   * become wallpaper.
   */
  $: activeBaseline = source === null ? variantBaseline : { OT: [], NT: [] };
  $: arc = summarizeArc(verseUses);
  /** The picker only earns its row when there is a choice to make. A Hebrew
   *  entry only ever appears in one text. */
  $: showSourcePicker = (usage?.sources.length ?? 0) > 1;
  $: isRtlLanguage = strongEntry?.language === "hebrew" || strongEntry?.language === "aramaic";

  onMount(async () => {
    lexiconStore = new IndexedDBLexiconStore();
    if (initialScrollTop) {
      // Only meaningful once the body has something in it to scroll.
      await tick();
      if (bodyEl) bodyEl.scrollTop = initialScrollTop;
    }
  });

  // Reload whenever the subject changes. Mounted fresh per open today; keyed so
  // it also re-reads when the host swaps the word underneath it.
  let loadedKey = "";
  $: if (lexiconStore) {
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

  // --- Encyclopedia bridge ------------------------------------------------
  // What the other three works have for this term. One resolver answers all of
  // them at once and hands back ids rather than booleans, so a control that
  // lights up is guaranteed to open something. Plural-folded by the shared
  // resolvers underneath; silent when a pack isn't installed.
  let works: WorksResolution | null = null;
  let worksCheckedFor = "";

  /**
   * The term to ask the other three works about.
   *
   * They are all indexed in English — the encyclopedia has "Abraham", not
   * Ἀβραάμ — so on a Strong's entry the word on screen was never going to match
   * anything, and the tab bar sat dead on the one screen most likely to want it.
   * The gloss is the English handle; the transliteration is the fallback for
   * entries that have no gloss.
   */
  $: worksTerm = ((): string => {
    if (!strongsId && !morphologyData) return selectedText;
    const m = morphologyData as any;
    return glossHead(m?.gloss_en ?? m?.gloss ?? "") || strongEntry?.transliteration || m?.transliteration || "";
  })();

  $: if (worksTerm) checkWorks(worksTerm);

  /** Glosses often qualify themselves — "Abraham, the patriarch" — and only the
   *  head word stands a chance of resolving or of being a dictionary entry. */
  function glossHead(gloss: string): string {
    return String(gloss ?? "").split(/[,;(]/)[0].trim();
  }

  /**
   * The gloss is the English word behind the original one, so it behaves like
   * any other English word in the app: tapping it opens the dictionary on it.
   * Clearing the Strong's id is what moves this card off the morphology view.
   */
  function openGloss(gloss: string) {
    const word = glossHead(gloss);
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


  /**
   * The work tabs. This card holds two of the four itself — a word study and,
   * when a clicked name resolved to someone, their bio — so switching between
   * Dictionary and People is a flip in place rather than a second card. Step 3
   * folds that into the shared card and this special case goes away.
   *
   * This card is never docked, so there is no window branch here.
   */
  function selectWork(work: WorkKey) {
    // Nothing closes: the card keeps its frame and swaps the work inside it.
    openWorkSubject(work, works, worksTerm || selectedText, windowId);
  }

  async function loadLexicalData() {
    loading = true;
    error = "";
    strongEntry = null;
    searchResults = [];
    englishWordInfo = null;
    englishPOS = [];
    isEnglishWord = false;
    localLexicalEntries = null;
    activeTab = "definition";
    resetUsage();

    try {
      // Check if we already have lexical entries from the new lookup system
      if (lexicalEntries) {
        console.log('✅ Using lexical entries from lookup system:', lexicalEntries);
        isEnglishWord = true;
        
        // Map lexicalEntries to the format this modal expects
        englishWordInfo = {
          word: lexicalEntries.word,
          ipa_us: lexicalEntries.ipa_us ?? undefined,
        };
        
        // Use POS from lexicalEntries if available
        if (lexicalEntries.pos) {
          englishPOS = Array.isArray(lexicalEntries.pos) ? lexicalEntries.pos : [lexicalEntries.pos];
        }
        
        // Use offline definitions from dictionary pack (NO API CALL)
        if (lexicalEntries.modern && lexicalEntries.modern.length > 0) {
          console.log('✅ Using offline modern definitions:', lexicalEntries.modern.length);
          // Modern definitions will be displayed separately
        }
        
        if (lexicalEntries.historic && lexicalEntries.historic.length > 0) {
          console.log('✅ Using offline historic definitions:', lexicalEntries.historic.length);
          // Historic definitions will be displayed separately
        }
        
        loading = false;
        return;
      }
      
      // If we have morphology data, don't need to load anything - just display it
      if (morphologyData) {
        loading = false;
        return;
      }
      
      if (strongsId) {
        // Use lookupStrongs which queries the correct greek_strongs_entries /
        // hebrew_strongs_entries stores (lexiconStore.getStrong queries the
        // empty legacy 'strongs_entries' store).
        const result = await lookupStrongs(strongsId);
        if (result) {
          // Map LexiconEntry shape to StrongEntry shape the template expects
          strongEntry = {
            id: strongsId,
            lemma: result.lemma ?? '',
            transliteration: result.transliteration ?? '',
            definition: result.definition ?? '',
            shortDefinition: result.shortDefinition ?? '',
            partOfSpeech: result.partOfSpeech ?? '',
            language: (result.language ?? 'greek') as 'greek' | 'hebrew' | 'aramaic',
            derivation: result.derivation,
            kjvUsage: result.kjvUsage,
            pronunciation: result.phonetic ? { phonetic: result.phonetic } : undefined,
          } as StrongEntry;
        } else {
          error = `Strong's ${strongsId} not found in lexicon`;
        }
      } else if (selectedText) {
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
            loading = false;
            return;
          }
        } catch (err) {
          console.log("Offline dictionary lookup failed:", err);
        }

        // First try English lexical lookup
        try {
          await englishLexicalService.initialize();
          englishWordInfo =
            await englishLexicalService.getPronunciation(searchText);

          if (englishWordInfo) {
            isEnglishWord = true;
            englishPOS = await englishLexicalService
              .getPOSTags(searchText)
              .catch(() => []);

            return; // Found English word, no need to search biblical languages
          }
        } catch (err) {
          console.log("English lexical lookup failed:", err);
          // Continue to biblical language search
        }

        // If not found in English, search biblical language lexicons
        searchResults = await lexiconStore.searchDefinition(selectedText);

        if (searchResults.length === 1) {
          strongEntry = searchResults[0];
          searchResults = [];
        } else if (searchResults.length === 0) {
          error = `No lexical entries found for "${selectedText}"`;
        }
      }
    } catch (err) {
      console.error("Error loading lexical data:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      error = `Failed to load lexical data: ${errorMessage}`;
    } finally {
      loading = false;
    }
  }

  function selectEntry(entry: StrongEntry) {
    strongEntry = entry;
    searchResults = [];
  }

  function close() {
    strongEntry = null;
    searchResults = [];
    error = "";
    onClose?.();
  }

  /**
   * Every tagged word carrying this number, in one pass.
   *
   * Both tabs read from the result, and the source picker filters it in memory,
   * so switching editions or tabs never goes back to the database.
   */
  async function loadUsage(id: string) {
    if (usageLoadedFor === id || usageLoading) return;
    usageLoading = true;
    try {
      const found = await loadStrongsUsage(id);
      // A slower scan must not overwrite a word opened since.
      if (strongEntry?.id !== id) return;
      usage = found;
      usageLoadedFor = id;
      source = defaultSource(found.sources);
    } catch (err) {
      console.error("Failed to load Strong's usage:", err);
      usage = { rows: [], sources: [] };
      usageLoadedFor = id;
    } finally {
      usageLoading = false;
    }
  }

  /** Open on the text you are already reading when that is one of the originals,
   *  so the study agrees with the passage beside it. */
  function defaultSource(sources: string[]): string | null {
    if (sources.length < 2) return null;
    const reading = get(navigationStore).translation?.toLowerCase();
    const match = sources.find((s) => s.toLowerCase() === reading);
    return match ?? null;
  }

  /**
   * Follow a verse into the reader.
   *
   * Keeps the translation you are reading rather than forcing the tagged text's
   * own edition on you, and goes through `navigateToVerse` so the verse arrives
   * with the category-coloured fade every other verse list in the app gives you.
   */
  function handleVerseClick(use: VerseUse) {
    visitedRefs = new Set(visitedRefs).add(refKey(use));
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    navigationStore.navigateToVerse(current.translation, use.book, use.chapter, use.verse);
    // Docked, the study stays put beside the passage you just jumped to.
    if (!docked) close();
  }

  /** Everything the usage tabs hold about one number, forgotten. Following a
   *  Strong's link swaps the word without going back through `loadLexicalData`,
   *  so without this the previous word's verses stay on screen under the new
   *  word's heading until the fresh scan lands. */
  function resetUsage() {
    usage = null;
    usageLoadedFor = "";
    source = null;
    visitedRefs = new Set();
    openForm = null;
  }

  async function loadStrongsEntry(strongsNum: string) {
    loading = true;
    error = "";
    strongEntry = null;
    resetUsage();
    const result = await lookupStrongs(strongsNum);
    if (result) {
      strongEntry = {
        id: strongsNum,
        lemma: result.lemma ?? '',
        transliteration: result.transliteration ?? '',
        definition: result.definition ?? '',
        shortDefinition: result.shortDefinition ?? '',
        partOfSpeech: result.partOfSpeech ?? '',
        language: (result.language ?? 'greek') as 'greek' | 'hebrew' | 'aramaic',
        derivation: result.derivation,
        kjvUsage: result.kjvUsage,
        pronunciation: result.phonetic ? { phonetic: result.phonetic } : undefined,
      } as StrongEntry;
    } else {
      error = `Strong's ${strongsNum} not found in lexicon`;
    }
    loading = false;
  }

  // One scan serves Forms and Occurrences, so it starts as soon as either is
  // asked for and neither waits on the other afterwards.
  $: if ((activeTab === "forms" || activeTab === "occurrences" || activeTab === "arc") && strongEntry) {
    loadUsage(strongEntry.id);
  }

  /** Parsing in words. Hebrew and Aramaic are coded differently from Greek. */
  function parseOf(morphCode: string): string {
    return isRtlLanguage ? expandOshbCode(morphCode) : expandRmacCode(morphCode);
  }

  function toggleForm(key: string) {
    openForm = openForm === key ? null : key;
  }

  function getLanguageColor(lang: string): string {
    switch (lang) {
      case "greek":
        return "#4CAF50";
      case "hebrew":
        return "#2196F3";
      case "aramaic":
        return "#9C27B0";
      default:
        return "#757575";
    }
  }

  /** "greek" -> "Greek". Same title-casing IsbeContent does for place types. */
  function titleCase(t: string): string {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  /**
   * The grey line under the title. Encyclopedia and Topical both read as
   * "what it is  ·  how many", and this mirrors them so the three headers sit
   * at the same height. Each part is guarded, so a lexicon row missing its
   * transliteration drops that piece instead of leaving a stray separator.
   * Branches match the title's own branches in the header markup.
   */
  $: headerSubtitle = ((): string => {
    const bits: string[] = [];
    if (strongEntry) {
      bits.push(titleCase(strongEntry.language));
      if (strongEntry.transliteration) bits.push(strongEntry.transliteration);
      if (strongEntry.partOfSpeech) bits.push(strongEntry.partOfSpeech);
    } else if (isEnglishWord && englishWordInfo) {
      bits.push("Dictionary");
      if (englishPOS.length) bits.push(englishPOS.join(", "));
    } else if (searchResults.length) {
      bits.push(plural(searchResults.length, "result"));
    }
    return bits.join("  ·  ");
  })();

  /**
   * Convert SWORD/Thayer markup to safe HTML for {@html} rendering.
   * Handles: <b>, <i>, <BR />, <ref='...'>, __ numbered items.
   * Any other tags are stripped.
   */
  function renderStrongsMarkup(text: string): string {
    if (!text) return "";
    return text
      // Bold and italic pass-through
      .replace(/<b>([\s\S]*?)<\/b>/gi, "<strong>$1</strong>")
      .replace(/<i>([\s\S]*?)<\/i>/gi, "<em>$1</em>")
      // Line breaks (various SWORD spellings)
      .replace(/<BR\s*\/>/gi, "<br>")
      // Scripture refs → clickable buttons
      .replace(
        /<ref='([^']+)'>([\s\S]*?)<\/ref>/gi,
        '<button class="scripture-ref" data-ref="$1">$2</button>',
      )
      // Numbered items: __ at start of a segment → indented block
      .replace(/(^|\n|<br>)__(\d+\.)/g, '$1<span class="strongs-item">$2</span> ')
      // Strip any remaining unknown tags
      .replace(/<(?!\/?(strong|em|br|button|span)[^>]*>)[^>]+>/gi, "");
  }

  /** Handle clicks on rendered Strong's markup — catches scripture-ref buttons. */
  function handleDefinitionClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("scripture-ref")) return;
    const osisRef = target.dataset.ref;
    if (!osisRef) return;
    const parsed = parseOsisRef(osisRef);
    if (!parsed) return;
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    // navigateToVerse, not navigateTo: a scripture reference followed out of a
    // definition should land with the same fade highlight every other verse link
    // in the app gives you.
    navigationStore.navigateToVerse(current.translation, parsed.book, parsed.chapter, parsed.verse);
    // Docked, the study stays put — reading the passage beside it is the whole
    // point of pinning it. Only a card has to get out of the way.
    if (!docked) close();
  }
</script>

<div class="lexical-content" class:docked>
  <WorkTabs
    {works}
    current="dictionary"
    inWindow={docked}
    onSelect={selectWork}
  />
  <div class="modal-header">
    <div class="head-text">
      <h2>
        {#if strongEntry}
          {strongEntry.lemma}
          <span
            class="strongs-id"
            style="color: {getLanguageColor(strongEntry.language)}"
          >
            {strongEntry.id}
          </span>
        {:else if selectedText}
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
    {:else if morphologyData && !strongEntry}
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
                  style="color: {getLanguageColor(morphologyData.language)}"
                  on:click={() => loadStrongsEntry(morphologyData!.strongsId!)}
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
                  title="Look up “{glossHead(gloss)}” in the dictionary"
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
              <span style="color: {getLanguageColor(morphologyData.language)}">
                {morphologyData.language.charAt(0).toUpperCase() + morphologyData.language.slice(1)}
              </span>
            </dd>
          </dl>
        </div>

        {#if morphologyData.strongsId}
          <div class="hint-section">
            <p class="hint">
              <span class="emoji">💡</span> Click Strong's number above to view full lexicon entry
            </p>
          </div>
        {/if}
      </div>
    {:else if searchResults.length > 0}
      <div class="search-results">
        <p class="results-header">Found {searchResults.length} entries:</p>
        <div class="results-list">
          {#each searchResults as result}
            <button
              class="result-item"
              on:click={() => selectEntry(result)}
            >
              <div class="result-lemma">
                {result.lemma}
                <span
                  class="result-id"
                  style="color: {getLanguageColor(result.language)}"
                >
                  {result.id}
                </span>
              </div>
              <div class="result-definition">
                {result.shortDefinition || result.definition.slice(0, 100)}
              </div>
            </button>
          {/each}
        </div>
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
                  <p style="margin-top: 12px; padding: 12px; background: #e3f2fd; border-radius: 8px; font-size: 13px;">
                    <span class="emoji">💡</span> Install the <strong>English Dictionary Pack</strong> from the Packs menu to get offline modern and historic (Webster 1913) definitions!
                  </p>
                {/if}
              </div>
            {/if}
          </div>
      </div>
    {:else if strongEntry}
      {#if morphologyData}
        <button class="back-btn" on:click={() => (strongEntry = null)}>← Back to Morphology</button>
      {/if}
      <div class="tabs">
        <button
          class="tab"
          class:active={activeTab === "definition"}
          on:click={() => (activeTab = "definition")}
        >
          Definition
        </button>
        <button
          class="tab"
          class:active={activeTab === "forms"}
          on:click={() => (activeTab = "forms")}
        >
          Forms
        </button>
        <button
          class="tab"
          class:active={activeTab === "occurrences"}
          on:click={() => (activeTab = "occurrences")}
        >
          Occurrences
        </button>
        <button class="tab" class:active={activeTab === "arc"} on:click={() => (activeTab = "arc")}>
          Arc
        </button>
        <button
          class="tab"
          class:active={activeTab === "related"}
          on:click={() => (activeTab = "related")}
        >
          Related
        </button>
      </div>

      <div class="tab-content">
        <!-- Which text is being studied. Sits above the pane rather than inside
             each tab, so switching between Forms and Occurrences keeps the
             control in one place and the choice applies to both. -->
        {#if showSourcePicker && (activeTab === "forms" || activeTab === "occurrences")}
          <div class="source-picker" role="group" aria-label="Source text">
            {#each usage?.sources ?? [] as s (s)}
              <button class="src" class:active={source === s} on:click={() => (source = s)}>
                {s.toUpperCase()}
              </button>
            {/each}
            <button class="src" class:active={source === null} on:click={() => (source = null)}>
              All
            </button>
          </div>
        {/if}
        {#if activeTab === "definition"}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="definition-view" on:click={handleDefinitionClick}>
            <div class="info-section">
              <h3>Entry Information</h3>
              <dl>
                <dt>Strong's ID:</dt>
                <dd style="color: {getLanguageColor(strongEntry.language)}">
                  {strongEntry.id}
                </dd>

                <dt>Lemma:</dt>
                <dd class="lemma-text">{strongEntry.lemma}</dd>

                {#if strongEntry.transliteration}
                  <dt>Transliteration:</dt>
                  <dd>{strongEntry.transliteration}</dd>
                {/if}

                {#if strongEntry.pronunciation?.phonetic}
                  <dt>Pronunciation:</dt>
                  <dd class="phonetic">{strongEntry.pronunciation.phonetic}</dd>
                {/if}

                <dt>Language:</dt>
                <dd
                  style="color: {getLanguageColor(
                    strongEntry.language,
                  )}; text-transform: capitalize;"
                >
                  {strongEntry.language}
                </dd>

                {#if strongEntry.partOfSpeech}
                  <dt>Part of Speech:</dt>
                  <dd>
                    {expandStepBiblePOS(strongEntry.partOfSpeech)}
                    <span class="code-raw">({strongEntry.partOfSpeech})</span>
                  </dd>
                {/if}

                <!-- No occurrence count here: the lexicon lookup never fills
                     `occurrences`, so this row only ever rendered as nothing.
                     The Occurrences tab counts the real verses instead. -->
              </dl>
            </div>

            {#if strongEntry.shortDefinition}
              <div class="info-section">
                <h3>Short Definition</h3>
                <p class="short-def">{strongEntry.shortDefinition}</p>
              </div>
            {/if}

            <div class="info-section">
              <h3>Full Definition</h3>
              <p class="full-def">{@html renderStrongsMarkup(strongEntry.definition)}</p>
            </div>

            {#if strongEntry.kjvUsage}
              <div class="info-section">
                <h3>KJV Usage</h3>
                <p class="usage">{@html renderStrongsMarkup(strongEntry.kjvUsage)}</p>
              </div>
            {/if}

            {#if strongEntry.derivation}
              <div class="info-section">
                <h3>Derivation</h3>
                <p class="derivation">{@html renderStrongsMarkup(strongEntry.derivation)}</p>
              </div>
            {/if}

          </div>
        {:else if activeTab === "forms"}
          <div class="usage-view">
            {#if usageLoading}
              <p class="hint">Loading forms…</p>
            {:else if formGroups.length === 0}
              <p class="coming-soon">No tagged forms found in the installed texts.</p>
            {:else}
              <p class="usage-count">
                {formGroups.length} form{formGroups.length === 1 ? "" : "s"}
              </p>
              <div class="forms">
                {#each formGroups as f (f.key)}
                  <div class="form-group">
                    <button class="form-row" on:click={() => toggleForm(f.key)}>
                      <span class="form-caret">{openForm === f.key ? "▼" : "▶"}</span>
                      <span class="form-text" dir={isRtlLanguage ? "rtl" : "ltr"}>{f.form}</span>
                      <span class="form-parse">{parseOf(f.morphCode)}</span>
                      <span class="form-count">{f.count}</span>
                    </button>
                    {#if openForm === f.key}
                      <div class="form-verses">
                        <StrongsVerseList
                          uses={f.uses}
                          rtl={isRtlLanguage}
                          variantBaseline={activeBaseline}
                          visited={visitedRefs}
                          onNavigate={handleVerseClick}
                        />
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeTab === "occurrences"}
          <div class="usage-view">
            {#if usageLoading}
              <p class="hint">Loading occurrences…</p>
            {:else if verseUses.length === 0}
              <p class="coming-soon">No occurrences found in the installed texts.</p>
            {:else}
              <p class="usage-count">
                {verseUses.length} verse{verseUses.length === 1 ? "" : "s"}
              </p>
              <StrongsVerseList
                uses={verseUses}
                rtl={isRtlLanguage}
                variantBaseline={activeBaseline}
                visited={visitedRefs}
                onNavigate={handleVerseClick}
              />
            {/if}
          </div>
        {:else if activeTab === "arc"}
          <div class="usage-view">
            {#if usageLoading}
              <p class="hint">Loading…</p>
            {:else if arc.first && arc.last}
              <!-- Bound once here so the click handlers close over a verse that
                   is known to exist, rather than re-reading a nullable field
                   whenever they happen to fire. -->
              {@const first = arc.first}
              {@const last = arc.last}
              {#if arc.hapax}
                <p class="hapax">
                  <strong>Hapax legomenon</strong> — used once in the whole of the
                  text installed. Everything this word means rests on one verse.
                </p>
              {/if}
              <dl class="arc">
                <dt>Reach</dt>
                <dd>
                  {arc.total} verse{arc.total === 1 ? "" : "s"} across
                  {arc.books} book{arc.books === 1 ? "" : "s"}
                </dd>
                <dt>First</dt>
                <dd>
                  <button class="arc-ref" on:click={() => handleVerseClick(first)}>
                    {refKey(first)}
                  </button>
                </dd>
                <dt>Last</dt>
                <dd>
                  <button class="arc-ref" on:click={() => handleVerseClick(last)}>
                    {refKey(last)}
                  </button>
                </dd>
                {#if arc.busiest}
                  <dt>Densest</dt>
                  <dd>
                    <span style="color:{getBookColor(arc.busiest.book)}">{arc.busiest.book}</span>
                    <span class="arc-dim">({arc.busiest.count})</span>
                  </dd>
                {/if}
              </dl>
              <!-- Only when a word actually reaches both. How the Septuagint uses
                   a word against how the New Testament does is the comparison
                   that makes a Greek word study worth doing. -->
              {#each arc.spans as span (span.testament)}
                <div class="arc-span">
                  <h3>{span.label}</h3>
                  <dl class="arc">
                    <dt>Reach</dt>
                    <dd>
                      {span.total} verse{span.total === 1 ? "" : "s"} across
                      {span.books} book{span.books === 1 ? "" : "s"}
                    </dd>
                    <dt>First</dt>
                    <dd>
                      <button class="arc-ref" on:click={() => handleVerseClick(span.first)}>
                        {refKey(span.first)}
                      </button>
                    </dd>
                    <dt>Last</dt>
                    <dd>
                      <button class="arc-ref" on:click={() => handleVerseClick(span.last)}>
                        {refKey(span.last)}
                      </button>
                    </dd>
                  </dl>
                </div>
              {/each}
            {:else}
              <p class="coming-soon">No occurrences found in the installed texts.</p>
            {/if}
          </div>
        {:else if activeTab === "related"}
          <div class="related-view">
            <p class="coming-soon">Related words coming soon...</p>
            <p class="hint">
              This will show cognates and related concepts
            </p>
          </div>
        {/if}
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
    gap: 12px;
    padding: 16px 18px 10px;
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
    font-size: 20px;
    line-height: 1.15;
    /* Only split a word that genuinely cannot fit; `anywhere` broke mid-word as
       soon as the column got tight, stacking long words one letter per line. */
    overflow-wrap: break-word;
    color: var(--text-color, #fff);
  }

  .head-text .sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted, #999);
  }

  /* The h2 is normal inline flow now (it used to be its own flex row), so the
     badge needs its own gap rather than inheriting one. */
  .strongs-id {
    display: inline-block;
    margin-left: 10px;
    font-size: 15px;
    font-weight: 500;
    padding: 2px 9px;
    background: rgba(76, 175, 80, 0.1);
    border-radius: 6px;
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

  .search-results {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .results-header {
    font-size: 16px;
    color: #888;
    margin: 0;
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 16px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  }

  .result-item:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: #4caf50;
  }

  .result-lemma {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .result-id {
    font-size: 14px;
    padding: 2px 8px;
    background: rgba(76, 175, 80, 0.1);
    border-radius: 4px;
  }

  .result-definition {
    font-size: 14px;
    color: #aaa;
  }

  /* Mirrors the Encyclopedia/Topical tab strip. Those wrap rather than scroll
     when narrow, which keeps every tab reachable on a phone. */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-bottom: 1px solid var(--border-color, #333);
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #999);
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    white-space: nowrap;
  }

  .tab:hover {
    color: var(--text-color, #fff);
  }

  .tab.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
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

  .back-btn {
    background: none;
    border: none;
    color: var(--color-primary, #4a90e2);
    cursor: pointer;
    font-size: 14px;
    padding: 0 0 12px 0;
    text-decoration: underline;
    display: block;
  }

  .back-btn:hover {
    opacity: 0.75;
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

  .short-def {
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-color, #fff);
    margin: 0;
    padding: 16px;
    background: rgba(76, 175, 80, 0.1);
    border-left: 4px solid #4caf50;
    border-radius: 4px;
  }

  .full-def,
  .usage,
  .derivation {
    font-size: 15px;
    line-height: 1.8;
    color: #ccc;
    margin: 0;
  }

  /* Scripture reference links rendered inside Strong's definitions */
  :global(.scripture-ref) {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: inherit;
    line-height: inherit;
    color: var(--color-primary, #4a90e2);
    text-decoration: underline;
    cursor: pointer;
    display: inline;
  }

  :global(.scripture-ref:hover) {
    opacity: 0.8;
  }

  /* Indented numbered items: __1. __2. */
  :global(.strongs-item) {
    display: inline-block;
    font-weight: 600;
    margin-right: 2px;
  }

  .usage-view,
  .related-view {
    display: flex;
    flex-direction: column;
    padding: 20px;
    gap: 12px;
  }

  .usage-count {
    font-size: 13px;
    color: var(--text-muted, #888);
    margin: 0;
  }

  /* --- Source picker ------------------------------------------------------
     Which of the installed original texts the counts and lists describe. Shown
     only when more than one has this word, so a Hebrew study never grows a
     one-button row. */
  .source-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 12px 20px 0;
  }

  .src {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 4px;
    color: var(--text-muted, #9aa0aa);
    cursor: pointer;
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.03em;
    padding: 3px 9px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .src:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-color, #dfe2e8);
  }

  .src.active {
    background: color-mix(in srgb, var(--color-primary, #4a90e2) 18%, transparent);
    border-color: var(--color-primary, #4a90e2);
    color: var(--color-primary, #4a90e2);
  }

  .phonetic {
    font-family: monospace;
    font-size: 0.95em;
    color: var(--text-muted, #aaa);
    letter-spacing: 0.03em;
  }

  /* --- Forms tab ----------------------------------------------------------
     A row per inflected form, opening onto the verses that use it. Was a table;
     it became rows because a table cell is a poor place to hang a verse list. */
  .forms {
    display: flex;
    flex-direction: column;
  }

  .form-group {
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .form-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-color, #dfe2e8);
    cursor: pointer;
    font-family: inherit;
    padding: 7px 4px;
    text-align: left;
  }

  .form-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .form-caret {
    font-size: 10px;
    color: var(--text-muted, #9aa0aa);
  }

  .form-text {
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    font-size: 15px;
  }

  .form-parse {
    flex: 1;
    color: var(--text-secondary, #ccc);
    font-size: 12px;
  }

  /* Verses, not raw hits — so it agrees with the list it opens onto. */
  .form-count {
    color: var(--text-muted, #888);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    white-space: nowrap;
  }

  .form-verses {
    padding: 0 0 8px 20px;
  }

  .related-view {
    align-items: center;
    padding: 60px 20px;
  }

  /* --- Arc tab ------------------------------------------------------------ */
  .hapax {
    background: color-mix(in srgb, #fde047 12%, transparent);
    border: 1px solid color-mix(in srgb, #fde047 35%, transparent);
    border-radius: 6px;
    color: #e4e7ec;
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
    padding: 9px 11px;
  }

  .hapax strong {
    color: #fde047;
  }

  dl.arc {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    align-items: baseline;
  }

  dl.arc dt {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  dl.arc dd {
    margin: 0;
    font-size: 13.5px;
  }

  .arc-ref {
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: 13.5px;
    color: var(--color-primary, #4a90e2);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .arc-ref:hover {
    text-decoration-style: solid;
  }

  .arc-dim {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
  }

  .arc-span {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding-top: 12px;
  }

  .arc-span h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color, #dfe2e8);
  }

  .ipa-text {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 18px;
    color: #4caf50;
  }

  .loading-inline {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    color: #888;
  }

  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(76, 175, 80, 0.2);
    border-top-color: #4caf50;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .definition-list {
    margin: 0;
    padding-left: 24px;
    color: var(--text-color, #fff);
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

  .definition-list li {
    margin-bottom: 16px;
    line-height: 1.6;
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

  .example-text em {
    font-style: italic;
    color: #ccc;
  }

  .coming-soon {
    font-size: 18px;
    color: #888;
    margin: 0;
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

</style>
