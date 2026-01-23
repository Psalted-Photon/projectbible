<script lang="ts">
  import { windowStore } from "../lib/stores/windowStore";

  export let windowId: string;

  let searchQuery = "";

  function handleContentSelect(contentType: 'bible' | 'map' | 'notes' | 'wordstudy') {
    // Set initial content state based on type
    let contentState = {};
    
    if (contentType === 'bible') {
      contentState = {
        translation: 'WEB',
        book: 'Genesis',
        chapter: 1,
      };
    } else if (contentType === 'map') {
      contentState = {
        center: [31.7683, 35.2137], // Jerusalem
        zoom: 8,
      };
    }

    windowStore.setWindowContent(windowId, contentType, contentState);
  }

  function handleSearch() {
    // TODO: Implement unified search
    console.log('Search for:', searchQuery);
  }
</script>

<div class="content-selector">
  <div class="search-bar">
    <input 
      type="text" 
      placeholder="Search everything..." 
      bind:value={searchQuery}
      on:keydown={(e) => e.key === 'Enter' && handleSearch()}
    />
    <button on:click={handleSearch}><span class="emoji">🔍</span></button>
  </div>

  <div class="button-grid">
    <button class="content-button bible" on:click={() => handleContentSelect('bible')}>
      <span class="icon emoji">📖</span>
      <span class="label">Bible</span>
    </button>
    
    <button class="content-button map" on:click={() => handleContentSelect('map')}>
      <span class="icon emoji">🗺️</span>
      <span class="label">Map</span>
    </button>
    
    <button class="content-button notes" on:click={() => handleContentSelect('notes')}>
      <span class="icon emoji">📝</span>
      <span class="label">Notes</span>
    </button>
    
    <button class="content-button wordstudy" on:click={() => handleContentSelect('wordstudy')}>
      <span class="icon emoji">📚</span>
      <span class="label">Word Study</span>
    </button>
  </div>

  <p class="instruction">Select a content type to fill this window</p>
</div>

<style>
  .content-selector {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40px;
    gap: 30px;
  }

  .search-bar {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 500px;
  }

  .search-bar input {
    flex: 1;
    padding: 12px 16px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 16px;
  }

  .search-bar input:focus {
    outline: none;
    border-color: #667eea;
  }

  .search-bar button {
    padding: 12px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 20px;
    cursor: pointer;
    transition: transform 0.2s;
  }

  .search-bar button:hover {
    transform: scale(1.05);
  }

  .button-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
    max-width: 500px;
    width: 100%;
  }

  .content-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 30px;
    background: #2a2a2a;
    border: 2px solid #444;
    border-radius: 12px;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 16px;
    font-weight: 500;
  }

  .content-button:hover {
    border-color: #667eea;
    transform: translateY(-4px);
    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
  }

  .content-button .icon {
    font-size: 48px;
  }

  .content-button .label {
    font-size: 18px;
  }

  .instruction {
    color: #888;
    font-size: 14px;
    margin-top: 20px;
  }
</style>
