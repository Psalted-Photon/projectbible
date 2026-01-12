<script lang="ts">
  import BibleReader from './components/BibleReader.svelte';
  import PaneContainer from './components/PaneContainer.svelte';
</script>

<div class="app-root">
  <BibleReader />
  <PaneContainer />
</div>

<style>
  .app-root {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }
</style>
