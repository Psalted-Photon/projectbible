<script lang="ts">
  import type { 
    SearchConfig, 
    GeneratedQuery 
  } from "../../../../packages/core/src/search/searchConfig";
  import { 
    generateSafeRegex, 
    createDefaultConfig 
  } from "../../../../packages/core/src/search/searchConfig";
  import { searchService, type SearchCategory } from "../lib/services/searchService";
  import { englishLexicalService } from "../../../../packages/core/src/search/englishLexicalService";
  import { englishLexicalPackLoader } from "../../../../packages/core/src/search/englishLexicalPackLoader";
  import HelpModal from "./HelpModal.svelte";

  export let show = false;

  let config: SearchConfig = createDefaultConfig();
  let showGeneratedPattern = false;
  let generatedQuery: GeneratedQuery | null = null;
  let previewResults: SearchCategory[] = [];
  let isSearching = false;
  let searchResults: SearchCategory[] = [];
  let totalResultCount = 0;
  let displayedResultCount = 0;
  let showingAll = false;
  
  // Translation tree state
  interface TranslationGroup {
    translationId: string;
    results: SearchResult[];
    displayedCount: number;
    totalCount: number;
    expanded: boolean;
    showMode: 'limited' | 'medium' | 'all'; // 100, 1000, or unlimited
  }
  let translationGroups: TranslationGroup[] = [];
  
  interface SearchResult {
    type: 'verse' | 'place' | 'strongs' | 'morphology' | 'cross-reference';
    title: string;
    subtitle?: string;
    reference?: string;
    data: any;
    score: number;
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

  async function updatePreview() {
    if (!config.text.trim() && config.proximityRules.length === 0) {
      generatedQuery = null;
      previewResults = [];
      return;
    }

    try {
      generatedQuery = generateSafeRegex(config);
      
      // Get preview results (first 10)
      const results = await searchService.search(generatedQuery.regex.source, 10);
      previewResults = results;
    } catch (error) {
      console.error("Preview error:", error);
      generatedQuery = null;
      previewResults = [];
    }
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
      
      // Get all results to organize by translation
      searchResults = await searchService.search(query.regex.source, -1);
      totalResultCount = searchResults.reduce((sum, cat) => sum + cat.count, 0);
      
      // Group results by translation
      const groupMap = new Map<string, SearchResult[]>();
      
      for (const category of searchResults) {
        for (const result of category.results) {
          const translationId = result.data?.translation || 'Unknown';
          if (!groupMap.has(translationId)) {
            groupMap.set(translationId, []);
          }
          groupMap.get(translationId)!.push(result);
        }
      }
      
      // Create translation groups with caps
      translationGroups = Array.from(groupMap.entries()).map(([translationId, results]) => ({
        translationId,
        results,
        displayedCount: Math.min(results.length, 100),
        totalCount: results.length,
        expanded: groupMap.size === 1, // Auto-expand if only one translation
        showMode: 'limited' as const
      }));
      
      // Sort by result count (descending)
      translationGroups.sort((a, b) => b.totalCount - a.totalCount);
      
      displayedResultCount = translationGroups.reduce((sum, g) => sum + g.displayedCount, 0);
    } catch (error) {
      console.error("Search error:", error);
      searchResults = [];
      translationGroups = [];
    } finally {
      isSearching = false;
    }
  }

  function toggleTranslation(index: number) {
    translationGroups[index].expanded = !translationGroups[index].expanded;
    translationGroups = translationGroups; // trigger reactivity
  }
  
  function loadMoreInTranslation(index: number) {
    const group = translationGroups[index];
    
    if (group.showMode === 'limited') {
      // Go from 100 to 1000
      if (group.totalCount <= 1000) {
        group.showMode = 'all';
        group.displayedCount = group.totalCount;
      } else {
        group.showMode = 'medium';
        group.displayedCount = 1000;
      }
    } else if (group.showMode === 'medium') {
      // Go from 1000 to unlimited
      group.showMode = 'all';
      group.displayedCount = group.totalCount;
    }
    
    translationGroups = translationGroups; // trigger reactivity
    displayedResultCount = translationGroups.reduce((sum, g) => sum + g.displayedCount, 0);
  }

  function resetConfig() {
    config = createDefaultConfig();
    generatedQuery = null;
    previewResults = [];
    searchResults = [];
    translationGroups = [];
    totalResultCount = 0;
    displayedResultCount = 0;
  }

  // Don't auto-update preview to avoid losing input focus
  let updateTimeout: ReturnType<typeof setTimeout>;

</script>

