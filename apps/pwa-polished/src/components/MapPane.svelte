<script lang="ts">
  export let windowId: string | undefined = undefined;

  // Prevent unused warning - will be used when Leaflet is integrated
  $: void windowId;

  // TODO: Implement Leaflet map integration
  // For now, just a placeholder
</script>

<div class="map-pane">
  <div class="map-placeholder">
    <h2>🗺️ Map</h2>
    <p>Leaflet map integration coming soon...</p>
    <p class="hint">This will display biblical geography and places</p>
  </div>
</div>

<style>
  .map-pane {
    width: 100%;
    height: 100%;
    background: #1a1a1a;
  }

  .map-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    padding: 40px;
    text-align: center;
  }

  .map-placeholder h2 {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .map-placeholder p {
    font-size: 18px;
    margin-bottom: 8px;
  }

  .map-placeholder .hint {
    font-size: 14px;
    color: #666;
  }
</style>
