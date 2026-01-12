<script lang="ts">
  import { onMount } from 'svelte';
  
  let readerElement: HTMLDivElement;
  let currentBook = 'John';
  let currentChapter = 1;
  
  // Placeholder verses - will integrate with adapters
  const verses = Array.from({ length: 51 }, (_, i) => ({
    verse: i + 1,
    text: `Verse ${i + 1} placeholder text. In the beginning was the Word, and the Word was with God, and the Word was God.`
  }));
  
  function handleTapTop() {
    // TODO: Show chapter navigation
    console.log('Tap top - show chapter nav');
  }
  
  onMount(() => {
    // TODO: Load initial chapter from reading history
    console.log('BibleReader mounted');
  });
</script>

<div class="bible-reader" bind:this={readerElement}>
  <div class="tap-zone-top" on:click={handleTapTop}></div>
  
  <div class="text-container">
    <div class="chapter-header">
      <h1>{currentBook} {currentChapter}</h1>
    </div>
    
    <div class="verses">
      {#each verses as { verse, text }}
        <div class="verse">
          <span class="verse-number">{verse}</span>
          <span class="verse-text">{text}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .bible-reader {
    width: 100%;
    height: 100%;
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    background: #1a1a1a;
    color: #e0e0e0;
  }
  
  .tap-zone-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    z-index: 10;
    cursor: pointer;
  }
  
  .text-container {
    max-width: 700px;
    margin: 0 auto;
    padding: 80px 20px 100px;
  }
  
  .chapter-header {
    margin-bottom: 2rem;
    text-align: center;
  }
  
  .chapter-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #f0f0f0;
  }
  
  .verses {
    line-height: 1.8;
  }
  
  .verse {
    margin-bottom: 0.5rem;
  }
  
  .verse-number {
    display: inline-block;
    min-width: 2rem;
    font-size: 0.75rem;
    color: #888;
    vertical-align: super;
    margin-right: 0.25rem;
  }
  
  .verse-text {
    font-size: 1.125rem;
    line-height: 1.8;
  }
  
  /* Smooth scrolling */
  .bible-reader {
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }
</style>
