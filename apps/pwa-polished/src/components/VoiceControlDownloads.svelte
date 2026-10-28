<script lang="ts">
  /**
   * Voice Control's two downloads, one row each: its size and Download button,
   * the progress while it downloads, then Downloaded with a Delete. An update
   * on the release shows as Update.
   *
   * Settings passes `hideInstalled`: there a download that's in, and up to
   * date, is no row at all, so an empty list means everything is downloaded.
   *
   * Looks like GetPacksCard, but these are model files kept by
   * lib/voice/voicePack.ts, not catalog packs, so nothing needs a restart.
   */
  import { onMount } from 'svelte';
  import { CheckCircle, DownloadSimple, Trash } from 'phosphor-svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import InstallBar from './InstallBar.svelte';
  import { installBusy, installStatus, formatBytes } from '../lib/packInstaller';
  import { askConfirm } from '../stores/confirmStore';
  import {
    VOICE_DOWNLOADS,
    VOICE_DOWNLOADS_EVENT,
    voiceInstallingId,
    voiceDownloadState,
    installVoiceDownload,
    removeVoiceDownload,
    type VoiceDownload,
    type VoiceDownloadId,
    type VoiceDownloadState,
  } from '../lib/voice/voicePack';

  /** Which of the two to list. The mic button's card lists Voice Control alone. */
  export let ids: VoiceDownloadId[] = VOICE_DOWNLOADS.map((d) => d.id);
  /** Leave out what's downloaded and up to date, and the Delete with it. */
  export let hideInstalled = false;

  let states: Partial<Record<string, VoiceDownloadState>> = {};

  // Hidden until looked at too, so a downloaded row doesn't flash up first.
  $: shown = VOICE_DOWNLOADS.filter(
    (d) =>
      ids.includes(d.id) &&
      (!hideInstalled ||
        $voiceInstallingId === d.id ||
        (states[d.id] && (!states[d.id]!.installed || states[d.id]!.update))),
  );

  async function check() {
    const results = await Promise.all(VOICE_DOWNLOADS.map((d) => voiceDownloadState(d.id).catch(() => null)));
    states = Object.fromEntries(VOICE_DOWNLOADS.map((d, i) => [d.id, results[i] ?? undefined]));
  }

  onMount(() => {
    void check();
    const again = () => void check();
    window.addEventListener(VOICE_DOWNLOADS_EVENT, again);
    return () => window.removeEventListener(VOICE_DOWNLOADS_EVENT, again);
  });

  async function remove(d: VoiceDownload) {
    const ok = await askConfirm(`Delete ${d.name} from this device? You can download it again any time.`, {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await removeVoiceDownload(d.id);
  }
</script>

{#if shown.length}
<ul class="vc-list">
  {#each shown as d (d.id)}
    {@const s = states[d.id]}
    <li class="vc-row">
      <span class="vc-text">
        <span class="vc-name">{d.name}</span>
        {#if $voiceInstallingId === d.id}
          <span class="vc-progress">{$installStatus || 'Starting…'}<InstallBar /></span>
        {:else if s && !s.available}
          <span class="vc-desc">Not on the download server yet.</span>
        {:else}
          <span class="vc-desc">{d.description}</span>
        {/if}
      </span>
      {#if $voiceInstallingId === d.id}
        <span class="vc-busy"><BrandSpinner size={22} title="Downloading…" /></span>
      {:else if s?.installed}
        {#if s.update}
          <button
            type="button"
            class="vc-get"
            disabled={$installBusy}
            title={`Update ${d.name}`}
            on:click={() => installVoiceDownload(d.id)}
          >
            <DownloadSimple size={16} weight="bold" />
            <span>Update · {formatBytes(s.bytes)}</span>
          </button>
        {:else}
          <span class="vc-done"><CheckCircle size={18} weight="fill" /> Downloaded</span>
        {/if}
        {#if !hideInstalled}
          <button
            type="button"
            class="vc-delete"
            disabled={$installBusy}
            title={`Delete ${d.name}`}
            aria-label={`Delete ${d.name}`}
            on:click={() => remove(d)}
          >
            <Trash size={16} weight="bold" />
          </button>
        {/if}
      {:else if s?.available}
        <button
          type="button"
          class="vc-get"
          disabled={$installBusy}
          title={$installBusy ? 'Another download is running' : `Download ${d.name}`}
          on:click={() => installVoiceDownload(d.id)}
        >
          <DownloadSimple size={16} weight="bold" />
          <span>{formatBytes(s.bytes)}</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>
{/if}

<style>
  .vc-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .vc-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .vc-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .vc-name {
    font-size: 0.92rem;
    font-weight: 600;
  }

  .vc-desc,
  .vc-progress {
    font-size: 0.78rem;
    line-height: 1.35;
    color: #999;
    overflow-wrap: anywhere;
  }

  .vc-progress {
    color: #e6b84a;
  }

  .vc-get {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
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

  .vc-get:hover:not(:disabled) {
    background: #f0c75e;
  }

  .vc-get:disabled,
  .vc-delete:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .vc-done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    font-size: 0.8rem;
    color: #8bc34a;
  }

  .vc-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: transparent;
    color: #bbb;
    cursor: pointer;
  }

  .vc-delete:hover:not(:disabled) {
    color: #f08a8a;
    border-color: #f08a8a;
  }

  .vc-busy {
    display: inline-flex;
    flex-shrink: 0;
    padding: 0 7px;
  }
</style>
