<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let x = 0;
  export let y = 0;
  export let selectedText = '';
  /** Clicked word resolves to an ISBE place — shows the "Map" button. */
  export let isPlace = false;
  /** Clicked word resolves to a biblical character — button reads "Bio", not "Define". */
  export let isPerson = false;
  /** Clicked word resolves to an ISBE entry/place — button reads "More Info". */
  export let moreInfo = false;
  export let mode: 'word' | 'verse' = 'word';
  /** How many words the selection covers. Drives which buttons make sense. */
  export let wordCount = 1;
  /** True while the next tap is armed to stretch the selection. */
  export let extendArmed = false;


  const dispatch = createEventDispatcher();

  // Define/Bio/More Info and Repeats look up a single term, so they only appear
  // for a one-word selection. Search, Highlight, Save and Notes work on a phrase.
  $: singleWord = mode === 'verse' || wordCount <= 1;

  function handleAction(action: string) {
    dispatch('action', { action, text: selectedText });
  }
</script>

<div class="toast" style="left: {x}px; top: {y}px;">
  <div class="mode-toggle">
    <button 
      class="toggle-btn"
      class:active={mode === 'word'}
      on:click={() => dispatch('modeChange', 'word')}
    >
      Word
    </button>
    <button 
      class="toggle-btn"
      class:active={mode === 'verse'}
      on:click={() => dispatch('modeChange', 'verse')}
    >
      Verse
    </button>
  </div>
  
  <div class="actions">
    {#if singleWord}
      <!-- Same action either way; the label tells you what you'll get.
           Precedence: a biblical character (Bio) outranks an ISBE entry (More Info). -->
      <button class="action-btn" on:click={() => handleAction('dissect')}>
        {isPerson ? 'Bio' : moreInfo ? 'More Info' : 'Define'}
      </button>
    {/if}

    <button class="action-btn" on:click={() => handleAction('search')}>
      Search
    </button>

    {#if isPlace}
      <button class="action-btn" on:click={() => handleAction('map')}>
        Map
      </button>
    {/if}

    <button class="action-btn" on:click={() => handleAction('highlight')}>
      Highlight
    </button>

    <button class="action-btn" on:click={() => handleAction('save')}>
      Save
    </button>

    <button class="action-btn" on:click={() => handleAction('notes')}>
      Notes
    </button>

    {#if singleWord}
      <button class="action-btn" on:click={() => handleAction('repeats')}>
        Repeats
      </button>
    {/if}

    <!-- Two-tap alternative to dragging: arm, then tap the far word. Reaches
         phrases that wrap off-screen and needs no steady hand. -->
    {#if mode === 'word'}
      <button
        class="action-btn"
        class:armed={extendArmed}
        on:click={() => handleAction('extend')}
      >
        {extendArmed ? 'Tap a word…' : 'Extend'}
      </button>
    {/if}
  </div>
</div>

<style>
  .toast {
    position: fixed;
    background: rgba(42, 42, 42, 0.98);
    border-radius: 3px;
    padding: 3px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    min-width: 200px;
    backdrop-filter: blur(10px);
  }
  
  .mode-toggle {
    display: flex;
    gap: 2px;
    margin-bottom: 3px;
    padding-bottom: 3px;
    border-bottom: 1px solid #333;
  }
  
  .toggle-btn {
    flex: 1;
    padding: 3px 6px;
    background: #1a1a1a;
    color: #888;
    border: none;
    border-radius: 2px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1.2;
  }
  
  .toggle-btn:hover {
    background: #2a2a2a;
  }
  
  .toggle-btn.active {
    background: #667eea;
    color: white;
  }
  
  .actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px;
  }
  
  .action-btn {
    padding: 3px 6px;
    background: #333;
    color: #e0e0e0;
    border: none;
    border-radius: 2px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
    white-space: nowrap;
    line-height: 1.2;
  }
  
  .action-btn:hover {
    background: #444;
  }
  
  .action-btn:active {
    transform: scale(0.98);
  }

  .action-btn.armed {
    background: #667eea;
    color: #fff;
  }
</style>
