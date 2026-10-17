<script lang="ts">
  /**
   * Finishing a pack run on launch: the card shown while the app installs
   * what a background download brought after it was closed (resumePackRun),
   * and the Restart once it's done. Draws nothing the rest of the time.
   */
  import { fly } from '../lib/motion';
  import { ArrowClockwise, DownloadSimple } from 'phosphor-svelte';
  import {
    resumingRun,
    restartNeeded,
    installStatus,
    installAllState,
  } from '../lib/packInstaller';
  import InstallBar from './InstallBar.svelte';
  import CloseX from './CloseX.svelte';

  /** Became true once a resumed run ended, so the card can offer the Restart. */
  let finished = false;
  let closed = false;
  let wasResuming = false;

  $: {
    if ($resumingRun) wasResuming = true;
    else if (wasResuming) {
      wasResuming = false;
      finished = true;
    }
  }

  $: failed = $installAllState.failed;
  $: visible = !closed && ($resumingRun || (finished && ($restartNeeded || failed.length > 0)));
</script>

{#if visible}
  <div class="pr-card" role="status" aria-live="polite" transition:fly={{ y: 16, duration: 220 }}>
    <span class="pr-icon">
      {#if $resumingRun}
        <DownloadSimple size={20} weight="bold" />
      {:else}
        <ArrowClockwise size={20} weight="bold" />
      {/if}
    </span>
    <span class="pr-text">
      {#if $resumingRun}
        <span class="pr-title">Finishing your packs</span>
        <span class="pr-sub">{$installStatus || 'Starting…'}<InstallBar /></span>
      {:else if failed.length > 0}
        <span class="pr-title">Some packs didn’t finish</span>
        <span class="pr-sub">{failed.join(', ')} · try again from Settings → Storage &amp; updates</span>
      {:else}
        <span class="pr-title">Packs installed</span>
        <span class="pr-sub">Restart to start using them</span>
      {/if}
    </span>
    {#if !$resumingRun && $restartNeeded}
      <button type="button" class="pr-restart" on:click={() => window.location.reload()}>
        <ArrowClockwise size={16} weight="bold" /> Restart
      </button>
    {/if}
    {#if !$resumingRun}
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
