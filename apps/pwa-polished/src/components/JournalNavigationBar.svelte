<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let currentDate: string;
  export let title: string;
  export let isDirty: boolean;
  export let isSaving: boolean;
  
  const dispatch = createEventDispatcher();
  
  function handleDateChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    dispatch('dateChange', target.value);
  }
  
  function handleTitleInput(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    dispatch('titleChange', target.value);
  }
  
  function handleMouseEvent(e: MouseEvent) {
    // Stop propagation to prevent EdgeGestureDetector interference
    e.stopPropagation();
  }
</script>

<nav class="journal-nav" class:dirty={isDirty}>
  <button 
    on:click={() => dispatch('prev')} 
    title="Previous day" 
    aria-label="Previous day"
    type="button"
  >
    ←
  </button>
  
  <input
    type="date"
    value={currentDate}
    on:change={handleDateChange}
    aria-label="Select date"
  />
  
  <button 
    on:click={() => dispatch('today')} 
    title="Today" 
    aria-label="Jump to today"
    type="button"
  >
    Today
  </button>
  
  <input
    type="text"
    value={title}
    placeholder="Entry title (optional)"
    on:input={handleTitleInput}
    on:blur={() => dispatch('titleBlur')}
    on:mousedown={handleMouseEvent}
    on:mouseup={handleMouseEvent}
    on:click={handleMouseEvent}
    aria-label="Entry title"
    class="title-input"
  />
  
  <button 
    on:click={() => dispatch('next')} 
    title="Next day" 
    aria-label="Next day"
    type="button"
  >
    →
  </button>
  
  {#if isSaving}
    <span class="status">Saving...</span>
  {:else if isDirty}
    <span class="status dirty">●</span>
  {/if}
</nav>

<style>
  .journal-nav {
    display: flex;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border-color, #ddd);
    background: var(--nav-bg, #f9f9f9);
    align-items: center;
    flex-shrink: 0;
  }
  
  button {
    padding: 8px 16px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--button-bg, white);
    color: var(--text-color, #222);
    border-radius: 4px;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    font-size: 16px;
    transition: background 0.2s;
  }
  
  button:hover {
    background: var(--button-hover-bg, #e8e8e8);
  }
  
  button:active {
    transform: scale(0.95);
  }
  
  input[type="date"] {
    padding: 8px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: 14px;
    min-height: 44px;
    background: var(--input-bg, white);
    color: var(--text-color, #222);
  }
  
  .title-input {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: 16px;
    min-height: 44px;
    background: var(--input-bg, white);
    color: var(--text-color, #222);
  }
  
  .title-input::placeholder {
    color: var(--placeholder-color, #999);
  }
  
  .status {
    margin-left: auto;
    font-size: 14px;
    color: var(--text-secondary, #666);
  }
  
  .status.dirty {
    color: var(--accent-color, #007aff);
    font-size: 20px;
    animation: pulse 2s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  /* Mobile responsiveness */
  @media (max-width: 640px) {
    .journal-nav {
      flex-wrap: wrap;
      padding: 8px;
      gap: 6px;
    }
    
    .title-input {
      flex-basis: 100%;
      order: 1;
    }
    
    button,
    input[type="date"] {
      min-width: 40px;
      min-height: 40px;
      padding: 6px 12px;
    }
  }
</style>
