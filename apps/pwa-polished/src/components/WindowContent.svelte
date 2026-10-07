<script lang="ts">
  import type { ComponentProps } from "svelte";
  import type { DockEdge, WindowState } from "../lib/stores/windowStore";
  import WindowContentSelector from "./WindowContentSelector.svelte";
  import BibleReader from "./BibleReader.svelte";
  // The timeline window's contents.
  import TimelinePane from "./TimelinePane.svelte";
  import CommentaryReader from "./CommentaryReader.svelte";
  import JournalWriter from "./JournalWriter.svelte";
  import JournalLockScreen from "./JournalLockScreen.svelte";
  import { journalLock } from "../lib/journalLock/lockState";
  import NotesPane from "./NotesPane.svelte";
  import ArtPane from "./ArtPane.svelte";
  import IsbeContent from "./IsbeContent.svelte";
  import PersonContent from "./PersonContent.svelte";
  import NavesContent from "./NavesContent.svelte";
  import LexicalContent from "./LexicalContent.svelte";
  import StrongsContent from "./strongs/StrongsContent.svelte";

  // The map window's contents load the first time a map window opens: the
  // pane and the map library are a large share of the app, and most sessions
  // never open a map.
  const loadAtlasPane = () => import("./AtlasPane.svelte");

  // What goes inside a window, for every edge. WindowContainer renders one of
  // these per docked window; keeping the list here means a new content type is
  // added once rather than copied into all four edge containers.
  export let panel: WindowState;

  // contentState is one loose shape shared by every window type. Each branch
  // below knows which work it holds, so it narrows the fields it passes on.
  type IsbeProps = ComponentProps<typeof IsbeContent>;
  type PersonProps = ComponentProps<typeof PersonContent>;
  type NavesProps = ComponentProps<typeof NavesContent>;
  type StrongsProps = ComponentProps<typeof StrongsContent>;
</script>

{#if panel.contentType === 'selector'}
  <WindowContentSelector windowId={panel.id} />
{:else if panel.contentType === 'bible'}
  <BibleReader windowId={panel.id} />
{:else if panel.contentType === 'map'}
  {#await loadAtlasPane() then { default: AtlasPane }}
    <AtlasPane windowId={panel.id} />
  {:catch}
    <p class="load-failed">The map couldn't load. Close this window and open it again.</p>
  {/await}
{:else if panel.contentType === 'timeline'}
  <TimelinePane windowId={panel.id} />
{:else if panel.contentType === 'commentaries'}
  <CommentaryReader windowId={panel.id} />
{:else if panel.contentType === 'journal'}
  <!-- Every way into the journal (J key, search, the calendar, a window
       restored on launch) arrives here, so the lock only has to guard this. -->
  {#if $journalLock.needsUnlock}
    <JournalLockScreen />
  {:else if $journalLock.ready}
    <JournalWriter initialDate={panel.contentState?.date} />
  {/if}
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
    initialTab={(panel.contentState?.tab ?? null) as IsbeProps['initialTab']}
    initialExpanded={panel.contentState?.expanded ?? {}}
    initialExpandedBooks={panel.contentState?.expandedBooks ?? []}
    initialVisited={panel.contentState?.visited ?? []}
    initialScrollTop={panel.contentState?.scrollTop ?? 0}
    initialTrail={(panel.contentState?.trail ?? []) as IsbeProps['initialTrail']}
  />
{:else if panel.contentType === 'person'}
  <PersonContent
    windowId={panel.id}
    personId={panel.contentState?.personId ?? null}
    initialTrail={(panel.contentState?.trail ?? []) as PersonProps['initialTrail']}
  />
{:else if panel.contentType === 'naves'}
  <NavesContent
    windowId={panel.id}
    topicId={panel.contentState?.topicId ?? null}
    primaryName={panel.contentState?.primaryName ?? ''}
    initialTab={(panel.contentState?.tab ?? null) as NavesProps['initialTab']}
    initialExpanded={panel.contentState?.expanded ?? {}}
    initialExpandedBooks={panel.contentState?.expandedBooks ?? []}
    initialScrollTop={panel.contentState?.scrollTop ?? 0}
    initialTrail={(panel.contentState?.trail ?? []) as NavesProps['initialTrail']}
  />
{:else if panel.contentType === 'notes'}
  <!-- Cast rather than widened: this component is only ever reached from the
       four docked containers in WindowContainer, so panel.edge cannot be
       'harmony' here even though the type allows it in general. -->
  <NotesPane windowId={panel.id} contentState={panel.contentState} edge={panel.edge as DockEdge} />
{:else if panel.contentType === 'strongs' || (panel.contentType === 'wordstudy' && panel.contentState?.strongsId)}
  <!-- A word study pinned before Strong's was its own work, holding an entry,
       opens here: the entry moved, and the window shouldn't lose it. -->
  <StrongsContent
    windowId={panel.id}
    strongsId={panel.contentState?.strongsId ?? null}
    search={panel.contentState?.strongsSearch ?? null}
    initialTab={(panel.contentState?.tab ?? null) as StrongsProps['initialTab']}
    initialTrail={(panel.contentState?.trail ?? []) as StrongsProps['initialTrail']}
  />
{:else if panel.contentType === 'wordstudy'}
  <LexicalContent
    windowId={panel.id}
    selectedText={panel.contentState?.selectedText ?? ''}
  />
{/if}

<style>
  .load-failed {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    opacity: 0.7;
  }
</style>
