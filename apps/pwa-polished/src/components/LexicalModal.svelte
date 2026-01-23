<script lang="ts">
  import { onMount } from "svelte";
  import { IndexedDBLexiconStore } from "../adapters/LexiconStore";
  import type { StrongEntry } from "@projectbible/core";
  import {
    englishLexicalService,
    type WordInfo,
  } from "../../../../packages/core/src/search/englishLexicalService";
  import { lexicalModalStore } from "../stores/lexicalModalStore";

  // Subscribe to store instead of using props
  $: isOpen = $lexicalModalStore.isOpen;
  $: selectedText = $lexicalModalStore.selectedText;
  $: strongsId = $lexicalModalStore.strongsId;
  $: morphologyData = $lexicalModalStore.morphologyData;
  $: lexicalEntries = $lexicalModalStore.lexicalEntries;

  let lexiconStore: IndexedDBLexiconStore;
  let strongEntry: StrongEntry | null = null;
  let searchResults: StrongEntry[] = [];
  let loading = false;
  let error = "";
  let activeTab: "definition" | "occurrences" | "related" = "definition";

  // English lexical data
  let englishWordInfo: WordInfo | null = null;
  let englishSynonyms: string[] = [];
  let englishPOS: string[] = [];
  let englishDefinitions: any[] = [];
  let isEnglishWord = false;
  let loadingDefinition = false;

  onMount(() => {
    lexiconStore = new IndexedDBLexiconStore();
  });

  $: if (isOpen && lexiconStore) {
    loadLexicalData();
  }

  async function loadLexicalData() {
    loading = true;
    error = "";
    strongEntry = null;
    searchResults = [];
    englishWordInfo = null;
    englishSynonyms = [];
    englishPOS = [];
    englishDefinitions = [];
    isEnglishWord = false;
    loadingDefinition = false;

    try {
      // Check if we already have lexical entries from the new lookup system
      if (lexicalEntries) {
        console.log('✅ Using lexical entries from lookup system:', lexicalEntries);
        isEnglishWord = true;
        
        // Map lexicalEntries to the format this modal expects
        englishWordInfo = {
          word: lexicalEntries.word,
          ipa_us: lexicalEntries.ipa_us,
          ipa_uk: lexicalEntries.ipa_uk,
        };
        
        // Use POS from lexicalEntries if available
        if (lexicalEntries.pos) {
          englishPOS = Array.isArray(lexicalEntries.pos) ? lexicalEntries.pos : [lexicalEntries.pos];
        }
        
        if (lexicalEntries.synonyms && lexicalEntries.synonyms.length > 0) {
          englishSynonyms = lexicalEntries.synonyms;
        }
        
        if (lexicalEntries.antonyms && lexicalEntries.antonyms.length > 0) {
          // Store antonyms (TODO: display in UI)
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
        // Direct Strong's lookup for biblical languages
        strongEntry = await lexiconStore.getStrong(strongsId);
        if (!strongEntry) {
          error = `Strong's ${strongsId} not found in lexicon`;
        }
      } else if (selectedText) {
        const searchText = selectedText.trim().toLowerCase();

        // First try English lexical lookup
        try {
          await englishLexicalService.initialize();
          englishWordInfo =
            await englishLexicalService.getPronunciation(searchText);

          if (englishWordInfo) {
            isEnglishWord = true;
            // Get additional data in parallel
            let [synonyms, posTags, verbForm] = await Promise.all([
              englishLexicalService.getSynonyms(searchText).catch(() => []),
              englishLexicalService.getPOSTags(searchText).catch(() => []),
              englishLexicalService.getVerbForms(searchText).catch(() => null),
            ]);

            englishSynonyms = synonyms;
            englishPOS = posTags;

            // If no synonyms found, try the base form
            if (englishSynonyms.length === 0) {
              // Try removing common suffixes to get base form
              const baseFormAttempts = [
                searchText.replace(/ed$/, ""), // surpassed -> surpass
                searchText.replace(/ing$/, ""), // running -> runn
                searchText.replace(/s$/, ""), // runs -> run
                searchText.replace(/es$/, ""), // matches -> match
                searchText.replace(/ied$/, "y"), // studied -> study
              ];

              // If we have verb form data, use that
              if (verbForm?.base_form) {
                baseFormAttempts.unshift(verbForm.base_form);
              }

              // Try each base form until we find synonyms
              for (const baseForm of baseFormAttempts) {
                if (baseForm !== searchText && baseForm.length > 2) {
                  const baseSynonyms = await englishLexicalService
                    .getSynonyms(baseForm)
                    .catch(() => []);
                  if (baseSynonyms.length > 0) {
                    englishSynonyms = baseSynonyms;
                    break;
                  }
                }
              }
            }

            // Fetch definition from free dictionary API
            loadingDefinition = true;
            try {
              const response = await fetch(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${searchText}`,
              );
              if (response.ok) {
                englishDefinitions = await response.json();
              }
            } catch (err) {
              console.log("Dictionary API failed:", err);
            } finally {
              loadingDefinition = false;
            }

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
    lexicalModalStore.close();
    strongEntry = null;
    searchResults = [];
    error = "";
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
  }

  async function loadStrongsEntry(strongsNum: string) {
    // Clear morphology data and load the Strong's entry
    morphologyData = null;
    strongsId = strongsNum;
    selectedText = "";
    await loadLexicalData();
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
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    on:click={handleBackdropClick}
    role="presentation"
  >
    <div class="modal-container">
      <div class="modal-header">
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
            Lexical Study: {selectedText}
          {:else}
            Word Study
          {/if}
        </h2>
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
      </div>

      <div class="modal-body">
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
                    {#if morphologyData.lemma && !/^\d+$/.test(morphologyData.lemma)}
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

                <dt>English Gloss:</dt>
                {#if morphologyData.gloss_en}
                  <dd class="gloss">{morphologyData.gloss_en}</dd>
                {:else}
                  <dd class="missing-data">Not available in legacy pack</dd>
                {/if}

                {#if morphologyData.morph_code}
                  <dt>Parsing:</dt>
                  <dd class="parsing">{morphologyData.morph_code}</dd>
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
          <!-- English Word Information -->
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
              class:active={activeTab === "related"}
              on:click={() => (activeTab = "related")}
            >
              Synonyms ({englishSynonyms.length})
            </button>
          </div>

          <div class="tab-content">
            {#if activeTab === "definition"}
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

                {#if loadingDefinition}
                  <div class="info-section">
                    <div class="loading-inline">
                      <div class="spinner-small"></div>
                      <span>Loading definition...</span>
                    </div>
                  </div>
                {/if}

                {#if englishDefinitions.length > 0}
                  {#each englishDefinitions as entry}
                    {#each entry.meanings || [] as meaning}
                      <div class="info-section">
                        <h3 style="text-transform: capitalize;">
                          {meaning.partOfSpeech}
                        </h3>
                        <ol class="definition-list">
                          {#each meaning.definitions || [] as def}
                            <li>
                              <p class="definition-text">{def.definition}</p>
                              {#if def.example}
                                <p class="example-text">
                                  "<em>{def.example}</em>"
                                </p>
                              {/if}
                              {#if def.synonyms && def.synonyms.length > 0}
                                <p class="inline-synonyms">
                                  <strong>Similar:</strong>
                                  {def.synonyms.slice(0, 5).join(", ")}
                                </p>
                              {/if}
                            </li>
                          {/each}
                        </ol>
                      </div>
                    {/each}
                  {/each}
                {/if}

                {#if lexicalEntries && (lexicalEntries.modern?.length > 0 || lexicalEntries.historic?.length > 0)}
                  <!-- Offline Dictionary Definitions from Dictionary Pack -->
                  
                  <!-- Modern Definitions (Wiktionary) -->
                  <div class="info-section">
                    <h3 style="color: #4a90e2; display: flex; align-items: center; gap: 8px;">
                      <span class="emoji">📖</span> Modern Definitions
                      <span style="font-size: 12px; color: #666; font-weight: normal;">Wiktionary</span>
                    </h3>
                    {#if lexicalEntries.modern && lexicalEntries.modern.length > 0}
                      {#each lexicalEntries.modern as def, idx}
                        <div class="modern-def" style="margin-bottom: 16px;">
                          <div style="display: flex; gap: 8px; align-items: start; margin-bottom: 4px;">
                            {#if def.sense_number}
                              <span class="sense-badge">{def.sense_number}</span>
                            {/if}
                            {#if def.pos}
                              <span class="pos-pill" style="background: #e3f2fd; color: #1976d2; padding: 2px 8px; border-radius: 12px; font-size: 11px; text-transform: capitalize;">
                                {def.pos}
                              </span>
                            {/if}
                            {#if def.tags}
                              {#each def.tags.split(',') as tag}
                                <span class="tag-chip" style="background: {tag.includes('archaic') ? '#d7ccc8' : tag.includes('slang') ? '#e1bee7' : tag.includes('formal') ? '#c5cae9' : '#e0e0e0'}; padding: 2px 6px; border-radius: 10px; font-size: 10px;">
                                  {tag.trim()}
                                </span>
                              {/each}
                            {/if}
                          </div>
                          <p class="definition-text" style="margin: 4px 0 4px 24px;">{def.definition}</p>
                          {#if def.example}
                            <p class="example-text" style="margin: 4px 0 4px 24px; color: #666; font-style: italic; font-size: 14px;">
                              "{def.example}"
                            </p>
                          {/if}
                          {#if def.etymology && idx === 0}
                            <details style="margin: 8px 0 0 24px; font-size: 13px; color: #555;">
                              <summary style="cursor: pointer; user-select: none; font-weight: 500;">Etymology</summary>
                              <p style="margin: 4px 0; padding-left: 12px;">{def.etymology}</p>
                              {#if def.raw_etymology && def.raw_etymology !== def.etymology}
                                <details style="margin: 4px 0; padding-left: 12px;">
                                  <summary style="cursor: pointer; font-size: 12px; color: #777;">Show full chain</summary>
                                  <p style="margin: 4px 0; font-size: 12px; color: #666;">{def.raw_etymology}</p>
                                </details>
                              {/if}
                            </details>
                          {/if}
                        </div>
                      {/each}
                    {:else}
                      <p class="definition-text" style="margin: 6px 0 0; color: #777; font-size: 13px;">
                        No modern definitions available for this word.
                      </p>
                    {/if}
                  </div>
                  
                  <!-- Historic Definitions (GCIDE/Webster 1913) -->
                  <div class="info-section">
                    <h3 style="color: #8d6e63; display: flex; align-items: center; gap: 8px;">
                      <span class="emoji">📜</span> Historic Definitions
                      <span style="font-size: 12px; color: #666; font-weight: normal;">Webster 1913</span>
                    </h3>
                    {#if lexicalEntries.historic && lexicalEntries.historic.length > 0}
                      {#each lexicalEntries.historic as def}
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
                {/if}

                {#if !loadingDefinition && englishDefinitions.length === 0 && (!lexicalEntries || (lexicalEntries.modern?.length === 0 && lexicalEntries.historic?.length === 0))}
                  <!-- No offline definitions available -->
                  <div class="info-section">
                    <h3>About This Word</h3>
                    <p class="full-def">
                      This is an English word from the Bible translation.
                      {#if englishSynonyms.length > 0}
                        See the Synonyms tab for {englishSynonyms.length} related words.
                      {:else}
                        For deeper study, look up the original Greek or Hebrew word from an interlinear Bible.
                      {/if}
                    </p>
                    <p style="margin-top: 12px; padding: 12px; background: #e3f2fd; border-radius: 8px; font-size: 13px;">
                      <span class="emoji">💡</span> Install the <strong>English Dictionary Pack</strong> from the Packs menu to get 6M+ offline definitions from Wiktionary + Webster 1913!
                    </p>
                  </div>
                {/if}
              </div>
            {:else if activeTab === "related"}
              <div class="related-view">
                {#if englishSynonyms.length > 0}
                  <div class="synonyms-section">
                    <h3>Synonyms</h3>
                    <div class="synonym-grid">
                      {#each englishSynonyms as synonym}
                        <span class="synonym-tag">{synonym}</span>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <p class="coming-soon">No synonyms available for this word</p>
                {/if}
              </div>
            {/if}
          </div>
        {:else if strongEntry}
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
              class:active={activeTab === "occurrences"}
              on:click={() => (activeTab = "occurrences")}
            >
              Occurrences
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
            {#if activeTab === "definition"}
              <div class="definition-view">
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

                    {#if strongEntry.pronunciation}
                      <dt>Pronunciation:</dt>
                      <dd>{strongEntry.pronunciation}</dd>
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
                      <dd>{strongEntry.partOfSpeech}</dd>
                    {/if}
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
                  <p class="full-def">{strongEntry.definition}</p>
                </div>

                {#if strongEntry.kjvUsage}
                  <div class="info-section">
                    <h3>KJV Usage</h3>
                    <p class="usage">{strongEntry.kjvUsage}</p>
                  </div>
                {/if}

                {#if strongEntry.derivation}
                  <div class="info-section">
                    <h3>Derivation</h3>
                    <p class="derivation">{strongEntry.derivation}</p>
                  </div>
                {/if}
              </div>
            {:else if activeTab === "occurrences"}
              <div class="occurrences-view">
                <p class="coming-soon">Occurrence data coming soon...</p>
                <p class="hint">
                  This will show where this word appears in Scripture
                </p>
              </div>
            {:else if activeTab === "related"}
              <div class="related-view">
                <p class="coming-soon">Related words coming soon...</p>
                <p class="hint">
                  This will show synonyms, antonyms, and related concepts
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
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal-container {
    background: var(--background-color, #1e1e1e);
    border-radius: 12px;
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24px;
    border-bottom: 1px solid var(--border-color, #333);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: var(--text-color, #fff);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .strongs-id {
    font-size: 18px;
    font-weight: 500;
    padding: 4px 12px;
    background: rgba(76, 175, 80, 0.1);
    border-radius: 6px;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-color, #fff);
    cursor: pointer;
    padding: 8px;
    border-radius: 6px;
    transition: background-color 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
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

  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border-color, #333);
    margin-bottom: 24px;
  }

  .tab {
    background: none;
    border: none;
    color: #888;
    padding: 12px 24px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab:hover {
    color: var(--text-color, #fff);
  }

  .tab.active {
    color: #4caf50;
    border-bottom-color: #4caf50;
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
    font-family: system-ui, sans-serif;
  }

  .missing-data {
    color: #888;
    font-style: italic;
  }

  .gloss {
    font-size: 16px;
    color: #8bc34a;
  }

  .parsing {
    font-family: monospace;
    font-size: 14px;
    color: #999;
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

  .occurrences-view,
  .related-view {
    display: flex;
    flex-direction: column;
    padding: 20px;
    gap: 16px;
  }

  .related-view:has(.synonyms-section) {
    align-items: flex-start;
    padding: 20px;
  }

  .related-view:not(:has(.synonyms-section)) {
    align-items: center;
    padding: 60px 20px;
  }

  .synonyms-section {
    width: 100%;
  }

  .synonyms-section h3 {
    margin: 0 0 16px 0;
    font-size: 18px;
    font-weight: 600;
    color: #4caf50;
  }

  .synonym-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .synonym-tag {
    padding: 8px 16px;
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid rgba(76, 175, 80, 0.3);
    border-radius: 20px;
    font-size: 14px;
    color: #8bc34a;
    transition: all 0.2s;
  }

  .synonym-tag:hover {
    background: rgba(76, 175, 80, 0.2);
    border-color: rgba(76, 175, 80, 0.5);
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

  .inline-synonyms {
    margin: 8px 0 0 0;
    font-size: 13px;
    color: #888;
  }

  .inline-synonyms strong {
    color: #4caf50;
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

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .modal-container {
      max-width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }

    .info-section dl {
      grid-template-columns: 120px 1fr;
      gap: 8px 12px;
    }

    .tabs {
      overflow-x: auto;
    }

    .tab {
      padding: 12px 16px;
      font-size: 14px;
      white-space: nowrap;
    }
  }
</style>
