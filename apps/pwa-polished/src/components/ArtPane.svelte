<script lang="ts">
  import type { ArtScene, ArtWork } from '@projectbible/core';
  import { IndexedDBArtStore } from '../adapters/ArtStore';

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
  let urls: Record<string, string> = {}; // image id → object URL (resolved from bundled blobs)

  const thumbIdOf = (w: ArtWork) => w.thumbId || w.imageId;

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

    if (selected) await resolveImages(selected.works.map((w) => w.imageId));
    else if (browse) await resolveImages(allScenes.map((s) => (s.works[0] ? thumbIdOf(s.works[0]) : undefined)));
  }

  // Reload whenever the incoming context changes (also fires once on init)
  $: load(sceneId, book, chapter, verse);

  async function pick(scene: ArtScene) {
    selected = scene;
    await resolveImages(scene.works.map((w) => w.imageId));
  }

  function backToList() {
    selected = null;
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
              <a
                class="img-link"
                href={work.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open source page (Wikimedia Commons)"
              >
                {#if urls[work.imageId]}
                  <img src={urls[work.imageId]} alt={work.title} />
                {:else}
                  <div class="img-placeholder"></div>
                {/if}
              </a>
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
                {#if work.license}
                  <span class="work-license">{work.license}</span>
                {/if}
              </figcaption>
            </figure>
          {/each}
        </div>
      {/if}
    </div>
  {:else if browse}
    <header class="scene-head browse-head">
      <h2>Biblical Art</h2>
    </header>
    {#if allScenes.length === 0}
      <div class="state">
        No art installed yet. Install the <strong>Biblical Art</strong> pack to see famous
        paintings tied to scenes in Scripture.
      </div>
    {:else}
      <ul class="scene-list">
        {#each allScenes as scene (scene.id)}
          <li>
            <button class="scene-btn" on:click={() => pick(scene)}>
              {#if scene.works[0] && urls[thumbIdOf(scene.works[0])]}
                <img class="scene-thumb" src={urls[thumbIdOf(scene.works[0])]} alt="" />
              {:else}
                <span class="scene-thumb placeholder"></span>
              {/if}
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

  .gallery {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 18px 16px 28px;
  }

  .work { margin: 0; }
  .img-link { display: block; }
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
  .work-license { font-size: 11px; color: #777; margin-top: 2px; }

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
    width: 52px;
    height: 52px;
    object-fit: cover;
    border-radius: 6px;
    background: #111;
    flex-shrink: 0;
  }
  .scene-thumb.placeholder { background: #262626; }
  .scene-btn-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .scene-btn-title { font-size: 15px; color: #efefef; }
  .scene-btn-ref { font-size: 12px; color: #b98a4b; }
</style>
