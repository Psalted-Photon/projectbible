<!-- ProgressModal.svelte -->
<script lang="ts">
  import type { DownloadProgress } from '../../../../packages/core/src/services/PackLoader';
  
  export let progress: DownloadProgress | null = null;
  export let visible = false;
  
  $: percentage = progress?.percentage || 0;
  $: stage = (progress?.stage || 'downloading') as string;
  $: packId = progress?.packId || '';
  
  const stageLabels: Record<string, string> = {
    downloading: 'Downloading',
    validating: 'Validating',
    extracting: 'Extracting',
    caching: 'Caching',
    complete: 'Complete'
  };
  
  $: stageLabel = stageLabels[stage] || stage;
  $: loaded = progress ? (progress.loaded / (1024 * 1024)).toFixed(1) : '0';
  $: total = progress ? (progress.total / (1024 * 1024)).toFixed(1) : '0';
</script>

{#if visible && progress}
  <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" on:click|self={() => {}} on:keydown={() => {}}>
    <div class="progress-modal">
      <h2>Loading Pack</h2>
      
      <div class="pack-info">
        <div class="pack-name">{packId}</div>
        <div class="stage">{stageLabel}</div>
      </div>
      
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: {percentage}%"></div>
      </div>
      
      <div class="progress-stats">
        <span class="percentage">{percentage}%</span>
        {#if stage === 'downloading'}
          <span class="size">{loaded} MB / {total} MB</span>
        {/if}
      </div>
      
      {#if stage === 'complete'}
        <button class="close-btn" on:click={() => visible = false}>Close</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  }
  
  .progress-modal {
    background: var(--surface, #2a2a2a);
    border-radius: 12px;
    padding: 30px;
    min-width: 400px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  
  h2 {
    margin: 0 0 20px 0;
    color: var(--text-primary, #ffffff);
    font-size: 20px;
    font-weight: 600;
  }
  
  .pack-info {
    margin-bottom: 20px;
  }
  
  .pack-name {
    color: var(--text-primary, #ffffff);
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 4px;
  }
  
  .stage {
    color: var(--text-secondary, #aaaaaa);
    font-size: 14px;
  }
  
  .progress-bar-container {
    width: 100%;
    height: 8px;
    background: var(--surface-elevated, #1a1a1a);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  
  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50, #8BC34A);
    transition: width 0.3s ease;
    border-radius: 4px;
  }
  
  .progress-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--text-secondary, #aaaaaa);
    font-size: 14px;
  }
  
  .percentage {
    font-weight: 600;
    color: var(--text-primary, #ffffff);
  }
  
  .size {
    font-variant-numeric: tabular-nums;
  }
  
  .close-btn {
    margin-top: 20px;
    width: 100%;
    padding: 12px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .close-btn:hover {
    background: #45a049;
  }
  
  .close-btn:active {
    transform: scale(0.98);
  }
</style>
