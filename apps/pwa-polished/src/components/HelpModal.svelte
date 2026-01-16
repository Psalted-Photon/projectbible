<script lang="ts">
  export let show = false;
  export let helpTopic: string = "general";

  const helpContent: Record<string, {title: string, description: string, examples: string[]}> = {
    matchType: {
      title: "Match Type",
      description: "Controls how your search text is matched against Bible verses.",
      examples: [
        "Contains: 'light' finds 'light', 'delight', 'lighthouse'",
        "Starts with: 'light' finds 'light', 'lighthouse' but not 'delight'",
        "Ends with: 'light' finds 'light', 'delight' but not 'lighthouse'",
        "Whole word: 'light' finds only 'light' (exact word match)",
        "Word begins with: 'light' finds 'light', 'lighthouse', 'lighting'",
        "Word ends with: 'ing' finds 'loving', 'walking', 'beginning'"
      ]
    },
    mustContain: {
      title: "Must Contain / Must NOT Contain",
      description: "Add additional requirements for verses. Verse must match your main search AND contain (or NOT contain) these words.",
      examples: [
        "Search: 'faith' + Must contain: 'works' → finds verses with both faith AND works",
        "Search: 'love' + Must NOT contain: 'fear' → finds love verses without the word fear",
        "You can add multiple words to each list"
      ]
    },
    proximity: {
      title: "Proximity Search",
      description: "Find verses where two words appear near each other. Use the slider to adjust the maximum distance.",
      examples: [
        "'faith' within 5 words of 'works' → finds 'faith without works is dead'",
        "'love' within 10 words of 'neighbor' → finds 'love thy neighbor as thyself'",
        "Distance range: 1-30 words",
        "Tip: Shorter distances = more precise matches"
      ]
    },
    plurals: {
      title: "Include Plurals",
      description: "Automatically includes plural forms of your search word by adding an optional 's' at the end.",
      examples: [
        "'word' with plurals → matches 'word' or 'words'",
        "'blessing' with plurals → matches 'blessing' or 'blessings'",
        "Note: Simple 's' addition only - doesn't handle irregular plurals"
      ]
    },
    caseInsensitive: {
      title: "Case-Insensitive Search",
      description: "When enabled, search ignores uppercase/lowercase differences.",
      examples: [
        "With case-insensitive: 'god', 'God', 'GOD' all match",
        "Without case-insensitive: only exact case matches",
        "Recommended: Keep this ON for most searches"
      ]
    },
    complexity: {
      title: "Pattern Complexity",
      description: "Shows how computationally expensive your search pattern is. Higher scores may take longer to execute.",
      examples: [
        "0-30: Fast and simple",
        "31-60: Moderate complexity",
        "61-80: Complex - may be slow",
        "81-100: Very complex - could take a while",
        "Tip: Simpler patterns search faster"
      ]
    }
  };

  function closeModal() {
    show = false;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  }

  $: content = helpContent[helpTopic] || helpContent.general;
</script>

{#if show}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="help-backdrop" on:click={handleBackdropClick}>
    <div class="help-modal">
      <div class="help-header">
        <h3>❓ {content.title}</h3>
        <button class="close-btn" on:click={closeModal}>✕</button>
      </div>
      
      <div class="help-body">
        <p class="help-description">{content.description}</p>
        
        <div class="help-examples">
          <h4>Examples:</h4>
          <ul>
            {#each content.examples as example}
              <li>{example}</li>
            {/each}
          </ul>
        </div>
      </div>
      
      <div class="help-footer">
        <button class="btn-close" on:click={closeModal}>Got it!</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .help-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 20px;
  }

  .help-modal {
    background: #1a1a1a;
    border: 2px solid #667eea;
    border-radius: 12px;
    width: 100%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  .help-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid #3a3a3a;
  }

  .help-header h3 {
    margin: 0;
    color: #667eea;
    font-size: 20px;
    font-weight: 700;
  }

  .close-btn {
    background: none;
    border: none;
    color: #e0e0e0;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: background 0.2s;
  }

  .close-btn:hover {
    background: #3a3a3a;
  }

  .help-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .help-description {
    color: #e0e0e0;
    font-size: 16px;
    line-height: 1.6;
    margin: 0 0 20px 0;
  }

  .help-examples h4 {
    color: #667eea;
    font-size: 16px;
    margin: 0 0 12px 0;
  }

  .help-examples ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .help-examples li {
    color: #aaa;
    font-size: 14px;
    line-height: 1.6;
    padding: 8px 0 8px 24px;
    position: relative;
  }

  .help-examples li::before {
    content: "→";
    position: absolute;
    left: 0;
    color: #667eea;
    font-weight: bold;
  }

  .help-footer {
    padding: 20px 24px;
    border-top: 1px solid #3a3a3a;
    display: flex;
    justify-content: flex-end;
  }

  .btn-close {
    padding: 10px 24px;
    background: #667eea;
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-close:hover {
    background: #7e8ff0;
  }

  .help-body::-webkit-scrollbar {
    width: 8px;
  }

  .help-body::-webkit-scrollbar-track {
    background: #1a1a1a;
  }

  .help-body::-webkit-scrollbar-thumb {
    background: #4a4a4a;
    border-radius: 4px;
  }

  .help-body::-webkit-scrollbar-thumb:hover {
    background: #5a5a5a;
  }
</style>
