<script lang="ts">
  /**
   * Paintings of this passage, offered as card backgrounds.
   *
   * They come from the Art pack, which is public-domain art already on the
   * device, so nothing is fetched and there is nothing to licence. The chapter's
   * scenes are listed nearest-first: the scene whose heading sits just above
   * the shared verse is almost always the one being quoted.
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { ArtWork } from '@projectbible/core';
  import { IndexedDBArtStore } from '../adapters/ArtStore';

  export let book: string;
  export let chapter: number;
  export let verse: number;
  /** The painting currently on the card, to mark it. */
  export let selectedId: string | null = null;

  const dispatch = createEventDispatcher<{ pick: { imageId: string; credit: string } }>();
  const store = new IndexedDBArtStore();

  interface Choice {
    work: ArtWork;
    scene: string;
    thumb: string | null;
  }

  let choices: Choice[] = [];
  let loading = true;

  function creditFor(w: ArtWork): string {
    const artist = w.artist && !/^unknown$/i.test(w.artist) ? w.artist : '';
    const who = [artist, w.year].filter(Boolean).join(', ');
    return who ? `${w.title} — ${who}` : w.title;
  }

  onMount(async () => {
    const scenes = await store.getScenesForChapter(book, chapter);
    // Headings at or above the verse first, nearest first; then any below it.
    scenes.sort((a, b) => {
      const da = a.verse <= verse ? verse - a.verse : 1000 + a.verse - verse;
      const db = b.verse <= verse ? verse - b.verse : 1000 + b.verse - verse;
      return da - db;
    });
    choices = scenes.flatMap((s) => s.works.map((work) => ({ work, scene: s.title, thumb: null })));
    loading = false;
    // Previews one by one: each may have to be made from a multi-megabyte original.
    for (let i = 0; i < choices.length; i++) {
      const w = choices[i].work;
      const thumb = await store.getThumbUrl(w.thumbId || w.imageId);
      if (!choices[i]) break;
      choices[i] = { ...choices[i], thumb };
    }
  });

  onDestroy(() => store.releaseImages());
</script>

{#if loading}
  <p class="scp-note">Looking for paintings…</p>
{:else if choices.length === 0}
  <p class="scp-note">
    No paintings of this chapter. Paintings come from the Art pack, which you can add in Packs.
  </p>
{:else}
  <div class="scp-grid">
    {#each choices as c (c.work.imageId)}
      <button
        class="scp-tile"
        class:active={selectedId === c.work.imageId}
        title="{c.scene}: {creditFor(c.work)}"
        on:click={() => dispatch('pick', { imageId: c.work.imageId, credit: creditFor(c.work) })}
      >
        {#if c.thumb}
          <img src={c.thumb} alt={c.work.title} />
        {:else}
          <span class="scp-wait"></span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .scp-note {
    margin: 4px 2px;
    font-size: 0.75rem;
    color: #888;
    line-height: 1.4;
  }

  .scp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 6px;
  }

  .scp-tile {
    aspect-ratio: 1;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    background: #222;
    cursor: pointer;
  }
  .scp-tile.active { border-color: #9fd0ff; }
  .scp-tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .scp-wait {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, #222, #2c2c2c, #222);
  }
</style>
