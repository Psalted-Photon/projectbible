<script lang="ts">
  /**
   * A new version of the Android app (the APK from irisbible.com): the offer,
   * the download's progress, and Install. Driven by lib/android/appUpdate.ts;
   * mounted in App.svelte inside the app only. Draws nothing the rest of the
   * time.
   *
   * Kept out of the way while the app is unpacking or waiting on a Restart
   * (PackRunCard has the bottom of the screen then) and while the tutorial
   * runs. Closing it doesn't stop a download: Android's downloader carries
   * on, shows its progress in the notification shade, and the card comes back
   * with Install when it's done.
   */
  import { fly } from '../lib/motion';
  import { ArrowCircleUp, CheckCircle, DownloadSimple, ShieldCheck, WarningCircle } from 'phosphor-svelte';
  import CloseX from './CloseX.svelte';
  import {
    appUpdate,
    appUpdateHidden,
    startAppUpdate,
    downloadAppUpdate,
    installAppUpdate,
    snoozeAppUpdate,
    cancelAppUpdate,
    sizeText,
  } from '../lib/android/appUpdate';
  import type { UpdatePhase } from '../lib/android/appUpdate';
  import { settingUp, restartNeeded } from '../lib/packInstaller';
  import { tutorial } from '../tutorial/state';

  $: phase = $appUpdate;
  $: busyElsewhere = $settingUp || $restartNeeded || ($tutorial.on && $tutorial.stage !== 'done');
  $: visible = phase.kind !== 'idle' && !$appUpdateHidden && !busyElsewhere;

  $: percent =
    phase.kind === 'downloading' && phase.total > 0 ? Math.min(100, Math.floor((phase.downloaded / phase.total) * 100)) : 0;

  function failText(p: Extract<UpdatePhase, { kind: 'failed' }>): string {
    switch (p.reason) {
      case 'space':
        return p.needed
          ? `Not enough space on this phone. It needs about ${sizeText(p.needed)} free while it updates.`
          : 'Not enough space on this phone. Free some up, then try again.';
      case 'missing':
        return "That version isn't on irisbible.com anymore. Try again later.";
      case 'damaged':
        return 'The download came through damaged. Try again.';
      case 'installer':
        return "Android's installer didn't open. Try again.";
      case 'network':
        return 'The connection dropped. Try again, ideally on Wi-Fi.';
      default:
        return "The phone couldn't save the download. Try again.";
    }
  }

  function close() {
    // A failed download is cleared; one under way carries on without the card.
    if (phase.kind === 'failed') void cancelAppUpdate();
    else if (phase.kind === 'offer') snoozeAppUpdate(phase.next.versionCode);
    else appUpdateHidden.set(true);
  }

  function tryAgain() {
    if (phase.kind === 'failed' && phase.next) void startAppUpdate(phase.next);
    else void cancelAppUpdate();
  }
</script>

