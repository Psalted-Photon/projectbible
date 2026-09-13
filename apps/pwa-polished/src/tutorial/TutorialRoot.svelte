<script lang="ts">
  /**
   * Everything Tutorial Mode draws, loaded only while it is on.
   *
   * Sits at the app root, outside the reader. The light and sepia themes put a
   * colour-flipping filter on the reader, and anything fixed inside a filtered
   * box is positioned against that box instead of the screen; out here neither
   * happens.
   */
  import "./theme.css";
  import { tutorial } from "./state";
  import { wakeAlarmStartOpen } from "../stores/wakeAlarmStore";
  import { paneStore } from "../stores/paneStore";
  import Splash from "./ui/Splash.svelte";

  // The wake alarm's start screen is somebody being woken up, so it goes first.
  // And switching the tutorial on from Settings waits for Settings to close,
  // rather than throwing the splash over the pane mid-tap.
  $: paneOpen = $paneStore.some((p) => p.isOpen);
  $: showSplash = $tutorial.stage === "start" && !$wakeAlarmStartOpen && !paneOpen;
</script>

<!-- no-edge-gesture: a tap on a tutorial screen near the edge of the phone must
     not start the app's drag-out-a-window gesture underneath it. -->
<div class="tut-root no-edge-gesture">
  {#if showSplash}
    <Splash
      on:start={() => tutorial.setStage("part1")}
      on:skip={() => tutorial.setStage("done")}
    />
  {/if}
</div>
