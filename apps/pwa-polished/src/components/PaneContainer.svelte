<script lang="ts">
  import { usePaneStore } from '../stores/paneStore';
  import Pane from './Pane.svelte';
  import EdgeGestureDetector from './EdgeGestureDetector.svelte';
  
  const paneStore = usePaneStore;
  
  $: openPanes = $paneStore.panes.filter(p => p.isOpen);
</script>

<EdgeGestureDetector />

{#each openPanes as pane (pane.id)}
  <Pane {pane} />
{/each}

<style>
  /* No styles needed - panes are absolutely positioned */
</style>
