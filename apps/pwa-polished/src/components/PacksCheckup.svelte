<script lang="ts">
  /**
   * The packs check-up button in Settings → Storage & updates: one tap that
   * finds every pack this device hasn't got, every newer version of one it
   * has, and every Read Aloud voice it can run, and gets them all. Each feature
   * still offers its own pack where it's needed; this looks under every rug at
   * once, for someone who never saw the tutorial's Install everything.
   *
   * Tapping it opens a short list of what would download and how much, with
   * Get everything and Not now. Not now clears the dot until something new
   * turns up (see lib/packCheckup.ts).
   */
  import { onMount } from 'svelte';
  import {
    DownloadSimple,
    CheckCircle,
    ArrowClockwise,
    SpeakerHigh,
  } from 'phosphor-svelte';
  import {
    installAll,
    installAllState,
    installBusy,
    installStatus,
    restartNeeded,
    loadPackSizes,
    installBytesFor,
    estimateVoicesMB,
    formatBytes,
    type CatalogPack,
    type PackSizes,
  } from '../lib/packInstaller';
  import { checkup, checkupDot, checkupNotNow, refreshCheckup } from '../lib/packCheckup';
  import { showNotice } from '../stores/noticeStore';
  import PackIcon from './icons/PackIcon.svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import InstallBar from './InstallBar.svelte';
  import NotifyDot from './NotifyDot.svelte';

  const MB = 1024 * 1024;

  let sizes: PackSizes | null = null;
  let voiceMB = 0;
  let open = false;

  onMount(() => {
    void refreshCheckup();
    loadPackSizes().then((s) => (sizes = s));
  });

  $: void sizeVoices($checkup.voices);
  async function sizeVoices(voices: typeof $checkup.voices) {
    const mb = voices.length ? await estimateVoicesMB(voices).catch(() => 0) : 0;
    if (voices === $checkup.voices) voiceMB = mb;
  }

  function packBytes(pack: CatalogPack): number {
    return (sizes && installBytesFor(pack.id, sizes.bytes)) || parseFloat(pack.size) * MB || 0;
  }

  $: running = $installAllState.running;
  $: waiting = $checkup.missing.length + $checkup.updates.length + $checkup.voices.length;
  $: totalBytes =
    [...$checkup.missing, ...$checkup.updates].reduce((sum, p) => sum + packBytes(p), 0) +
    voiceMB * MB;
  $: if (!waiting || running) open = false;

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  $: summary = [
    $checkup.missing.length && plural($checkup.missing.length, 'pack', 'packs'),
    $checkup.updates.length && plural($checkup.updates.length, 'update', 'updates'),
    $checkup.voices.length && plural($checkup.voices.length, 'voice', 'voices'),
  ]
    .filter(Boolean)
    .join(' · ');

  async function getEverything() {
    open = false;
    const started = await installAll();
    if (!started) {
      showNotice("Something else is downloading. Try again when it's done.", 'error');
      return;
    }
    const state = $installAllState;
    if (state.outOfSpace) {
      showNotice('This device ran out of space before everything finished.', 'error');
    } else if (state.failed.length) {
      showNotice(`Couldn't finish: ${state.failed.join(', ')}. Tap the button to try again.`, 'error');
    }
  }

  function notNow() {
    checkupNotNow();
    open = false;
  }
</script>

<button
  class="checkup-button"
  class:open
  on:click={() => (open = !open)}
  disabled={running || $installBusy || !$checkup.counted || waiting === 0}
  aria-expanded={open}
