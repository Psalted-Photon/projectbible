<script lang="ts">
  /**
   * The small lime chip shown between the two halves of the tour, while packs
   * install.
   *
   * It follows the shared installer rather than keeping any count of its own:
   * installing, then "restart to switch them on" once the run ends, and -- if
   * the run was cut short (the phone reclaimed the tab, or something failed) --
   * a Resume that runs Install All again, which picks up where it stopped.
   * When nothing is left and nothing needs a restart, the tour moves on.
   */
  import { createEventDispatcher, onMount } from "svelte";
  import { fly } from "svelte/transition";
  import {
    installAll,
    installAllState,
    restartNeeded,
    packsStillToInstall,
    voicesStillToInstall,
  } from "../../lib/packInstaller";
  import { appQuiet } from "../engine/watch";
  import { paneStore } from "../../stores/paneStore";

  const dispatch = createEventDispatcher<{ done: void }>();

  let remaining: number | null = null;

  async function countRemaining() {
    const [packs, voices] = await Promise.all([packsStillToInstall(), voicesStillToInstall()]);
    remaining = packs.length + voices.length;
    if (remaining === 0 && !$restartNeeded && !$installAllState.running) dispatch("done");
  }

  onMount(() => {
    if (!$installAllState.running && !$restartNeeded) void countRemaining();
  });

  // A run that ends without anything to restart for (every item failed) goes
  // back to counting what is left.
  let wasRunning = $installAllState.running;
  $: if (wasRunning !== $installAllState.running) {
    wasRunning = $installAllState.running;
    if (!wasRunning && !$restartNeeded) void countRemaining();
  }

  $: running = $installAllState.running;
  $: progress = $installAllState.total ? $installAllState.step / $installAllState.total : 0;
  $: visible = $appQuiet && !$paneStore.some((p) => p.isOpen);
</script>

{#if visible}
  <div class="chip no-edge-gesture" role="status" transition:fly={{ y: 24, duration: 220 }}>
    {#if running}
      <span class="text">
        Installing packs · {$installAllState.step} of {$installAllState.total}
      </span>
      <span class="bar"><span class="fill" style="width:{Math.round(progress * 100)}%"></span></span>
    {:else if $restartNeeded}
      <span class="text">Packs installed</span>
      <button class="tut-btn chip-btn" on:click={() => window.location.reload()}>Restart</button>
    {:else if remaining !== null && remaining > 0}
      <span class="text">
        {$installAllState.outOfSpace ? "Out of storage" : "Some packs didn't finish"}
      </span>
      <button class="tut-btn-ghost chip-btn" on:click={() => dispatch("done")}>Skip</button>
      <button class="tut-btn chip-btn" on:click={() => void installAll()}>Resume</button>
    {/if}
  </div>
{/if}

<style>
  .chip {
    position: fixed;
    left: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: var(--tut-z);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.5rem 0.7rem;
    max-width: calc(100vw - 32px);
    padding: 0.55rem 0.9rem;
    background: var(--tut-card);
    border: 1px solid var(--tut-lime);
    border-radius: 999px;
    box-shadow: 0 0 20px rgba(198, 255, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
  }

  .text {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--tut-text);
    white-space: nowrap;
  }

  .bar {
    width: 72px;
    height: 4px;
    border-radius: 2px;
    background: var(--tut-lime-faint);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--tut-lime);
    transition: width 0.4s ease;
  }

  .chip :global(.chip-btn) {
    padding: 0.35rem 0.8rem;
    font-size: 0.74rem;
    border-radius: 999px;
  }
</style>
