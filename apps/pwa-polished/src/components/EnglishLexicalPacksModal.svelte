<script lang="ts">
  import { englishLexicalPackLoader, type LoadProgress } from "../../../../packages/core/src/search/englishLexicalPackLoader";
  import { englishLexicalService } from "../../../../packages/core/src/search/englishLexicalService";
  
  export let show = false;
  
  let isLoading = false;
  let packsLoaded = false;
  let currentPack: string = '';
  let currentStage: string = '';
  let currentProgress = 0;
  let currentMessage = '';
  let error: string | null = null;
  
  // Check if packs are already loaded on mount
  $: if (show && !isLoading) {
    checkPacksLoaded();
  }
  
  async function checkPacksLoaded() {
    try {
      packsLoaded = await englishLexicalPackLoader.arePacksLoaded();
    } catch (err) {
      console.error('Failed to check if packs are loaded:', err);
    }
  }
  
  async function loadPacks() {
    isLoading = true;
    error = null;
    
    try {
      const baseUrl = '/packs/polished';
      
      await englishLexicalPackLoader.loadAllPacks(baseUrl, (progress: LoadProgress) => {
        currentPack = progress.pack;
        currentStage = progress.stage;
        currentProgress = progress.progress;
        currentMessage = progress.message;
      });
      
      packsLoaded = true;
      currentMessage = '✅ All English lexical packs loaded successfully!';
    } catch (err: any) {
      error = `Failed to load packs: ${err.message}`;
      console.error('Pack loading error:', err);
    } finally {
      isLoading = false;
    }
  }
  
  function close() {
    show = false;
  }
  
  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click={handleBackdropClick}>
    <div class="modal-container" on:click|stopPropagation>
      <div class="modal-header">
        <h2>📚 English Lexical Packs</h2>
        <button class="close-button" on:click={close}>✕</button>
      </div>
      
      <div class="modal-body">
        <div class="pack-info">
          <h3>Available Resources</h3>
          <ul>
            <li><strong>Wordlist Pack</strong> - 440,000+ words with IPA pronunciation (31 MB)</li>
            <li><strong>Thesaurus Pack</strong> - 3.5M synonym relationships (326 MB)</li>
            <li><strong>Grammar Pack</strong> - POS tags, irregular verbs, plurals (0.85 MB)</li>
          </ul>
          
          <p class="pack-description">
            Load these packs to enable:
            <br>• Synonym expansion in searches
            <br>• IPA pronunciation display
            <br>• Part-of-speech filtering
            <br>• Advanced morphology features
          </p>
          
          <p class="pack-note">
            <strong>Note:</strong> Total size ~358 MB. Packs are loaded into IndexedDB for offline use.
          </p>
        </div>
        
        {#if packsLoaded && !isLoading}
          <div class="success-message">
            ✅ English lexical packs are loaded and ready!
          </div>
          <button class="load-button" on:click={close}>
            Close
          </button>
        {:else if error}
          <div class="error-message">
            {error}
          </div>
          <button class="load-button" on:click={loadPacks} disabled={isLoading}>
            Retry Loading
          </button>
        {:else if isLoading}
          <div class="progress-container">
            <div class="progress-header">
              <span class="pack-name">
                {currentPack === 'wordlist' ? '📖 Wordlist' : 
                 currentPack === 'thesaurus' ? '🔄 Thesaurus' : 
                 currentPack === 'grammar' ? '📝 Grammar' : 'Loading...'}
              </span>
              <span class="progress-stage">
                {currentStage === 'downloading' ? 'Downloading' :
                 currentStage === 'parsing' ? 'Parsing' :
                 currentStage === 'importing' ? 'Importing' :
                 currentStage === 'complete' ? 'Complete' : ''}
              </span>
            </div>
            
            <div class="progress-bar">
              <div class="progress-fill" style="width: {currentProgress}%"></div>
            </div>
            
            <div class="progress-message">
              {currentMessage}
            </div>
          </div>
        {:else}
          <button class="load-button" on:click={loadPacks}>
            Load English Lexical Packs
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1rem;
  }
  
  .modal-container {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #fff;
  }
  
  .close-button {
    background: none;
    border: none;
    color: #fff;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.2s;
  }
  
  .close-button:hover {
    opacity: 1;
  }
  
  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }
  
  .pack-info {
    margin-bottom: 1.5rem;
  }
  
  .pack-info h3 {
    color: #fff;
    margin-top: 0;
    margin-bottom: 1rem;
  }
  
  .pack-info ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem 0;
  }
  
  .pack-info li {
    padding: 0.5rem 0;
    color: rgba(255, 255, 255, 0.9);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .pack-description {
    color: rgba(255, 255, 255, 0.8);
    line-height: 1.6;
    margin: 1rem 0;
  }
  
  .pack-note {
    background: rgba(255, 193, 7, 0.1);
    border-left: 3px solid #ffc107;
    padding: 0.75rem 1rem;
    color: #ffc107;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  
  .success-message {
    background: rgba(76, 175, 80, 0.2);
    border-left: 3px solid #4caf50;
    padding: 1rem;
    color: #4caf50;
    border-radius: 4px;
    margin-bottom: 1rem;
    font-weight: 500;
  }
  
  .error-message {
    background: rgba(244, 67, 54, 0.2);
    border-left: 3px solid #f44336;
    padding: 1rem;
    color: #f44336;
    border-radius: 4px;
    margin-bottom: 1rem;
  }
  
  .load-button {
    width: 100%;
    padding: 1rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  
  .load-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
  }
  
  .load-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .progress-container {
    margin-bottom: 1rem;
  }
  
  .progress-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  
  .pack-name {
    color: #fff;
    font-weight: 600;
  }
  
  .progress-stage {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.9rem;
  }
  
  .progress-bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }
  
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    transition: width 0.3s ease;
  }
  
  .progress-message {
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
  }
</style>
