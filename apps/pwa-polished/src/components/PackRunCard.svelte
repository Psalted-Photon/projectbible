<script lang="ts">
  import { reloadApp } from '../lib/back/webHistory';
  /**
   * Finishing a pack run on launch: the card shown while the app installs
   * what a background download brought after it was closed (resumePackRun),
   * and the Restart once it's done. Draws nothing the rest of the time.
   *
   * The Android app shows it while it unpacks the packs that came inside it
   * (setUpIncluded): on first launch, and after a new version of the app
   * brings changed ones. Kept out of the way while the tutorial is running,
   * which shows the same progress in its own chip.
   */
  import { fly } from '../lib/motion';
  import { ArrowClockwise, DownloadSimple } from 'phosphor-svelte';
  import {
    resumingRun,
    settingUp,
    setUpIncluded,
    restartNeeded,
    installStatus,
    installAllState,
  } from '../lib/packInstaller';
  import InstallBar from './InstallBar.svelte';
  import CloseX from './CloseX.svelte';
  import { IS_ANDROID_APP } from '../lib/platform';
  import { tutorial } from '../tutorial/state';

  /** Became true once a resumed run ended, so the card can offer the Restart. */
  let finished = false;
  let closed = false;
  let wasResuming = false;

  /** A run is under way: finishing a cut-short one, or the app's own setup. */
  $: running = $resumingRun || $settingUp;

  $: {
    if (running) wasResuming = true;
    else if (wasResuming) {
      wasResuming = false;
      finished = true;
    }
  }

  $: tutorialShowing = IS_ANDROID_APP && $tutorial.on && $tutorial.stage !== 'done';
  $: failed = $installAllState.failed;
  $: visible =
    !closed && !tutorialShowing && (running || (finished && ($restartNeeded || failed.length > 0)));

  function tryAgain() {
    finished = false;
    void setUpIncluded();
  }
</script>

{#if visible}
  <div class="pr-card" role="status" aria-live="polite" transition:fly={{ y: 16, duration: 220 }}>
    <span class="pr-icon">
      {#if running}
        <DownloadSimple size={20} weight="bold" />
      {:else}
        <ArrowClockwise size={20} weight="bold" />
      {/if}
    </span>
    <span class="pr-text">
      {#if running}
        <span class="pr-title">{IS_ANDROID_APP ? 'Setting up irisBible' : 'Finishing your packs'}</span>
        <span class="pr-sub">{$installStatus || 'Starting…'}<InstallBar /></span>
      {:else if failed.length > 0}
        <span class="pr-title">{IS_ANDROID_APP ? 'Some of it didn’t unpack' : 'Some packs didn’t finish'}</span>
        {#if IS_ANDROID_APP}
          <span class="pr-sub">
            {$installAllState.outOfSpace
              ? 'Not enough space on this phone. Free some up, then try again.'
              : failed.join(', ')}
          </span>
        {:else}
          <span class="pr-sub">{failed.join(', ')} · try again from Settings → Storage &amp; updates</span>
        {/if}
      {:else}
        <span class="pr-title">{IS_ANDROID_APP ? 'Everything is unpacked' : 'Packs installed'}</span>
        <span class="pr-sub">{IS_ANDROID_APP ? 'Restart to start using all of it' : 'Restart to start using them'}</span>
      {/if}
    </span>
    {#if !running && IS_ANDROID_APP && failed.length > 0}
      <button type="button" class="pr-restart" on:click={tryAgain}>Try again</button>
    {:else if !running && $restartNeeded}
      <button type="button" class="pr-restart" on:click={() => reloadApp()}>
        <ArrowClockwise size={16} weight="bold" /> Restart
      </button>
    {/if}
    {#if !running}
      <CloseX on:click={() => (closed = true)} />
    {/if}
  </div>
{/if}

<style>
  .pr-card {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    transform: translateX(-50%);
    z-index: 10050;
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(calc(100vw - 32px), 460px);
    padding: 10px 10px 10px 16px;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.92);
  }

  .pr-icon {
    display: flex;
    flex-shrink: 0;
    color: #e6b84a;
  }

  .pr-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pr-title {
    font-size: 0.92rem;
    font-weight: 600;
  }

  .pr-sub {
    font-size: 0.78rem;
    color: #e6b84a;
    overflow-wrap: anywhere;
  }

  .pr-restart {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid #e6b84a;
    border-radius: 8px;
    background: transparent;
    color: #e6b84a;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>
