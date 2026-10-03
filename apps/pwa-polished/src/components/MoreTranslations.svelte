<script lang="ts">
  /**
   * "More Translations", under the installed ones in the translation dropdown.
   *
   * Two rows, one per pack, each with its own Download button. A row goes away
   * once its pack is in; until the app restarts it says so, since the list of
   * translations is read once at startup.
   */
  import { onMount } from 'svelte';
  import { DownloadSimple, ArrowClockwise } from 'phosphor-svelte';
  import { packInstallFinished } from '../adapters/db-manager';
  import {
    PACK_CATALOG,
    installPack,
    installBusy,
    installMessage,
    installingPackId,
    loadPackSizes,
    packSizeLabel,
    type CatalogPack,
    type PackSizes,
  } from '../lib/packInstaller';
  import BrandSpinner from './BrandSpinner.svelte';

  const ROWS: { packId: string; label: string; contents: string }[] = [
    { packId: 'translations', label: 'English', contents: 'KJV, WEB, BSB, LXX2012' },
    { packId: 'ancient-languages', label: 'Ancient Languages', contents: 'Hebrew, Greek NT, LXX' },
  ];

  let sizes: PackSizes | null = null;
  /** Installed when the dropdown opened: those rows don't show at all. */
  let alreadyIn: Record<string, boolean> | null = null;
  /** Installed since: the row stays, offering the restart that shows them. */
  let justIn: Record<string, boolean> = {};

  onMount(async () => {
    loadPackSizes().then((s) => (sizes = s));
    const results = await Promise.all(
      ROWS.map((r) => packInstallFinished(r.packId).catch(() => false)),
    );
    alreadyIn = Object.fromEntries(ROWS.map((r, i) => [r.packId, results[i]]));
  });

  function packFor(id: string): CatalogPack | undefined {
    return PACK_CATALOG.find((p) => p.id === id);
  }

  async function download(id: string) {
    const pack = packFor(id);
    if (!pack) return;
    if (await installPack(pack)) justIn = { ...justIn, [id]: true };
  }

  $: visible = alreadyIn ? ROWS.filter((r) => !alreadyIn![r.packId]) : [];
</script>

{#if visible.length > 0}
  <div class="mt-section">
    <div class="mt-head">More Translations</div>
    {#each visible as row (row.packId)}
      {@const pack = packFor(row.packId)}
      <div class="mt-row">
        <span class="mt-text">
          <span class="mt-label">{row.label}</span>
          {#if $installingPackId === row.packId}
            <span class="mt-progress">{$installMessage || 'Starting…'}</span>
          {:else if justIn[row.packId]}
            <span class="mt-contents">Installed. Restart to read them.</span>
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

<style>
  .mt-section {
    border-top: 1px solid #3a3a3a;
    padding-bottom: 4px;
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

  .mt-busy {
    display: inline-flex;
    flex-shrink: 0;
    padding: 0 6px;
  }
</style>
