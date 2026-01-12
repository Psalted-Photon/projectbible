<script lang="ts">
  import BibleReader from "./components/BibleReader.svelte";
  import PaneContainer from "./components/PaneContainer.svelte";
</script>

<div class="app-root">
  <BibleReader />
  <PaneContainer />
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  .app-root {
    width: 100%;
    height: 100vh;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
  }
</style>
