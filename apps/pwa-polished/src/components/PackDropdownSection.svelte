<script lang="ts">
  /**
   * Packs offered inside a dropdown: "More Translations" under the installed
   * ones in the translation list, and the Commentaries pack in an empty
   * commentary author list.
   *
   * One row per pack, each with its own Download button. A row that was
   * already installed when the dropdown opened isn't drawn, and with none left
   * the section draws nothing. A row installed since stays, offering the
   * restart that shows it, since these lists are read once at startup.
   *
   * An installed pack with a newer version on the release gets a row of its
   * own under "New version available", with the same download button: the
   * update downloads while the old copy stays in use (updatePack). Not now and
   * Ignore put it off, as on PackUpdateNotice.
   */
  import { onMount } from 'svelte';
  import { DownloadSimple, ArrowClockwise } from 'phosphor-svelte';
  import { packInstallFinished } from '../adapters/db-manager';
  import {
    PACK_CATALOG,
    installPack,
    updatePack,
    installBusy,
    installMessage,
    installingPackId,
    loadPackSizes,
    packSizeLabel,
    type CatalogPack,
    type PackSizes,
  } from '../lib/packInstaller';
  import BrandSpinner from './BrandSpinner.svelte';
  import {
    pendingUpdates,
    packUpdates,
    watchPackUpdates,
    notNowUpdate,
    ignoreUpdate,
    markUpdated,
  } from '../lib/packUpdates';

  export let heading: string;
  /**
   * `updateOnly`: a pack that is offered here only when it has a new version,
   * never as a fresh install (TSK in the translation list, whose own dropdown
   * only opens while it is missing).
   */
  export let rows: { packId: string; label: string; contents: string; updateOnly?: boolean }[];
  /** What the restart brings, after "Installed. Restart to …". */
  export let restartFor = 'use it';

  let sizes: PackSizes | null = null;
  /** Installed when the dropdown opened: those rows don't show at all. */
  let alreadyIn: Record<string, boolean> | null = null;
  /** Installed since: the row stays, offering the restart that shows them. */
  let justIn: Record<string, boolean> = {};

  onMount(async () => {
    watchPackUpdates();
    loadPackSizes().then((s) => (sizes = s));
    const results = await Promise.all(
      rows.map((r) => packInstallFinished(r.packId).catch(() => false)),
    );
    alreadyIn = Object.fromEntries(rows.map((r, i) => [r.packId, results[i]]));
  });

  function packFor(id: string): CatalogPack | undefined {
    return PACK_CATALOG.find((p) => p.id === id);
  }

  async function download(id: string) {
    const pack = packFor(id);
    if (!pack) return;
    if (await installPack(pack)) justIn = { ...justIn, [id]: true };
  }

  $: visible = alreadyIn ? rows.filter((r) => !alreadyIn![r.packId] && !r.updateOnly) : [];

  /** Updated while the dropdown was open: the row stays, offering the restart. */
  let justUpdated: Record<string, boolean> = {};
  $: updateRows = alreadyIn
    ? rows.filter(
        (r) =>
          alreadyIn![r.packId] &&
          ($pendingUpdates[r.packId] || justUpdated[r.packId] || ($installingPackId === r.packId && $packUpdates[r.packId])),
      )
    : [];

  async function update(id: string) {
    const pack = packFor(id);
    if (!pack) return;
    if (await updatePack(pack)) {
      markUpdated(id);
      justUpdated = { ...justUpdated, [id]: true };
    }
  }
</script>

