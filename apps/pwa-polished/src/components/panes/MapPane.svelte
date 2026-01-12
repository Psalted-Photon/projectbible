<script lang="ts">
  import { onMount } from 'svelte';
  
  let mapContainer: HTMLDivElement;
  
  onMount(() => {
    // TODO: Initialize Leaflet map centered on Israel
    console.log('MapPane mounted - will integrate Leaflet');
  });
</script>

<div class="map-pane">
  <h2>Map</h2>
  <div class="map-container" bind:this={mapContainer}>
    <p class="placeholder">Map will load here<br/>Centered on Israel by default</p>
  </div>
</div>

<style>
  .map-pane {
    height: 100%;
    display: flex;
    flex-direction: column;
    color: #e0e0e0;
  }
  
  h2 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: #f0f0f0;
  }
  
  .map-container {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .placeholder {
    color: #888;
    text-align: center;
    font-style: italic;
  }
</style>
