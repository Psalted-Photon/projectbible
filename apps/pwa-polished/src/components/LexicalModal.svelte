<script lang="ts">
  import { onMount } from "svelte";
  import { IndexedDBLexiconStore } from "../adapters/LexiconStore";
  import type { StrongEntry } from "@projectbible/core";
  import {
    englishLexicalService,
    type WordInfo,
  } from "../../../../packages/core/src/search/englishLexicalService";

  export let isOpen = false;
  export let selectedText = "";
  export let strongsId: string | undefined = undefined;

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
    isOpen = false;
    strongEntry = null;
    searchResults = [];
    error = "";
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
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
                {:else if englishDefinitions.length > 0}
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
                {:else}
                  <div class="info-section">
                    <h3>About This Word</h3>
                    <p class="full-def">
                      This is an English word from the Bible translation.
                      {#if englishSynonyms.length > 0}
                        See the Synonyms tab for {englishSynonyms.length} related
                        words.
                      {:else}
                        For deeper study, look up the original Greek or Hebrew
                        word from an interlinear Bible.
                      {/if}
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