>
  <NotifyDot show={$checkupDot && !running} />
  <span class="icon">
    {#if running}
      <BrandSpinner size={22} title="Getting packs…" />
    {:else if $checkup.counted && waiting === 0}
      <CheckCircle size={22} weight="bold" />
    {:else}
      <DownloadSimple size={22} weight="bold" />
    {/if}
  </span>
  <span class="text">
    {#if running}
      <span class="main">Getting packs · {$installAllState.step} of {$installAllState.total}</span>
      <span class="sub">{$installStatus || 'Starting…'}<InstallBar /></span>
    {:else if !$checkup.counted}
      <span class="main">Checking packs…</span>
    {:else if waiting === 0}
      <span class="main">Everything is up to date</span>
      <span class="sub">Every pack, update and voice is on this device</span>
    {:else}
      <span class="main">Get missing packs &amp; updates</span>
      <span class="sub">{summary} · {formatBytes(totalBytes)}</span>
    {/if}
  </span>
</button>

{#if open}
  <div class="checkup-card">
    <ul>
      {#each $checkup.updates as pack (pack.id)}
        <li>
          <PackIcon icons={pack.icons} size={16} />
          <span class="name">{pack.name}</span>
          <span class="tag">New version</span>
          <span class="size">{formatBytes(packBytes(pack))}</span>
        </li>
      {/each}
      {#each $checkup.missing as pack (pack.id)}
        <li>
          <PackIcon icons={pack.icons} size={16} />
          <span class="name">{pack.name}</span>
          <span class="tag">Not installed</span>
          <span class="size">{formatBytes(packBytes(pack))}</span>
        </li>
      {/each}
      {#if $checkup.voices.length}
        <li>
          <span class="voice-icon"><SpeakerHigh size={16} weight="bold" /></span>
          <span class="name">Read Aloud voices</span>
          <span class="tag">{$checkup.voices.length} to download</span>
          <span class="size">{voiceMB ? formatBytes(voiceMB * MB) : ''}</span>
        </li>
      {/if}
    </ul>
    <p class="note">Downloads one at a time. You can keep reading while it works.</p>
    <div class="actions">
      <button type="button" class="get" on:click={getEverything}>
        <DownloadSimple size={16} weight="bold" />
        <span>Get everything · {formatBytes(totalBytes)}</span>
      </button>
      <button type="button" class="quiet" on:click={notNow}>Not now</button>
    </div>
  </div>
{/if}

{#if !running && $restartNeeded}
  <div class="restart-row">
    <span>Restart the app to finish.</span>
    <button type="button" class="restart" on:click={() => window.location.reload()}>
      <ArrowClockwise size={16} weight="bold" /> Restart
    </button>
  </div>
{/if}

<style>
  /* Check for updates' button, to the pixel. */
  .checkup-button {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    margin-bottom: 0.75rem;
    background: linear-gradient(135deg, #1565c0 0%, #0288d1 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .checkup-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(2, 136, 209, 0.4);
  }
  .checkup-button:active:not(:disabled) {
    transform: translateY(0);
  }
  .checkup-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .checkup-button.open {
    margin-bottom: 0;
    border-radius: 6px 6px 0 0;
  }
  .icon {
    display: flex;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
  }
  .sub {
    font-size: 0.78rem;
    font-weight: 400;
    opacity: 0.85;
    overflow-wrap: anywhere;
  }

  .checkup-card {
    margin-bottom: 0.75rem;
    padding: 0.6rem 0.9rem 0.8rem;
    background: #1c1c1e;
    border: 1px solid #0288d1;
    border-top: none;
    border-radius: 0 0 6px 6px;
    color: rgba(255, 255, 255, 0.92);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    font-size: 0.88rem;
  }
  li + li {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }
  .voice-icon {
    display: inline-flex;
    min-width: 1.5rem;
    justify-content: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .tag {
    color: #999;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .size {
    color: #e6b84a;
    font-size: 0.78rem;
    white-space: nowrap;
    min-width: 4.5rem;
    text-align: right;
  }
  .note {
    margin: 0.5rem 0 0.6rem;
    color: #999;
    font-size: 0.78rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  /* The Get packs card's gold download button. */
  .get {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 12px;
    border: none;
    border-radius: 8px;
    background: #e6b84a;
    color: #1c1c1e;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .get:hover {
    background: #f0c75e;
  }
  .quiet {
    min-height: 36px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #aaa;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .quiet:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }

  .restart-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 0.75rem;
    color: #b0b0b0;
    font-size: 0.9rem;
  }
  .restart {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
  .restart:hover {
    background: rgba(230, 184, 74, 0.12);
  }
</style>
