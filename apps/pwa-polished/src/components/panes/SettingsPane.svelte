<script lang="ts">
  // TODO: Integrate with adapters
  let theme = 'dark';
  let fontSize = 18;
  let lineSpacing = 1.8;
</script>

<div class="settings-pane">
  <h2>Settings</h2>
  
  <div class="setting-group">
    <label>Theme</label>
    <select bind:value={theme}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>
  
  <div class="setting-group">
    <label>Font Size: {fontSize}px</label>
    <input type="range" min="12" max="24" bind:value={fontSize} />
  </div>
  
  <div class="setting-group">
    <label>Line Spacing: {lineSpacing}</label>
    <input type="range" min="1" max="2.5" step="0.1" bind:value={lineSpacing} />
  </div>
  
  <p class="note">More settings coming soon...</p>
</div>

<style>
  .settings-pane {
    color: #e0e0e0;
  }
  
  h2 {
    font-size: 1.5rem;
    margin-bottom: 2rem;
    color: #f0f0f0;
  }
  
  .setting-group {
    margin-bottom: 2rem;
  }
  
  .setting-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
    color: #ccc;
  }
  
  select,
  input[type="range"] {
    width: 100%;
    padding: 0.5rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #e0e0e0;
  }
  
  input[type="range"] {
    padding: 0;
  }
  
  .note {
    margin-top: 3rem;
    color: #888;
    font-size: 0.9rem;
    font-style: italic;
  }
</style>
