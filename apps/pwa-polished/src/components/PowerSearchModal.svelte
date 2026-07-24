<script lang="ts">
  import type { 
    SearchConfig, 
    GeneratedQuery 
  } from "../../../../packages/core/src/search/searchConfig";
  import { 
    generateSafeRegex, 
    createDefaultConfig 
  } from "../../../../packages/core/src/search/searchConfig";
  import {
    searchService,
    type SearchCategory,
    type SearchResult,
  } from "../lib/services/searchService";
  import { navigationStore } from "../stores/navigationStore";
  import { get } from "svelte/store";
  import { englishLexicalService } from "../../../../packages/core/src/search/englishLexicalService";
  import { buildSearchTree } from "../lib/searchTree";
  import SearchResultsTree from "./SearchResultsTree.svelte";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { windowStore } from "../lib/stores/windowStore";
  import HelpModal from "./HelpModal.svelte";
  import { Microscope } from 'phosphor-svelte';

  export let show = false;

  let config: SearchConfig = createDefaultConfig();
  let showGeneratedPattern = false;
  let generatedQuery: GeneratedQuery | null = null;
  let previewResults: SearchCategory[] = [];
  let isSearching = false;
  let searchResults: SearchCategory[] = [];
  let totalResultCount = 0;
  let displayedResultCount = 0;

  /** Expand state for the shared results tree, keyed by node path. */
  let expandedResultNodes = new Set<string>();
  $: searchTree = buildSearchTree(searchResults);

  function toggleResultNode(key: string) {
    const next = new Set(expandedResultNodes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedResultNodes = next;
  }


  // Help modal state
  let showHelpModal = false;
  let helpTopic = "general";
  
  // Proximity rule builder
  let proximityWord1 = "";
  let proximityWord2 = "";
  let proximityDistance = 5;
  
  // Must contain/exclude builders
  let mustContainInput = "";
  let mustNotContainInput = "";

  function openHelp(topic: string) {
    helpTopic = topic;
    showHelpModal = true;
  }

  function closeModal() {
    show = false;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  }

  function addMustContain() {
    if (mustContainInput.trim()) {
      config.mustContain = [...config.mustContain, mustContainInput.trim()];
      mustContainInput = "";
    }
  }

  function removeMustContain(index: number) {
    config.mustContain = config.mustContain.filter((_, i) => i !== index);
  }

  function addMustNotContain() {
    if (mustNotContainInput.trim()) {
      config.mustNotContain = [...config.mustNotContain, mustNotContainInput.trim()];
      mustNotContainInput = "";
    }
  }

  function removeMustNotContain(index: number) {
    config.mustNotContain = config.mustNotContain.filter((_, i) => i !== index);
  }

  function addProximityRule() {
    if (proximityWord1.trim() && proximityWord2.trim()) {
      config.proximityRules = [...config.proximityRules, {
        word1: proximityWord1.trim(),
        word2: proximityWord2.trim(),
        maxDistance: proximityDistance
      }];
      proximityWord1 = "";
      proximityWord2 = "";
      proximityDistance = 5;
    }
  }

  function removeProximityRule(index: number) {
    config.proximityRules = config.proximityRules.filter((_, i) => i !== index);
  }


  async function executeSearch() {
    if (!config.text.trim() && config.proximityRules.length === 0) {
      return;
    }

    isSearching = true;
    try {
      // Expand with synonyms if enabled
      let expandedSynonyms: string[] | undefined;
      if (config.includeSynonyms && config.text.trim()) {
        const words = config.text.split(/\s+/);
        const allExpanded = await englishLexicalService.expandWithSynonyms(
          words, 
          config.maxSynonymsPerWord
        );
        // Remove original words to get just synonyms
        expandedSynonyms = allExpanded.filter(w => !words.map(x => x.toLowerCase()).includes(w));
      }
      
      const query = generateSafeRegex(config, expandedSynonyms);
      generatedQuery = query;

      // Power Search is always an explicit search, so run the deep categories too.
      searchResults = await searchService.search(query.regex.source, { limit: -1, deep: true });
      totalResultCount = searchResults.reduce((sum, cat) => sum + cat.count, 0);
      displayedResultCount = totalResultCount;

      // Open the Bible group so results are visible without a first click.
      const hasBible = searchResults.some((c) => c.key === 'bible' && c.count > 0);
      expandedResultNodes = new Set(hasBible ? ['bible'] : []);
    } catch (error) {
      console.error("Search error:", error);
      searchResults = [];
    } finally {
      isSearching = false;
    }
  }

  function resetConfig() {
    config = createDefaultConfig();
    generatedQuery = null;
    previewResults = [];
    searchResults = [];
    expandedResultNodes = new Set();
    totalResultCount = 0;
    displayedResultCount = 0;
  }

  async function handleResultClick(result: SearchResult) {
    if (!result.data) return;

    if (result.type === "character") {
      const { lookupPerson } = await import("../adapters/lexicon-lookup.js");
      const characterData = await lookupPerson(result.data.name);
      if (characterData) {
        lexicalModalStore.open({
          characterData,
          selectedText: result.data.name,
          strongsId: undefined,
          morphologyData: null,
          lexicalEntries: null,
        });
        closeModal();
      }
      return;
    }

    if (result.type === "encyclopedia") {
      isbeModalStore.open({
        kind: result.data.isPlace ? "place" : "entry",
        entryId: result.data.entryId,
        placeId: null,
        primaryName: result.data.primaryName,
      });
      closeModal();
      return;
    }

    if (result.type === "journal") {
      const edge = window.innerHeight > window.innerWidth ? "bottom" : "right";
      const journalWindowId = windowStore.createWindow(edge, 50);
      if (journalWindowId) {
        windowStore.setWindowContent(journalWindowId, "journal", { date: result.data.date });
      }
      closeModal();
      return;
    }

    if (!result.data.book) return;
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    const targetTranslation = result.data.translation || current.translation;
    navigationStore.navigateTo(
      targetTranslation,
      result.data.book,
      result.data.chapter,
      result.data.verse ?? null,
    );
    closeModal();
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getHighlightTerms(): string[] {
    const terms = new Set<string>();
    if (config.text.trim()) {
      config.text
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .forEach((term) => terms.add(term));
    }
    config.proximityRules.forEach((rule) => {
      if (rule.word1?.trim()) terms.add(rule.word1.trim());
      if (rule.word2?.trim()) terms.add(rule.word2.trim());
    });
    return Array.from(terms);
  }

  function highlightSnippet(text: string | undefined): string {
    if (!text) return "";
    const terms = getHighlightTerms();
    if (terms.length === 0) return text;
    let highlighted = text;
    terms.forEach((term) => {
      if (term.length < 2) return;
      const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
      highlighted = highlighted.replace(regex, '<mark class="highlight-term">$1</mark>');
    });
    return highlighted;
  }

</script>

{#if show}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click={handleBackdropClick}>
    <div class="modal-container" on:click|stopPropagation>
      <!-- Header -->
      <div class="modal-header">
        <h2><span class="header-icon"><Microscope size={20} weight="bold" /><span class="icon-overlay"><Microscope size={20} weight="thin" /></span></span> Power Search</h2>
        <button class="close-button" on:click={closeModal} title="Close">✕</button>
      </div>

      <!-- Main Content -->
      <div class="modal-body">
        <!-- Left Panel: Controls -->
        <div class="controls-panel">
          <!-- Word/Phrase Section -->
          <section class="control-section">
            <h3><span class="emoji">🔤</span> Word / Phrase</h3>
            
            <div class="control-group">
              <label for="search-text">Search for:</label>
              <input
                id="search-text"
                type="text"
                bind:value={config.text}
                placeholder="Enter word or phrase..."
                title="The main word or phrase to search for"
              />
            </div>

            <div class="checkbox-group">
              <label title="Search is not case-sensitive">
                <input type="checkbox" bind:checked={config.caseInsensitive} />
                Case-insensitive
                <button class="help-btn-inline" on:click={() => openHelp('caseInsensitive')}>?</button>
              </label>
              
              <label title="Include plural forms (adds 's' to the end)">
                <input type="checkbox" bind:checked={config.includePlurals} />
                Include plurals
                <button class="help-btn-inline" on:click={() => openHelp('plurals')}>?</button>
              </label>
              
              <label title="Expand search with synonyms from thesaurus (requires lexical packs)">
                <input type="checkbox" bind:checked={config.includeSynonyms} />
                Include synonyms
                <button class="help-btn-inline" on:click={() => openHelp('synonyms')}>?</button>
              </label>
              
              <label title="Show IPA pronunciation for search results (requires lexical packs)">
                <input type="checkbox" bind:checked={config.showPronunciation} />
                Show pronunciation
                <button class="help-btn-inline" on:click={() => openHelp('pronunciation')}>?</button>
              </label>
            </div>
          </section>

          <!-- Pattern Options Section -->
          <section class="control-section">
            <h3>
              <span class="emoji">🎛️</span> Match Type
              <button class="help-btn" on:click={() => openHelp('matchType')} title="Learn about match types">?</button>
            </h3>
            
            <div class="control-group">
              <select bind:value={config.matchType} title="How to match the search text">
                <option value="contains">Contains (anywhere in verse)</option>
                <option value="startsWith">Starts with</option>
                <option value="endsWith">Ends with</option>
                <option value="wholeWord">Whole word only</option>
                <option value="wordStartsWith">Word begins with</option>
                <option value="wordEndsWith">Word ends with</option>
              </select>
            </div>
          </section>

          <!-- Must Contain/Not Contain Section -->
          <section class="control-section">
            <h3>
              <span class="emoji">🧩</span> Advanced Logic
              <button class="help-btn" on:click={() => openHelp('mustContain')} title="Learn about must contain">?</button>
            </h3>
            
            <div class="control-group">
              <div class="label-text">Must also contain:</div>
              <div class="input-with-button">
                <input
                  type="text"
                  bind:value={mustContainInput}
                  placeholder="Add word..."
                  on:keydown={(e) => e.key === 'Enter' && addMustContain()}
                  title="Verse must contain this word in addition to main search"
                />
                <button on:click={addMustContain} disabled={!mustContainInput.trim()}>+</button>
              </div>
              
              {#if config.mustContain.length > 0}
                <div class="chip-container">
                  {#each config.mustContain as word, i}
                    <span class="chip chip-positive">
                      {word}
                      <button on:click={() => removeMustContain(i)}>×</button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="control-group">
              <div class="label-text">Must NOT contain:</div>
              <div class="input-with-button">
                <input
                  type="text"
                  bind:value={mustNotContainInput}
                  placeholder="Exclude word..."
                  on:keydown={(e) => e.key === 'Enter' && addMustNotContain()}
                  title="Verse must NOT contain this word"
                />
                <button on:click={addMustNotContain} disabled={!mustNotContainInput.trim()}>+</button>
              </div>
              
              {#if config.mustNotContain.length > 0}
                <div class="chip-container">
                  {#each config.mustNotContain as word, i}
                    <span class="chip chip-negative">
                      {word}
                      <button on:click={() => removeMustNotContain(i)}>×</button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </section>

          <!-- Proximity Search Section -->
          <section class="control-section">
            <h3>
              <span class="emoji">📏</span> Proximity Search
              <button class="help-btn" on:click={() => openHelp('proximity')} title="Learn about proximity search">?</button>
            </h3>
            
            <div class="control-group">
              <div class="label-text">Find words near each other:</div>
              <div class="proximity-inputs">
                <input
                  type="text"
                  bind:value={proximityWord1}
                  placeholder="First word..."
                  title="First word in proximity search"
                />
                <span class="proximity-label">within</span>
                <input
                  type="number"
                  bind:value={proximityDistance}
                  min="1"
                  max="30"
                  class="distance-input"
                  title="Maximum words between (1-30)"
                />
                <span class="proximity-label">words of</span>
                <input
                  type="text"
                  bind:value={proximityWord2}
                  placeholder="Second word..."
                  title="Second word in proximity search"
                />
                <button 
                  on:click={addProximityRule} 
                  disabled={!proximityWord1.trim() || !proximityWord2.trim()}
                >+</button>
              </div>
              
              <div class="slider-container">
                <label for="proximity-slider">Distance: {proximityDistance} words</label>
                <input
                  id="proximity-slider"
                  type="range"
                  bind:value={proximityDistance}
                  min="1"
                  max="30"
                  class="proximity-slider"
                  title="Adjust maximum distance between words"
                />
              </div>
              
              {#if config.proximityRules.length > 0}
                <div class="chip-container">
                  {#each config.proximityRules as rule, i}
                    <span class="chip chip-proximity">
                      "{rule.word1}" ↔ {rule.maxDistance} ↔ "{rule.word2}"
                      <button on:click={() => removeProximityRule(i)}>×</button>
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          </section>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <button class="btn-primary" on:click={executeSearch} disabled={isSearching}>
              {#if isSearching}
                Searching...
              {:else}
                <span class="emoji">🔍</span> Search
              {/if}
            </button>
            <button class="btn-secondary" on:click={resetConfig}>
              Reset
            </button>
          </div>
        </div>

        <!-- Right Panel: Preview & Results -->
        <div class="preview-panel">
          <!-- Generated Pattern Display -->
          {#if generatedQuery}
            <div class="pattern-display">
              <button 
                class="toggle-pattern"
                on:click={() => showGeneratedPattern = !showGeneratedPattern}
              >
                {showGeneratedPattern ? '▼' : '▶'} Generated Pattern
              </button>
              
              {#if showGeneratedPattern}
                <div class="pattern-code">
                  <code>{generatedQuery.regex.source}</code>
                  <div class="pattern-info">
                    <span>Complexity: {generatedQuery.estimatedComplexity}/100</span>
                    <button class="help-btn-inline" on:click={() => openHelp('complexity')}>?</button>
                    {#if generatedQuery.estimatedComplexity > 60}
                      <span class="warning"><span class="emoji">⚠️</span> Complex pattern - may be slow</span>
                    {/if}
                  </div>
                </div>
              {/if}
              
              <div class="pattern-description">
                {generatedQuery.description}
              </div>
              
              {#if generatedQuery.warning}
                <div class="volume-warning">
                  {generatedQuery.warning}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Results Display -->
          {#if searchTree.length > 0}
            <div class="results-container">
              <div class="results-header">
                <h3>Results</h3>
                <div class="result-count">
                  {totalResultCount.toLocaleString()} results
                </div>
              </div>

              <div class="results-list">
                <SearchResultsTree
                  nodes={searchTree}
                  expanded={expandedResultNodes}
                  query={config.text}
                  onToggle={toggleResultNode}
                  onSelect={handleResultClick}
                />
              </div>
            </div>
          {:else if previewResults.length > 0}
            <div class="preview-results">
              <h3>Preview (first 10 matches)</h3>
              {#each previewResults as category}
                {#each category.results as result}
                  <button class="preview-item" on:click={() => handleResultClick(result)}>
                    <div class="preview-title">{result.title}</div>
                    {#if result.subtitle}
                      <div class="preview-text">{@html highlightSnippet(result.subtitle)}</div>
                    {/if}
                  </button>
                {/each}
              {/each}
            </div>
          {:else}
            <div class="empty-state">
              <p>Configure your search and click <strong>Search</strong> to see results</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Help Modal -->
<HelpModal bind:show={showHelpModal} {helpTopic} />

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-container {
    background: #1a1a1a;
    border: 2px solid #f97316;
    border-radius: 12px;
    width: 100%;
    max-width: 1400px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(249, 115, 22, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 2px solid #f97316;
    background: linear-gradient(135deg, #1a1a1a 0%, #2a2a3a 100%);
  }

  .modal-header h2 {
    margin: 0;
    color: #f97316;
    font-size: 24px;
    font-weight: 700;
  }

  .modal-header .header-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-right: 6px;
    color: #431407;
    background: radial-gradient(circle, #f97316 0%, #f97316 20%, #431407 100%);
    border-radius: 6px;
    padding: 4px;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.modal-header .header-icon > svg) {
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
  }

  .close-button {
    background: none;
    border: none;
    color: #e0e0e0;
    font-size: 28px;
    cursor: pointer;
    padding: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: #3a3a3a;
    color: #fff;
  }

  .modal-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    gap: 20px;
    padding: 20px;
  }

  .controls-panel {
    flex: 0 0 450px;
    overflow-y: auto;
    padding-right: 10px;
  }

  .preview-panel {
    flex: 1;
    overflow-y: auto;
    background: #222;
    border-radius: 8px;
    padding: 20px;
  }

  .control-section {
    background: #252525;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .presets-section {
    background: linear-gradient(135deg, #1a1a2a 0%, #2a2a3a 100%);
    border-color: #f97316;
  }

  .presets-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .preset-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    color: #e0e0e0;
  }

  .preset-button:hover {
    background: #2a2a2a;
    border-color: #f97316;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.2);
  }

  .preset-icon {
    font-size: 24px;
  }

  .preset-name {
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }


  .presets-section {
    background: linear-gradient(135deg, #1a1a2a 0%, #2a2a3a 100%);
    border-color: #f97316;
  }

  .presets-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .preset-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    color: #e0e0e0;
  }

  .preset-button:hover {
    background: #2a2a2a;
    border-color: #f97316;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.2);
  }

  .preset-icon {
    font-size: 24px;
  }

  .preset-name {
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }


  .control-section h3 {
    margin: 0 0 12px 0;
    color: #f97316;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .help-btn {
    background: #3a3a3a;
    border: 1px solid #4a4a4a;
    border-radius: 50%;
    color: #f97316;
    width: 20px;
    height: 20px;
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    padding: 0;
  }

  .help-btn:hover {
    background: #f97316;
    color: white;
    transform: scale(1.1);
  }

  .help-btn-inline {
    background: none;
    border: 1px solid #4a4a4a;
    border-radius: 50%;
    color: #f97316;
    width: 16px;
    height: 16px;
    font-size: 10px;
    font-weight: bold;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    padding: 0;
    margin-left: 6px;
  }

  .help-btn-inline:hover {
    background: #f97316;
    color: white;
    border-color: #f97316;
  }

  .control-group {
    margin-bottom: 12px;
  }

  .control-group:last-child {
    margin-bottom: 0;
  }

  .control-group label {
    display: block;
    margin-bottom: 6px;
    color: #aaa;
    font-size: 13px;
    font-weight: 500;
  }

  .label-text {
    display: block;
    margin-bottom: 6px;
    color: #aaa;
    font-size: 13px;
    font-weight: 500;
  }

  .control-group input[type="text"],
  .control-group select {
    width: 100%;
    padding: 10px 12px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 14px;
  }

  .control-group input[type="text"]:focus,
  .control-group select:focus {
    outline: none;
    border-color: #f97316;
    box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e0e0e0;
    font-size: 14px;
    cursor: pointer;
    margin: 0;
  }

  .checkbox-group input[type="checkbox"] {
    cursor: pointer;
  }

  .input-with-button {
    display: flex;
    gap: 8px;
  }

  .input-with-button input {
    flex: 1;
  }

  .input-with-button button {
    padding: 10px 16px;
    background: #f97316;
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .input-with-button button:hover:not(:disabled) {
    background: #7e8ff0;
  }

  .input-with-button button:disabled {
    background: #3a3a3a;
    color: #666;
    cursor: not-allowed;
  }

  .chip-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
  }

  .chip-positive {
    background: #2a4a2a;
    border: 1px solid #4a8a4a;
    color: #8aff8a;
  }

  .chip-negative {
    background: #4a2a2a;
    border: 1px solid #8a4a4a;
    color: #ff8a8a;
  }

  .chip-proximity {
    background: #2a3a4a;
    border: 1px solid #4a6a8a;
    color: #8aaaff;
  }

  .chip button {
    background: none;
    border: none;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.2s;
  }

  .chip button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .proximity-inputs {
    display: grid;
    grid-template-columns: 1fr auto auto auto 1fr auto;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  }

  .proximity-label {
    color: #aaa;
    font-size: 13px;
    white-space: nowrap;
  }

  .distance-input {
    width: 60px !important;
    text-align: center;
  }

  .slider-container {
    margin-top: 8px;
  }

  .proximity-slider {
    width: 100%;
    height: 6px;
    background: #3a3a3a;
    border-radius: 3px;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
    margin-top: 8px;
  }

  .proximity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    background: #f97316;
    border-radius: 50%;
    cursor: pointer;
  }

  .proximity-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: #f97316;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .action-buttons {
    display: flex;
    gap: 12px;
    margin-top: 20px;
  }

  .btn-primary,
  .btn-secondary {
    flex: 1;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #f97316;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #7e8ff0;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
  }

  .btn-primary:disabled {
    background: #3a3a3a;
    color: #666;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #3a3a3a;
    color: #e0e0e0;
    border: 1px solid #4a4a4a;
  }

  .btn-secondary:hover {
    background: #4a4a4a;
  }

  .pattern-display {
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 20px;
  }

  .toggle-pattern {
    background: none;
    border: none;
    color: #f97316;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    margin-bottom: 12px;
    display: block;
  }

  .toggle-pattern:hover {
    color: #7e8ff0;
  }

  .pattern-code {
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 12px;
    overflow-x: auto;
  }

  .pattern-code code {
    color: #8aff8a;
    font-family: 'Courier New', monospace;
    font-size: 13px;
  }

  .pattern-info {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: #888;
    margin-top: 8px;
  }

  .pattern-info .warning {
    color: #ffaa00;
  }

  .pattern-description {
    color: #aaa;
    font-size: 14px;
    font-style: italic;
  }

  .volume-warning {
    margin-top: 12px;
    padding: 12px;
    background: linear-gradient(135deg, #3a1a0a 0%, #4a2a1a 100%);
    border: 2px solid #ff8800;
    border-radius: 6px;
    color: #ffaa44;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
  }

  .results-container {
    margin-top: 20px;
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid #3a3a3a;
  }

  .results-header h3 {
    margin: 0;
    color: #f97316;
    font-size: 18px;
  }

  .result-count {
    color: #aaa;
    font-size: 14px;
  }

  .load-all-link {
    background: none;
    border: none;
    color: #f97316;
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    font-weight: inherit;
    padding: 0;
  }

  .load-all-link:hover {
    color: #7e8ff0;
  }

  .results-list {
    max-height: 600px;
    overflow-y: auto;
  }


















  .result-category {
    margin-bottom: 24px;
  }

  .result-category h4 {
    margin: 0 0 12px 0;
    color: #888;
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
  }





  .more-results {
    color: #888;
    font-size: 13px;
    font-style: italic;
    text-align: center;
    padding: 12px;
  }

  .preview-results {
    margin-top: 20px;
  }

  .preview-results h3 {
    margin: 0 0 16px 0;
    color: #888;
    font-size: 16px;
  }

  .preview-item {
    width: 100%;
    text-align: left;
    padding: 10px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    font: inherit;
    display: block;
    transition: all 0.2s;
  }

  .preview-title {
    font-weight: 600;
    color: #e0e0e0;
    font-size: 13px;
    margin-bottom: 4px;
  }

  .preview-text {
    color: #888;
    font-size: 12px;
    line-height: 1.3;
  }

  .highlight-term {
    background: rgba(255, 193, 7, 0.35);
    border-radius: 3px;
    padding: 2px 4px;
    margin: 0 1px;
    box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.2);
    font-weight: 500;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 300px;
    color: #666;
    font-size: 16px;
    text-align: center;
  }

  /* Scrollbar styling */
  .controls-panel::-webkit-scrollbar,
  .preview-panel::-webkit-scrollbar,
  .results-list::-webkit-scrollbar {
    width: 8px;
  }

  .controls-panel::-webkit-scrollbar-track,
  .preview-panel::-webkit-scrollbar-track,
  .results-list::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .controls-panel::-webkit-scrollbar-thumb,
  .preview-panel::-webkit-scrollbar-thumb,
  .results-list::-webkit-scrollbar-thumb {
    background: #4a4a4a;
    border-radius: 4px;
  }

  .controls-panel::-webkit-scrollbar-thumb:hover,
  .preview-panel::-webkit-scrollbar-thumb:hover,
  .results-list::-webkit-scrollbar-thumb:hover {
    background: #5a5a5a;
  }

  /* ── Phone portrait (≤480px) ── */
  @media (max-width: 480px) {
    .modal-backdrop {
      padding: 0;
      align-items: flex-start;
    }

    .modal-container {
      max-width: 100vw;
      max-height: 100dvh;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-top: none;
    }

    .modal-header {
      padding: 12px 16px;
    }

    .modal-header h2 {
      font-size: 18px;
    }

    .close-button {
      font-size: 22px;
      width: 32px;
      height: 32px;
    }

    .modal-body {
      flex-direction: column;
      overflow-y: auto;
      gap: 0;
      padding: 12px;
    }

    .controls-panel {
      flex: none;
      width: 100%;
      overflow-y: visible;
      padding-right: 0;
      padding-bottom: 12px;
      border-bottom: 1px solid #333;
    }

    .preview-panel {
      flex: none;
      width: 100%;
      min-height: 200px;
      padding: 12px;
    }

    .control-section {
      margin-bottom: 10px;
    }

    .control-section input[type="text"],
    .control-section input[type="number"],
    .control-section select {
      padding: 6px 10px;
      font-size: 13px;
    }

    .input-row {
      gap: 6px;
    }

    .proximity-builder {
      gap: 6px;
    }

    .btn-primary,
    .btn-secondary {
      padding: 8px 14px;
      font-size: 13px;
    }
  }
</style>
