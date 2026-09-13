<script lang="ts">
  /**
   * The tutorial's one foothold in the app.
   *
   * Mounted once in App.svelte. While Tutorial Mode is off it renders nothing
   * and loads nothing: the tutorial itself (its screens, its theme, its fonts)
   * is a separate chunk fetched the first time it is switched on.
   */
  import type { Component } from "svelte";
  import { tutorial } from "./state";

  let Root: Component | null = null;
  // Tried once per session. Offline with the chunk never cached, a retry would
  // only fail again -- and retrying from here would loop.
  let requested = false;

  $: if ($tutorial.on && !requested) {
    requested = true;
    import("./TutorialRoot.svelte")
      .then((m) => (Root = m.default as unknown as Component))
      .catch((error) => console.warn("[Tutorial] Could not load:", error));
  }
</script>

{#if $tutorial.on && Root}
  <svelte:component this={Root} />
{/if}
