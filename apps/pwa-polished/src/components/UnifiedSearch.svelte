<script lang="ts">
  import { searchService, type SearchCategory } from "../lib/services/searchService";

  export let onResultSelect: (result: any) => void = () => {};

  let query = "";
  let results: SearchCategory[] = [];
  let isSearching = false;
  let searchTimeout: ReturnType<typeof setTimeout>;

  async function handleSearch() {
    if (!query || query.trim().length === 0) {
      results = [];
      return;
    }

    isSearching = true;
    try {
      results = await searchService.search(query);
    } catch (error) {
      console.error('Search error:', error);
      results = [];
    } finally {
      isSearching = false;
    }
  }

  function handleInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(handleSearch, 300);
  }

  function handleResultClick(result: any) {
    onResultSelect(result);
  }
</script>

<div class="unified-search">
  <div class="search-input">
    <input 
      type="text" 
      placeholder="Search verses, places, Strong's numbers..." 
      bind:value={query}
      on:input={handleInput}
      on:keydown={(e) => e.key === 'Enter' && handleSearch()}
    />
    {#if isSearching}
      <span class="spinner emoji">⏳</span>
    {/if}
  </div>

  {#if results.length > 0}
    <div class="results">
      {#each results as category}
        <div class="category">
          <h3 class="category-header">
            {category.name} ({category.count})
          </h3>
          <div class="category-results">
            {#each category.results as result}
              <button 
                class="result-item"
                on:click={() => handleResultClick(result)}
              >
                <div class="result-title">{result.title}</div>
                {#if result.subtitle}
                  <div class="result-subtitle">{result.subtitle}</div>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else if query && !isSearching}
    <div class="no-results">
      No results found for "{query}"
    </div>
  {/if}
</div>

<style>
  .unified-search {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1a1a1a;
  }

  .search-input {
    position: relative;
    padding: 16px;
    border-bottom: 1px solid #333;
  }

  .search-input input {
    width: 100%;
    padding: 12px 16px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 16px;
  }

  .search-input input:focus {
    outline: none;
    border-color: #667eea;
  }

  .spinner {
    position: absolute;
    right: 28px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 20px;
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .category {
    margin-bottom: 24px;
  }

  .category-header {
    font-size: 14px;
    font-weight: 600;
    color: #667eea;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .category-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result-item {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 12px 16px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    color: #e0e0e0;
    width: 100%;
  }

  .result-item:hover {
    border-color: #667eea;
    background: #333;
  }

  .result-title {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .result-subtitle {
    font-size: 14px;
    color: #aaa;
  }

  .no-results {
    padding: 40px;
    text-align: center;
    color: #888;
    font-size: 16px;
  }
</style>
