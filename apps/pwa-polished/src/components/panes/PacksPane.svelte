<script lang="ts">
  // TODO: Integrate with pack manager adapter
  const installedPacks = [
    { name: 'KJV', type: 'translation' },
    { name: 'Strong\'s Hebrew', type: 'lexicon' },
    { name: 'Maps', type: 'maps' }
  ];
</script>

<div class="packs-pane">
  <h2>Installed Packs</h2>
  
  <div class="pack-list">
    {#each installedPacks as pack}
      <div class="pack-item">
        <div class="pack-info">
          <div class="pack-name">{pack.name}</div>
          <div class="pack-type">{pack.type}</div>
        </div>
        <button class="remove-btn">Remove</button>
      </div>
    {/each}
  </div>
  
  <div class="actions">
    <button class="primary-btn">Install from URL</button>
    <button class="primary-btn">Install from File</button>
  </div>
</div>

<style>
  .packs-pane {
    color: #e0e0e0;
  }
  
  h2 {
    font-size: 1.5rem;
    margin-bottom: 1.5rem;
    color: #f0f0f0;
  }
  
  .pack-list {
    margin-bottom: 2rem;
  }
  
  .pack-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }
  
  .pack-info {
    flex: 1;
  }
  
  .pack-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
  }
  
  .pack-type {
    font-size: 0.85rem;
    color: #888;
  }
  
  .remove-btn {
    padding: 0.5rem 1rem;
    background: rgba(220, 38, 38, 0.2);
    border: 1px solid rgba(220, 38, 38, 0.5);
    color: #ff6b6b;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .remove-btn:hover {
    background: rgba(220, 38, 38, 0.3);
  }
  
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .primary-btn {
    padding: 0.75rem 1rem;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.5);
    color: #60a5fa;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
  }
  
  .primary-btn:hover {
    background: rgba(59, 130, 246, 0.3);
  }
</style>
