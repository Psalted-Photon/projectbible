<script lang="ts">
  /**
   * "A new version is available": what a feature shows when a pack it reads
   * has been updated on the release since it was installed.
   *
   * The Get packs card's counterpart, with the same gold download button.
   * Updating downloads in the background while the feature keeps using the
   * copy it has; the old copy is swapped out only once the new one is in (see
   * updatePack). Not now hides it for this session; Ignore this update hides
   * that version for good, and a later one still shows.
   *
   * Draws nothing at all when there is nothing to say, so it can sit at the top
   * of any feature. The Window frame carries one for every window type (see
   * WINDOW_PACKS); features outside windows place their own.
   */
  import { onMount } from 'svelte';
  import { DownloadSimple, ArrowClockwise } from 'phosphor-svelte';
  import {
    PACK_CATALOG,
    updatePack,
    installBusy,
    installMessage,
    installingPackId,
    restartNeeded,
    loadPackSizes,
    packSizeLabel,
    type CatalogPack,
    type PackSizes,
  } from '../lib/packInstaller';
  import {
    pendingUpdates,
    packUpdates,
    updatedThisSession,
    watchPackUpdates,
    notNowUpdate,
    ignoreUpdate,
    markUpdated,
  } from '../lib/packUpdates';
  import BrandSpinner from './BrandSpinner.svelte';

  /** Catalog ids of the packs this feature reads. */
  export let packs: string[];
  /** The feature picks the new data up by itself, so no restart is offered. */
  export let reloads = false;

  let sizes: PackSizes | null = null;
  /** The restart line, once closed, stays closed here. */
  let restartClosed = false;

  onMount(() => {
    watchPackUpdates();
    loadPackSizes().then((s) => (sizes = s));
  });

  $: catalog = packs
    .map((id) => PACK_CATALOG.find((p) => p.id === id))
    .filter((p): p is CatalogPack => !!p);
  $: waiting = catalog.filter((p) => $pendingUpdates[p.id] && $installingPackId !== p.id);
  $: updating = catalog.find((p) => $installingPackId === p.id && $packUpdates[p.id]);
  $: updated = !reloads && !restartClosed && $restartNeeded ? catalog.filter((p) => $updatedThisSession.has(p.id)) : [];

  async function update(pack: CatalogPack) {
    if (await updatePack(pack)) markUpdated(pack.id);
  }
</script>

{#if waiting.length || updating || updated.length}
  <div class="pu" role="status">
    {#each waiting as pack (pack.id)}
      <div class="pu-row">
        <span class="pu-icon" aria-hidden="true">{pack.icon}</span>
        <span class="pu-text">
          <span class="pu-name">New version of {pack.name}</span>
          <span class="pu-desc">You can keep using the one you have while it downloads.</span>
        </span>
        <div class="pu-actions">
          <button
            type="button"
            class="pu-get"
            disabled={$installBusy}
            title={$installBusy ? 'Another pack is installing' : `Download the new ${pack.name}`}
            on:click={() => update(pack)}
          >
            <DownloadSimple size={16} weight="bold" />
            <span>Update · {packSizeLabel(pack, sizes)}</span>
          </button>
          <button type="button" class="pu-quiet" on:click={() => notNowUpdate(pack.id)}>Not now</button>
          <button type="button" class="pu-quiet" on:click={() => ignoreUpdate(pack.id)}>Ignore this update</button>
        </div>
      </div>
    {/each}

    {#if updating}
      <div class="pu-row">
        <span class="pu-busy"><BrandSpinner size={20} title="Updating…" /></span>
        <span class="pu-text">
          <span class="pu-name">Updating {updating.name}</span>
          <span class="pu-progress">{$installMessage || 'Starting…'}</span>
        </span>
      </div>
    {/if}

    {#if !updating && updated.length}
      <div class="pu-row">
        <span class="pu-text">
          <span class="pu-name">{updated.map((p) => p.name).join(', ')} updated</span>
          <span class="pu-desc">Restart to use the new version.</span>
        </span>
        <div class="pu-actions">
          <button type="button" class="pu-restart" on:click={() => window.location.reload()}>
            <ArrowClockwise size={16} weight="bold" /> Restart
          </button>
          <button type="button" class="pu-quiet" on:click={() => (restartClosed = true)}>Later</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pu {
    flex: none;
    position: relative;
    z-index: 30;
    padding: 4px 12px;
    background: #1c1c1e;
    border-bottom: 1px solid rgba(230, 184, 74, 0.35);
    color: rgba(255, 255, 255, 0.92);
    text-align: left;
    font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }

  .pu-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 0;
  }
  .pu-row + .pu-row {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .pu-icon {
    font-size: 1.15rem;
    flex-shrink: 0;
    width: 1.5rem;
    text-align: center;
  }

  .pu-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1 1 180px;
  }
  .pu-name {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .pu-desc,
  .pu-progress {
    font-size: 0.78rem;
    color: #999;
    overflow-wrap: anywhere;
  }
  .pu-progress {
    color: #e6b84a;
  }

  .pu-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }

  /* The Get packs card's download button, to the pixel. */
  .pu-get {
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
  .pu-get:hover:not(:disabled) {
    background: #f0c75e;
  }
  .pu-get:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .pu-quiet {
    min-height: 36px;
    padding: 0 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #aaa;
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .pu-quiet:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }

  .pu-busy {
    display: inline-flex;
    flex-shrink: 0;
    width: 1.5rem;
    justify-content: center;
  }

  .pu-restart {
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
  .pu-restart:hover {
    background: rgba(230, 184, 74, 0.12);
  }

  .pu-get:focus-visible,
  .pu-quiet:focus-visible,
  .pu-restart:focus-visible {
    outline: 2px solid #e6b84a;
    outline-offset: 1px;
  }
</style>
