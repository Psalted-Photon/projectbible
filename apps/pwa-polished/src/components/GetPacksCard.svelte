<script lang="ts">
  /**
   * "Get packs": what a feature shows when the pack it needs isn't on this
   * device, in place of a dead-end message.
   *
   * One row per pack the feature needs, each with its size and its own
   * Download button. The row that is installing shows the progress; a pack
   * that's in shows a tick. Restart appears once something has finished,
   * because most features read their packs once, at startup.
   *
   * The install itself is packInstaller's installPack, the same one Manage
   * Packs uses, so the lock, the space check and the notices are shared. A
   * pack whose install was cut short shows here too, and downloading it again
   * repairs it.
   */
  import { onMount } from 'svelte';
  import { CheckCircle, DownloadSimple, ArrowClockwise } from 'phosphor-svelte';
  import { packInstallFinished, listInstalledPacks } from '../adapters/db-manager';
  import {
    PACK_CATALOG,
    installPack,
    installBusy,
    installMessage,
    installingPackId,
    restartNeeded,
    loadPackSizes,
    packSizeLabel,
    type CatalogPack,
    type PackSizes,
  } from '../lib/packInstaller';
  import BrandSpinner from './BrandSpinner.svelte';

  /** Catalog ids of the packs this feature needs, in the order to list them. */
  export let packs: string[];
  export let title = 'Get packs';
  /** One line on what the packs bring here. */
  export let note = '';
  /**
   * Offer "Download again" even for a pack that looks installed: for a
   * feature that found part of its pack missing, which the install check
   * can't always see.
   */
  export let repair = false;

  $: list = packs
    .map((id) => PACK_CATALOG.find((p) => p.id === id))
    .filter((p): p is CatalogPack => !!p);

  let sizes: PackSizes | null = null;
  /** Which of them are fully installed. Unknown until the first check. */
  let done: Record<string, boolean> = {};

  async function check() {
    const results = await Promise.all(
      list.map((p) => packInstallFinished(p.id).catch(() => false)),
    );
    done = Object.fromEntries(list.map((p, i) => [p.id, results[i]]));
  }

  onMount(() => {
    void check();
    loadPackSizes().then((s) => (sizes = s));
    // An install from anywhere else (Manage Packs, another card) counts too.
    const onPacks = () => void check();
    window.addEventListener('packsUpdated', onPacks);
    return () => window.removeEventListener('packsUpdated', onPacks);
  });

  async function download(pack: CatalogPack) {
    // A row with no finished install behind it is one that was cut short.
    // Clear it first, the way Manage Packs re-downloads, so this repairs it
    // rather than finding the version already "installed" and stopping.
    const leftover =
      repair || (await listInstalledPacks().catch(() => [])).some((p) => p.id === pack.id);
    await installPack(pack, { replaceExisting: leftover });
    await check();
  }
</script>

<div class="gp-card">
  <h3 class="gp-title">{title}</h3>
  {#if note}
    <p class="gp-note">{note}</p>
  {/if}

  <ul class="gp-list">
    {#each list as pack (pack.id)}
      <li class="gp-row">
        <span class="gp-icon" aria-hidden="true">{pack.icon}</span>
        <span class="gp-text">
          <span class="gp-name">{pack.name}</span>
          {#if $installingPackId === pack.id}
            <span class="gp-progress">{$installMessage || 'Starting…'}</span>
          {:else}
            <span class="gp-desc">{pack.description}</span>
          {/if}
        </span>
        {#if done[pack.id] && !repair}
          <span class="gp-done"><CheckCircle size={18} weight="fill" /> Installed</span>
        {:else if $installingPackId === pack.id}
          <span class="gp-busy"><BrandSpinner size={22} title="Installing…" /></span>
        {:else}
          <button
            type="button"
            class="gp-get"
            disabled={$installBusy}
            title={$installBusy ? 'Another pack is installing' : `Download ${pack.name}`}
            on:click={() => download(pack)}
          >
            <DownloadSimple size={16} weight="bold" />
            <span>{done[pack.id] ? "Download again" : packSizeLabel(pack, sizes)}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if $installBusy && !$installingPackId}
    <p class="gp-note gp-wait">Another download is running. These can start when it finishes.</p>
  {/if}

  {#if $restartNeeded && !$installBusy}
    <div class="gp-restart">
      <span>New packs switch on after a restart.</span>
      <button type="button" class="gp-restart-btn" on:click={() => window.location.reload()}>
        <ArrowClockwise size={16} weight="bold" /> Restart
      </button>
    </div>
  {/if}
</div>

<style>
  .gp-card {
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 14px 14px 10px;
    color: rgba(255, 255, 255, 0.92);
    text-align: left;
  }

  .gp-title {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .gp-note {
    margin: 0 0 10px;
    font-size: 0.85rem;
    line-height: 1.45;
    color: #aaa;
  }

  .gp-wait {
    margin: 8px 0 4px;
  }

  .gp-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .gp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .gp-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
    width: 1.5rem;
    text-align: center;
  }

  .gp-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .gp-name {
    font-size: 0.92rem;
    font-weight: 600;
  }

  .gp-desc,
  .gp-progress {
    font-size: 0.78rem;
    line-height: 1.35;
    color: #999;
    overflow-wrap: anywhere;
  }

  .gp-progress {
    color: #e6b84a;
  }

  .gp-get {
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

  .gp-get:hover:not(:disabled) {
    background: #f0c75e;
  }

  .gp-get:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .gp-done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    font-size: 0.8rem;
    color: #8bc34a;
  }

  .gp-busy {
    display: inline-flex;
    flex-shrink: 0;
    padding: 0 7px;
  }

  .gp-restart {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 0.85rem;
    color: #ccc;
  }

  .gp-restart-btn {
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

  .gp-restart-btn:hover {
    background: rgba(230, 184, 74, 0.12);
  }
</style>
