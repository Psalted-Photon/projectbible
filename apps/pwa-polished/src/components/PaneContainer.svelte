<script lang="ts">
  import { paneStore } from "../stores/paneStore";
  import Pane from "./Pane.svelte";

  $: openPanes = $paneStore.filter((p) => p.isOpen);
</script>

{#each openPanes as pane (pane.id)}
  <Pane {pane} />
{/each}

<style>
  /* No styles needed - panes are absolutely positioned */
</style>