{#if show}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click={handleBackdropClick}>
    <div class="modal-container" on:click|stopPropagation>
      <!-- Header -->
      <div class="modal-header">
        <h2>⚡ Power Search</h2>
        <button class="close-button" on:click={closeModal} title="Close">✕</button>
      </div>

      <!-- Main Content -->
      <div class="modal-body">
        <!-- Left Panel: Controls -->
        <div class="controls-panel">
          <!-- Word/Phrase Section -->
          <section class="control-section">
            <h3>🔤 Word / Phrase</h3>
            
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
              🎛️ Match Type
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
              🧩 Advanced Logic
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
              📏 Proximity Search
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
            <button class="btn-primary" on:click={() => executeSearch(false)} disabled={isSearching}>
              {isSearching ? 'Searching...' : '🔍 Search'}
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
                      <span class="warning">⚠️ Complex pattern - may be slow</span>
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
          {#if translationGroups.length > 0}
            <div class="results-container">
              <div class="results-header">
                <h3>Results</h3>
                <div class="result-count">
                  Showing {displayedResultCount.toLocaleString()} of {totalResultCount.toLocaleString()} results
                </div>
              </div>

              <div class="results-list">
                {#if translationGroups.length === 1}
                  <!-- Single translation: show flat list -->
                  {#each translationGroups[0].results.slice(0, translationGroups[0].displayedCount) as result}
                    <div class="result-item">
                      <div class="result-title">{result.title}</div>
                      {#if result.subtitle}
                        <div class="result-text">{result.subtitle}</div>
                      {/if}
                    </div>
                  {/each}
                  
                  {#if translationGroups[0].displayedCount < translationGroups[0].totalCount}
                    <div class="load-more-container">
                      <button class="load-more-btn" on:click={() => loadMoreInTranslation(0)}>
                        {#if translationGroups[0].showMode === 'limited'}
                          Showing {translationGroups[0].displayedCount}/{translationGroups[0].totalCount}
                          — Click to load {Math.min(1000, translationGroups[0].totalCount)} results
                        {:else if translationGroups[0].showMode === 'medium'}
                          Showing {translationGroups[0].displayedCount}/{translationGroups[0].totalCount}
                          — Click to load all {translationGroups[0].totalCount.toLocaleString()} results
                        {/if}
                      </button>
                    </div>
                  {/if}
                {:else}
                  <!-- Multiple translations: show tree view -->
                  {#each translationGroups as group, index}
                    <div class="translation-branch">
                      <button 
                        class="translation-header"
                        on:click={() => toggleTranslation(index)}
                      >
                        <span class="expand-icon">{group.expanded ? '▼' : '▶'}</span>
                        <span class="translation-name">{group.translationId}</span>
                        <span class="translation-count">
                          {group.displayedCount < group.totalCount 
                            ? `${group.displayedCount}/${group.totalCount}` 
                            : group.totalCount}
                        </span>
                      </button>
                      
                      {#if group.expanded}
                        <div class="translation-results">
                          {#each group.results.slice(0, group.displayedCount) as result}
                            <div class="result-item">
                              <div class="result-title">{result.title}</div>
                              {#if result.subtitle}
                                <div class="result-text">{result.subtitle}</div>
                              {/if}
                            </div>
                          {/each}
                          
                          {#if group.displayedCount < group.totalCount}
                            <div class="load-more-container">
                              <button class="load-more-btn" on:click={() => loadMoreInTranslation(index)}>
                                {#if group.showMode === 'limited'}
                                  Showing {group.displayedCount}/{group.totalCount}
                                  — Click to load {Math.min(1000, group.totalCount)} results
                                {:else if group.showMode === 'medium'}
                                  Showing {group.displayedCount}/{group.totalCount}
                                  — Click to load all {group.totalCount.toLocaleString()} results
                                {/if}
                              </button>
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {:else if previewResults.length > 0}
            <div class="preview-results">
              <h3>Preview (first 10 matches)</h3>
              {#each previewResults as category}
                {#each category.results as result}
                  <div class="preview-item">
                    <div class="preview-title">{result.title}</div>
                    {#if result.subtitle}
                      <div class="preview-text">{result.subtitle}</div>
                    {/if}
                  </div>
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
    border: 2px solid #667eea;
    border-radius: 12px;
    width: 100%;
    max-width: 1400px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(102, 126, 234, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 2px solid #667eea;
    background: linear-gradient(135deg, #1a1a1a 0%, #2a2a3a 100%);
  }

  .modal-header h2 {
    margin: 0;
    color: #667eea;
    font-size: 24px;
    font-weight: 700;
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
    border-color: #667eea;
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
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
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
    border-color: #667eea;
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
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
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
    color: #667eea;
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
    color: #667eea;
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
    background: #667eea;
    color: white;
    transform: scale(1.1);
  }

  .help-btn-inline {
    background: none;
    border: 1px solid #4a4a4a;
    border-radius: 50%;
    color: #667eea;
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
    background: #667eea;
    color: white;
    border-color: #667eea;
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
    border-color: #667eea;
    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
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
    background: #667eea;
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
    background: #667eea;
    border-radius: 50%;
    cursor: pointer;
  }

  .proximity-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: #667eea;
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
    background: #667eea;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #7e8ff0;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
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
    color: #667eea;
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
    color: #667eea;
    font-size: 18px;
  }

  .result-count {
    color: #aaa;
    font-size: 14px;
  }

  .load-all-link {
    background: none;
    border: none;
    color: #667eea;
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

  .translation-branch {
    margin-bottom: 16px;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    overflow: hidden;
    background: #1a1a1a;
  }

  .translation-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: linear-gradient(135deg, #1a1a2a 0%, #2a2a3a 100%);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    color: #e0e0e0;
    font-size: 15px;
    font-weight: 600;
  }

  .translation-header:hover {
    background: linear-gradient(135deg, #2a2a3a 0%, #3a3a4a 100%);
  }

  .expand-icon {
    color: #667eea;
    font-size: 12px;
    min-width: 16px;
  }

  .translation-name {
    flex: 1;
    text-align: left;
    color: #667eea;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .translation-count {
    color: #888;
    font-size: 13px;
    font-weight: 500;
    background: #0a0a0a;
    padding: 4px 10px;
    border-radius: 12px;
    border: 1px solid #3a3a3a;
  }

  .translation-results {
    padding: 12px;
    background: #141414;
  }

  .load-more-container {
    margin-top: 12px;
    text-align: center;
  }

  .load-more-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.2s;
  }

  .load-more-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
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

  .result-item {
    padding: 12px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .result-item:hover {
    background: #2a2a2a;
    border-color: #667eea;
  }

  .result-title {
    font-weight: 600;
    color: #e0e0e0;
    margin-bottom: 4px;
    font-size: 14px;
  }

  .result-text {
    color: #aaa;
    font-size: 13px;
    line-height: 1.4;
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
    padding: 10px;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    margin-bottom: 8px;
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
</style>
