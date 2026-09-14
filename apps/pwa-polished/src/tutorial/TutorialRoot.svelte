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
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import { tutorial } from "./state";
  import { installShield } from "./engine/shield";
  import { wakeAlarmStartOpen } from "../stores/wakeAlarmStore";
  import { paneStore } from "../stores/paneStore";
  import { installAllState, restartNeeded } from "../lib/packInstaller";
  import { PART_ONE } from "./content/tour";
  import { PART_TWO } from "./content/tour-part-two";
  import { ALL_TIPS } from "./content/tips";
  import { diagnose } from "./engine/hotspots";
  import Splash from "./ui/Splash.svelte";
  import Tour from "./ui/Tour.svelte";
  import InstallChip from "./ui/InstallChip.svelte";
  import Hotspots from "./ui/Hotspots.svelte";

  let root: HTMLElement;
  let removeShield: (() => void) | null = null;

  onMount(() => {
    removeShield = installShield(root);
    // For eruda: which tips match on this screen, and which have a dot.
    (window as any).__tutorial = {
      tips: () => {
        const rows = diagnose(ALL_TIPS);
        console.table(rows);
        return rows;
      },
      dots: () => diagnose(ALL_TIPS).filter((row) => row.dot).map((row) => row.id),
      state: () => get(tutorial),
    };
  });
  onDestroy(() => {
    removeShield?.();
    delete (window as any).__tutorial;
  });

  // The wake alarm's start screen is somebody being woken up, so it goes first.
  // And switching the tutorial on from Settings waits for Settings to close,
  // rather than throwing the splash over the pane mid-tap.
  $: paneOpen = $paneStore.some((p) => p.isOpen);
  $: showSplash = $tutorial.stage === "start" && !$wakeAlarmStartOpen && !paneOpen;

  /**
   * After the first half: wait for packs that are still arriving (or need a
   * restart to switch on), otherwise go straight on to the second half.
   */
  function finishPartOne() {
    const waiting = get(installAllState).running || get(restartNeeded);
    tutorial.setStage(waiting ? "waiting" : "part2");
  }
</script>

<!-- The shield stops presses on anything in here reaching the app's
     tap-outside-to-close handlers. The edge-drag strip inside is exempt.
     Each half of the tour reads its bookmark once, as it mounts, to pick up
     where a restart left it. -->
<div class="tut-root" bind:this={root}>
  {#if $tutorial.stage === "start"}
    {#if showSplash}
      <Splash
        on:start={() => tutorial.setStage("part1")}
        on:skip={() => tutorial.setStage("done")}
      />
    {/if}
  {:else if $tutorial.stage === "part1"}
    <Tour
      steps={PART_ONE}
      startAt={$tutorial.checkpoint}
      on:checkpoint={(e) => tutorial.setCheckpoint(e.detail)}
      on:finish={finishPartOne}
      on:skip={() => tutorial.setStage("done")}
    />
  {:else if $tutorial.stage === "waiting"}
    <InstallChip on:done={() => tutorial.setStage("part2")} />
  {:else if $tutorial.stage === "part2"}
    <Tour
      steps={PART_TWO}
      startAt={$tutorial.checkpoint}
      on:checkpoint={(e) => tutorial.setCheckpoint(e.detail)}
      on:finish={() => tutorial.setStage("done")}
      on:skip={() => tutorial.setStage("done")}
    />
  {:else if $tutorial.stage === "done"}
    <Hotspots />
  {/if}
</div>
