<script lang="ts">
  import { searchQuery } from '../../stores/searchStore';
  
  let searchResults: any[] = [];
  
  function handleSearch() {
    // TODO: Integrate with search adapter
    console.log('Searching for:', $searchQuery);
  }
</script>

<div class="search-pane">
  <h2>Search</h2>
  
  <div class="search-box">
    <input 
      type="text" 
      placeholder="Search the Bible..." 
      bind:value={$searchQuery}
      on:keydown={(e) => e.key === 'Enter' && handleSearch()}
    />
    <button on:click={handleSearch}>Search</button>
  </div>
  
  {#if searchResults.length > 0}
    <div class="results">
      {#each searchResults as result}
        <div class="result-item">
          <div class="result-ref">{result.reference}</div>
          <div class="result-text">{result.text}</div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="no-results">Enter a search term to find verses</p>
  {/if}
</div>

<style>
  .search-pane {
    color: #e0e0e0;
  }
  
  h2 {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    color: #f0f0f0;
  }
  
  .search-box {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .search-box input {
    flex: 1;
    padding: 0.75rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #e0e0e0;
    font-size: 1rem;
  }
  
  .search-box button {
    padding: 0.75rem 1.5rem;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.5);
    color: #60a5fa;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .search-box button:hover {
    background: rgba(59, 130, 246, 0.3);
  }
  
  .no-results {
    color: #888;
    text-align: center;
    margin-top: 2rem;
    font-style: italic;
  }
  
  .results {
    margin-top: 1rem;
  }
  
  .result-item {
    padding: 1rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .result-item:hover {
    background: #252525;
  }
  
  .result-ref {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #60a5fa;
  }
  
  .result-text {
    line-height: 1.6;
  }
</style>
