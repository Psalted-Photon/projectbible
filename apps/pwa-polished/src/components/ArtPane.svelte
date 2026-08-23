<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ArtScene, ArtWork } from '@projectbible/core';
  import { IndexedDBArtStore } from '../adapters/ArtStore';
  import {
    getArtSettings,
    updateArtSettings,
    ART_PREVIEW_MIN,
    ART_PREVIEW_MAX,
    ART_GRID_THRESHOLD,
  } from '../adapters/settings';
  import ArtViewer from './ArtViewer.svelte';

  // Populated from the window's contentState (see WindowContainer)
  export let sceneId: string | undefined = undefined;
  export let book: string | undefined = undefined;
  export let chapter: number | undefined = undefined;
  export let verse: number | undefined = undefined;

  const artStore = new IndexedDBArtStore();

  let loading = true;
  let error: string | null = null;
  let allScenes: ArtScene[] = [];      // browse list (only when no scene context)
  let browse = false;                  // opened with no scene → show the browsable list
  let selected: ArtScene | null = null;
  let urls: Record<string, string> = {};   // image id → object URL (full resolution)
  let thumbs: Record<string, string> = {}; // image id → object URL (downscaled preview)

  /** Painting currently open in the fullscreen viewer, if any. */
  let viewerWork: ArtWork | null = null;

  /** Preview edge in CSS px; the smallest value is the pane's original look. */
  let previewSize = ART_PREVIEW_MIN;
  $: gridMode = previewSize >= ART_GRID_THRESHOLD;

  const thumbIdOf = (w: ArtWork) => w.thumbId || w.imageId;
  const sceneThumbId = (s: ArtScene) => (s.works[0] ? thumbIdOf(s.works[0]) : undefined);

  onMount(() => {
    previewSize = getArtSettings().previewSize;
  });

  let persistTimer: number | undefined;
  /** Debounced so dragging the slider doesn't write on every tick. */
  function onSizeInput() {
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => updateArtSettings({ previewSize }), 200);
  }

  // ===== Previews =====
  //
  // The pack ships no usable thumbnails, so every tile would otherwise decode a
  // multi-megabyte JPEG. Ask for a downscaled copy instead, and only once the
  // tile is near the viewport — 78 scenes generated eagerly would mean scrolling
  // to Revelation waits behind Genesis.

  let observer: IntersectionObserver | null = null;

  async function loadThumb(id: string) {
    if (thumbs[id]) return;
    const url = await artStore.getThumbUrl(id);
    if (url) thumbs = { ...thumbs, [id]: url };
  }

  function lazyThumb(node: HTMLElement, id: string | undefined) {
    if (!id) return {};
    if (thumbs[id]) return {};

    if (typeof IntersectionObserver === 'undefined') {
      void loadThumb(id);
      return {};
    }

    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const target = entry.target as HTMLElement;
            observer?.unobserve(target);
            const wanted = target.dataset.thumbId;
            if (wanted) void loadThumb(wanted);
          }
        },
        { rootMargin: '300px 0px' }
      );
    }

    node.dataset.thumbId = id;
    observer.observe(node);
    return {
      destroy() {
        observer?.unobserve(node);
      },
    };
  }

  async function resolveImages(ids: (string | undefined)[]) {
    const need = [...new Set(ids)].filter((id): id is string => !!id && !urls[id]);
    if (need.length === 0) return;
    const next = { ...urls };
    await Promise.all(
      need.map(async (id) => {
        const u = await artStore.getImageUrl(id);
        if (u) next[id] = u;
      })
    );
    urls = next;
  }

  async function load(_a?: unknown, _b?: unknown, _c?: unknown, _d?: unknown) {
    loading = true;
    error = null;
    selected = null;
    browse = false;
    allScenes = [];
    viewerWork = null;
    try {
      if (sceneId) {
        selected = await artStore.getScene(sceneId);
      } else if (book && chapter && verse) {
        const scenes = await artStore.getScenesForVerse({ book, chapter, verse });
        selected = scenes[0] ?? null;
      } else {
        browse = true;
        allScenes = await artStore.getAllScenes();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }

    // Browse previews load lazily through the observer; only the open scene's
    // full-resolution images are resolved up front.
    if (selected) await resolveImages(selected.works.map((w) => w.imageId));
  }

  // Reload whenever the incoming context changes (also fires once on init)
  $: load(sceneId, book, chapter, verse);

  // Object URLs keep their blob alive until revoked, so hand them back when the
  // pane closes instead of leaving the gallery pinned in memory for the session.
  onDestroy(() => {
    clearTimeout(persistTimer);
    observer?.disconnect();
    artStore.releaseImages();
    urls = {};
    thumbs = {};
  });

  async function pick(scene: ArtScene) {
    selected = scene;
    await resolveImages(scene.works.map((w) => w.imageId));
  }

  function backToList() {
    selected = null;
  }

  function openViewer(work: ArtWork) {
    if (!urls[work.imageId]) return;
    viewerWork = work;
  }
</script>

<div class="art-pane">
  {#if loading}
    <div class="state">Loading…</div>
  {:else if error}
    <div class="state error">Couldn’t load art: {error}</div>
  {:else if selected}
    <div class="scene">
      {#if browse}
        <button class="back" on:click={backToList}>‹ All scenes</button>
      {/if}
      <header class="scene-head">
        <h2>{selected.title}</h2>
        {#if selected.passageLabel}<span class="passage">{selected.passageLabel}</span>{/if}
      </header>

      {#if selected.works.length === 0}
        <div class="state">No artworks in this scene yet.</div>
      {:else}
        <div class="gallery">
          {#each selected.works as work (work.imageId)}
            <figure class="work">
              <button
                class="img-btn"
                on:click={() => openViewer(work)}
                title="View full screen"
                aria-label="View {work.title} full screen"
              >
                {#if urls[work.imageId]}
                  <img src={urls[work.imageId]} alt={work.title} />
                {:else}
                  <div class="img-placeholder"></div>
                {/if}
              </button>
              <figcaption>
                <span class="work-title">{work.title}</span>
                {#if work.artist || work.year}
                  <span class="work-meta">
                    {work.artist ?? 'Unknown'}{work.year ? `, ${work.year}` : ''}
                  </span>
                {/if}
                {#if work.description}
                  <span class="work-desc">{work.description}</span>
                {/if}
                <span class="work-foot">
                  {#if work.license}<span class="work-license">{work.license}</span>{/if}
                  {#if work.sourceUrl}
                    <a
                      class="work-source"
                      href={work.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer">Wikimedia Commons ↗</a
                    >
                  {/if}
                </span>
              </figcaption>
            </figure>
          {/each}
        </div>
      {/if}
    </div>
  {:else if browse}
    <header class="scene-head browse-head">
      <h2>Biblical Art</h2>
      {#if allScenes.length > 0}
        <div class="size-control">
          <span class="size-hint" aria-hidden="true">▪</span>
          <input
            type="range"
            min={ART_PREVIEW_MIN}
            max={ART_PREVIEW_MAX}
            step="4"
            bind:value={previewSize}
            on:input={onSizeInput}
            aria-label="Preview size"
            title="Preview size"
          />
          <span class="size-hint big" aria-hidden="true">◼</span>
        </div>
      {/if}
    </header>
    {#if allScenes.length === 0}
      <div class="state">
        No art installed yet. Install the <strong>Biblical Art</strong> pack to see famous
        paintings tied to scenes in Scripture.
      </div>
    {:else if gridMode}
      <ul class="scene-grid" style="--art-tile:{previewSize}px">
        {#each allScenes as scene (scene.id)}
          {@const tid = sceneThumbId(scene)}
          <li>
            <button class="tile-btn" on:click={() => pick(scene)}>
              <span class="tile-frame" use:lazyThumb={tid}>
                {#if tid && thumbs[tid]}
                  <img src={thumbs[tid]} alt="" loading="lazy" />
                {/if}
              </span>
              <span class="tile-title">{scene.title}</span>
              {#if scene.passageLabel && previewSize >= 110}
                <span class="tile-ref">{scene.passageLabel}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="scene-list" style="--art-thumb:{previewSize}px">
        {#each allScenes as scene (scene.id)}
          {@const tid = sceneThumbId(scene)}
          <li>
            <button class="scene-btn" on:click={() => pick(scene)}>
              <span class="scene-thumb" use:lazyThumb={tid}>
                {#if tid && thumbs[tid]}
                  <img src={thumbs[tid]} alt="" loading="lazy" />
                {/if}
              </span>
              <span class="scene-btn-text">
                <span class="scene-btn-title">{scene.title}</span>
                {#if scene.passageLabel}<span class="scene-btn-ref">{scene.passageLabel}</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="state">No art for this passage yet.</div>
  {/if}
</div>

{#if viewerWork && urls[viewerWork.imageId]}
  <ArtViewer
    src={urls[viewerWork.imageId]}
    title={viewerWork.title}
    artist={viewerWork.artist}
    year={viewerWork.year}
    license={viewerWork.license}
    sourceUrl={viewerWork.sourceUrl}
    on:close={() => (viewerWork = null)}
  />
{/if}

<style>
  .art-pane {
    height: 100%;
    overflow-y: auto;
    background: #1f1f1f;
    color: #e6e6e6;
    -webkit-overflow-scrolling: touch;
  }

  .state {
    padding: 32px 24px;
    color: #9a9a9a;
    font-size: 15px;
    line-height: 1.5;
    text-align: center;
  }
  .state.error { color: #e6a1a1; }

  .scene-head {
    padding: 18px 20px 10px;
    border-bottom: 1px solid #333;
    position: sticky;
    top: 0;
    background: #1f1f1f;
    z-index: 1;
  }
  .scene-head h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: #f2f2f2;
  }
  .passage {
    display: block;
    margin-top: 3px;
    font-size: 13px;
    color: #b98a4b;
    letter-spacing: 0.02em;
  }

  .back {
    display: inline-block;
    margin: 12px 0 0 16px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid #444;
    border-radius: 6px;
    color: #cfcfcf;
    font-size: 13px;
    cursor: pointer;
  }
  .back:hover { border-color: #b98a4b; color: #f2f2f2; }

  /* ===== Preview size slider ===== */

  .size-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .size-hint {
    color: #6f6f6f;
    font-size: 8px;
    line-height: 1;
    flex-shrink: 0;
  }
  .size-hint.big { font-size: 14px; }

  .size-control input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 6px;
    border-radius: 3px;
    background: #3a3a3a;
    outline: none;
    cursor: pointer;
  }
  .size-control input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #b98a4b;
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .size-control input[type='range']::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }
  .size-control input[type='range']::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: #b98a4b;
    cursor: pointer;
  }

  /* ===== Scene detail ===== */

  .gallery {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 18px 16px 28px;
  }

  .work { margin: 0; }
  .img-btn {
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: zoom-in;
  }
  .work img {
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    background: #111;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
    display: block;
  }
  .img-placeholder {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: 8px;
    background: linear-gradient(110deg, #222 30%, #2c2c2c 50%, #222 70%);
  }

  figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
  }
  .work-title { font-size: 15px; font-weight: 600; color: #efefef; }
  .work-meta { font-size: 13px; color: #b7b7b7; }
  .work-desc { font-size: 13px; color: #9a9a9a; line-height: 1.45; margin-top: 2px; }
  .work-foot {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 2px;
  }
  .work-license { font-size: 11px; color: #777; }
  /* The image opens the viewer now, so the source page needs its own way out. */
  .work-source { font-size: 11px; color: #8f6f42; text-decoration: none; }
  .work-source:hover { text-decoration: underline; color: #b98a4b; }

  /* ===== Browse: row list (small previews) ===== */

  .scene-list {
    list-style: none;
    margin: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .scene-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .scene-btn:hover { background: #2a2a2a; border-color: #3a3a3a; }
  .scene-thumb {
    width: var(--art-thumb, 52px);
    height: var(--art-thumb, 52px);
    border-radius: 6px;
    background: #262626;
    flex-shrink: 0;
    overflow: hidden;
    display: block;
  }
  .scene-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .scene-btn-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .scene-btn-title { font-size: 15px; color: #efefef; }
  .scene-btn-ref { font-size: 12px; color: #b98a4b; }

  /* ===== Browse: tile grid (larger previews) ===== */

  .scene-grid {
    list-style: none;
    margin: 0;
    padding: 10px;
    display: grid;
    /* min(…, 100%) matters: the window can be dragged narrow, and without it a
       wide tile overflows into a horizontal scrollbar instead of reflowing. */
    grid-template-columns: repeat(auto-fill, minmax(min(var(--art-tile, 96px), 100%), 1fr));
    gap: 12px;
  }
  .tile-btn {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    padding: 0;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .tile-frame {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    background: #262626;
    overflow: hidden;
  }
  .tile-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.18s ease;
  }
  .tile-btn:hover .tile-frame img { transform: scale(1.04); }
  .tile-title {
    font-size: 13px;
    line-height: 1.3;
    color: #efefef;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tile-ref { font-size: 11px; color: #b98a4b; }
</style>