{#if visible.length > 0}
  <div class="mt-section">
    <div class="mt-head">{heading}</div>
    {#each visible as row (row.packId)}
      {@const pack = packFor(row.packId)}
      <div class="mt-row">
        <span class="mt-text">
          <span class="mt-label">{row.label}</span>
          {#if $installingPackId === row.packId}
            <span class="mt-progress">{$installMessage || 'Starting…'}</span>
          {:else if justIn[row.packId]}
            <span class="mt-contents">Installed. Restart to {restartFor}.</span>
          {:else}
            <span class="mt-contents">{row.contents}</span>
          {/if}
        </span>
        {#if justIn[row.packId]}
          <button type="button" class="mt-btn mt-restart" on:click={() => window.location.reload()}>
            <ArrowClockwise size={14} weight="bold" /> Restart
          </button>
        {:else if $installingPackId === row.packId}
          <span class="mt-busy"><BrandSpinner size={20} title="Installing…" /></span>
        {:else if pack}
          <button
            type="button"
            class="mt-btn"
            disabled={$installBusy}
            title={$installBusy ? 'Another pack is installing' : `Download ${pack.name}`}
            on:click={() => download(row.packId)}
          >
            <DownloadSimple size={14} weight="bold" /> {packSizeLabel(pack, sizes)}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if updateRows.length > 0}
  <div class="mt-section">
    <div class="mt-head">New version available</div>
    {#each updateRows as row (row.packId)}
      {@const pack = packFor(row.packId)}
      <div class="mt-row">
        <span class="mt-text">
          <span class="mt-label">{row.label}</span>
          {#if $installingPackId === row.packId}
            <span class="mt-progress">{$installMessage || 'Starting…'}</span>
          {:else if justUpdated[row.packId]}
            <span class="mt-contents">Updated. Restart to {restartFor}.</span>
          {:else}
            <span class="mt-contents">You can keep using this one while the new one downloads.</span>
            <span class="mt-later">
              <button type="button" class="mt-link" on:click={() => notNowUpdate(row.packId)}>Not now</button>
              <button type="button" class="mt-link" on:click={() => ignoreUpdate(row.packId)}>Ignore this update</button>
            </span>
          {/if}
        </span>
        {#if justUpdated[row.packId]}
          <button type="button" class="mt-btn mt-restart" on:click={() => window.location.reload()}>
            <ArrowClockwise size={14} weight="bold" /> Restart
          </button>
        {:else if $installingPackId === row.packId}
          <span class="mt-busy"><BrandSpinner size={20} title="Updating…" /></span>
        {:else if pack}
          <button
            type="button"
            class="mt-btn"
            disabled={$installBusy}
            title={$installBusy ? 'Another pack is installing' : `Download the new ${pack.name}`}
            on:click={() => update(row.packId)}
          >
            <DownloadSimple size={14} weight="bold" /> Update · {packSizeLabel(pack, sizes)}
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .mt-section {
    padding-bottom: 4px;
  }

  /* A hairline on whichever side meets the rest of the dropdown. */
  .mt-section:not(:first-child) {
    border-top: 1px solid #3a3a3a;
  }

  .mt-section:not(:last-child) {
    border-bottom: 1px solid #3a3a3a;
    margin-bottom: 4px;
  }

  .mt-head {
    padding: 8px 14px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #888;
  }

  .mt-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px 6px 14px;
  }

  .mt-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .mt-label {
    font-size: 14px;
    color: #e0e0e0;
  }

  .mt-contents,
  .mt-progress {
    font-size: 11.5px;
    line-height: 1.3;
    color: #999;
    overflow-wrap: anywhere;
  }

  .mt-progress {
    color: #e6b84a;
  }

  .mt-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    min-height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: #e6b84a;
    color: #1c1c1e;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mt-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .mt-restart {
    background: transparent;
    border: 1px solid #e6b84a;
    color: #e6b84a;
  }

  .mt-later {
    display: flex;
    gap: 10px;
    margin-top: 2px;
  }

  .mt-link {
    padding: 2px 0;
    border: none;
    background: none;
    color: #aaa;
    font-size: 11.5px;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    touch-action: manipulation;
  }

  .mt-link:hover {
    color: #fff;
  }

  .mt-busy {
    display: inline-flex;
    flex-shrink: 0;
    padding: 0 6px;
  }
</style>
