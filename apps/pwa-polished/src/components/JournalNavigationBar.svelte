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
    gap: calc(8px * var(--bar-scale, 1));
    padding: calc(12px * var(--bar-scale, 1));
    border-bottom: 1px solid var(--border-color, #ddd);
    background: var(--nav-bg, #f9f9f9);
    align-items: center;
    flex-shrink: 0;
  }
  
  button {
    padding: calc(8px * var(--bar-scale, 1)) calc(16px * var(--bar-scale, 1));
    border: 1px solid var(--border-color, #ddd);
    background: var(--button-bg, white);
    color: var(--text-color, #222);
    border-radius: 4px;
    cursor: pointer;
    min-width: calc(44px * var(--bar-scale, 1));
    min-height: calc(44px * var(--bar-scale, 1));
    font-size: calc(16px * var(--bar-scale, 1));
    transition: background 0.2s;
  }
  
  button:hover {
    background: var(--button-hover-bg, #e8e8e8);
  }
  
  button:active {
    transform: scale(0.95);
  }
  
  input[type="date"] {
    padding: calc(8px * var(--bar-scale, 1));
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: calc(14px * var(--bar-scale, 1));
    min-height: calc(44px * var(--bar-scale, 1));
    background: var(--input-bg, white);
    color: var(--text-color, #222);
  }
  
  .title-input {
    flex: 1;
    padding: calc(8px * var(--bar-scale, 1));
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    font-size: calc(16px * var(--bar-scale, 1));
    min-height: calc(44px * var(--bar-scale, 1));
    background: var(--input-bg, white);
    color: var(--text-color, #222);
  }
  
  .title-input::placeholder {
    color: var(--placeholder-color, #999);
  }
  
  .status {
    margin-left: auto;
    font-size: calc(14px * var(--bar-scale, 1));
    color: var(--text-secondary, #666);
  }
  
  .status.dirty {
    color: var(--accent-color, #007aff);
    font-size: calc(20px * var(--bar-scale, 1));
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
      padding: calc(8px * var(--bar-scale, 1));
      gap: calc(6px * var(--bar-scale, 1));
    }
    
    .title-input {
      flex-basis: 100%;
      order: 1;
    }
    
    button,
    input[type="date"] {
      min-width: calc(40px * var(--bar-scale, 1));
      min-height: calc(40px * var(--bar-scale, 1));
      padding: calc(6px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    }
  }
</style>
