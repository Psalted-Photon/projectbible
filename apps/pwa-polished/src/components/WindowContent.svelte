<script lang="ts">
  import type { WindowState } from "../lib/stores/windowStore";
  import WindowContentSelector from "./WindowContentSelector.svelte";
  import BibleReader from "./BibleReader.svelte";
  import MapPane from "./MapPane.svelte";
  import CommentaryReader from "./CommentaryReader.svelte";
  import JournalWriter from "./JournalWriter.svelte";
  import ArtPane from "./ArtPane.svelte";
  import IsbeContent from "./IsbeContent.svelte";

  // What goes inside a window, for every edge. WindowContainer renders one of
  // these per docked window; keeping the list here means a new content type is
  // added once rather than copied into all four edge containers.
  export let panel: WindowState;
</script>

{#if panel.contentType === 'selector'}
  <WindowContentSelector windowId={panel.id} />
{:else if panel.contentType === 'bible'}
  <BibleReader windowId={panel.id} />
{:else if panel.contentType === 'map'}
  <MapPane windowId={panel.id} />
{:else if panel.contentType === 'commentaries'}
  <CommentaryReader windowId={panel.id} />
{:else if panel.contentType === 'journal'}
  <JournalWriter windowId={panel.id} initialDate={panel.contentState?.date} />
{:else if panel.contentType === 'art'}
  <ArtPane
    sceneId={panel.contentState?.sceneId}
    book={panel.contentState?.book}
    chapter={panel.contentState?.chapter}
    verse={panel.contentState?.verse}
  />
{:else if panel.contentType === 'isbe'}
  <IsbeContent
    windowId={panel.id}
    kind={panel.contentState?.kind ?? 'entry'}
    entryId={panel.contentState?.entryId ?? null}
    placeId={panel.contentState?.placeId ?? null}
    primaryName={panel.contentState?.primaryName ?? ''}
    initialTab={panel.contentState?.tab ?? null}
    initialExpanded={panel.contentState?.expanded ?? {}}
    initialExpandedBooks={panel.contentState?.expandedBooks ?? []}
    initialVisited={panel.contentState?.visited ?? []}
    initialScrollTop={panel.contentState?.scrollTop ?? 0}
  />
{:else if panel.contentType === 'notes'}
  <div class="placeholder">
    <h2>Notes</h2>
    <p>Coming soon...</p>
  </div>
{:else if panel.contentType === 'wordstudy'}
  <div class="placeholder">
    <h2>Word Study</h2>
    <p>Coming soon...</p>
  </div>
{/if}

<style>
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    padding: 40px;
    text-align: center;
  }

  .placeholder h2 {
    font-size: 32px;
    margin-bottom: 16px;
    color: #e0e0e0;
  }

  .placeholder p {
    font-size: 18px;
  }
</style>