{#if visible}
  <div class="au-card" role="status" aria-live="polite" transition:fly={{ y: 16, duration: 220 }}>
    <div class="au-top">
      <span class="au-icon" class:au-warn={phase.kind === 'failed'}>
        {#if phase.kind === 'offer' || phase.kind === 'metered'}
          <ArrowCircleUp size={22} weight="bold" />
        {:else if phase.kind === 'downloading'}
          <DownloadSimple size={22} weight="bold" />
        {:else if phase.kind === 'ready'}
          <CheckCircle size={22} weight="bold" />
        {:else if phase.kind === 'permission'}
          <ShieldCheck size={22} weight="bold" />
        {:else}
          <WarningCircle size={22} weight="bold" />
        {/if}
      </span>
      <span class="au-text">
        {#if phase.kind === 'offer'}
          <span class="au-title">New version of irisBible</span>
          <span class="au-sub">{phase.next.versionName} · {sizeText(phase.next.apk.bytes)} download</span>
          {#if phase.next.notes}<span class="au-notes">{phase.next.notes}</span>{/if}
        {:else if phase.kind === 'metered'}
          <span class="au-title">You're on mobile data</span>
          <span class="au-sub">The update is {sizeText(phase.next.apk.bytes)}. Download it now, or wait for Wi-Fi?</span>
        {:else if phase.kind === 'downloading'}
          <span class="au-title">Downloading the update</span>
          <span class="au-sub">
            {#if phase.waiting === 'wifi'}
              Waiting for Wi-Fi…
            {:else if phase.waiting === 'network'}
              Waiting for a connection…
            {:else if phase.total > 0}
              {percent}% · {sizeText(phase.downloaded)} of {sizeText(phase.total)}
            {:else}
              Starting…
            {/if}
            <span class="au-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
              <span class="au-fill" style="width:{percent}%"></span>
            </span>
          </span>
        {:else if phase.kind === 'ready'}
          <span class="au-title">Update ready</span>
          <span class="au-sub">irisBible closes for a moment while it installs. Your notes and settings stay.</span>
        {:else if phase.kind === 'permission'}
          <span class="au-title">One more step</span>
          <span class="au-sub">Allow irisBible to install apps, then come back here.</span>
        {:else if phase.kind === 'failed'}
          <span class="au-title">The update didn't download</span>
          <span class="au-sub">{failText(phase)}</span>
        {/if}
      </span>
      <CloseX on:click={close} />
    </div>

    <div class="au-actions">
      {#if phase.kind === 'offer'}
        <button type="button" class="au-quiet" on:click={() => phase.kind === 'offer' && snoozeAppUpdate(phase.next.versionCode)}>Not now</button>
        <button type="button" class="au-main" on:click={() => phase.kind === 'offer' && startAppUpdate(phase.next)}>Update</button>
      {:else if phase.kind === 'metered'}
        <button type="button" class="au-quiet" on:click={() => phase.kind === 'metered' && downloadAppUpdate(phase.next, false)}>Wait for Wi-Fi</button>
        <button type="button" class="au-main" on:click={() => phase.kind === 'metered' && downloadAppUpdate(phase.next, true)}>Download now</button>
      {:else if phase.kind === 'downloading'}
        <button type="button" class="au-quiet" on:click={cancelAppUpdate}>Cancel</button>
      {:else if phase.kind === 'ready'}
        <button type="button" class="au-quiet" on:click={() => appUpdateHidden.set(true)}>Later</button>
        <button type="button" class="au-main" on:click={installAppUpdate}>Install</button>
      {:else if phase.kind === 'permission'}
        <button type="button" class="au-main" on:click={installAppUpdate}>Allow</button>
      {:else if phase.kind === 'failed'}
        <button type="button" class="au-main" on:click={tryAgain}>Try again</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .au-card {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    transform: translateX(-50%);
    z-index: 10050;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(calc(100vw - 32px), 460px);
    padding: 12px 10px 10px 16px;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    color: rgba(255, 255, 255, 0.92);
  }

  .au-top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .au-icon {
    display: flex;
    flex-shrink: 0;
    padding-top: 1px;
    color: #e6b84a;
  }

  .au-icon.au-warn {
    color: #f0a46b;
  }

  .au-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .au-title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .au-sub {
    font-size: 0.8rem;
    color: #e6b84a;
    overflow-wrap: anywhere;
  }

  .au-notes {
    margin-top: 4px;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.7);
    overflow-wrap: anywhere;
  }

  .au-bar {
    display: block;
    width: 100%;
    height: calc(3px * var(--bar-scale, 1));
    margin-top: calc(6px * var(--bar-scale, 1));
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 22%, transparent);
    overflow: hidden;
  }

  .au-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: currentColor;
    transition: width 0.3s ease;
  }

  .au-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .au-actions:empty {
    display: none;
  }

  .au-main,
  .au-quiet {
    min-height: 36px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .au-main {
    border: 1px solid #e6b84a;
    background: #e6b84a;
    color: #1c1c1e;
  }

  .au-quiet {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
  }
</style>
