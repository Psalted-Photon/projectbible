<script lang="ts">
  import { get } from "svelte/store";
  import { windowStore } from "../lib/stores/windowStore";
  import { navigationStore } from "../stores/navigationStore";
  import { libraryPrefsStore, resumeTarget } from "../stores/libraryPrefsStore";
  import { localDateStr } from '../stores/clockStore';
  import { DEFAULT_TRANSLATION } from "../lib/bibleData";
  import PanelIcon from "./icons/PanelIcon.svelte";
  import type { PanelIconName } from "./icons/PanelIcon.svelte";

  export let windowId: string;

  type ContentType = 'bible' | 'map' | 'notes' | 'isbe' | 'person' | 'naves' | 'commentaries' | 'journal' | 'art';

  /**
   * The nine tiles. Accents are borrowed from colors the app already uses — the
   * book-category ramp in bibleData.ts and the nav bar's badge palette — so the
   * picker reads as part of the same app rather than a new color scheme.
   */
  const TILES: { type: ContentType; icon: PanelIconName; label: string; accent: string }[] = [
    { type: 'bible',        icon: 'bible',        label: 'Bible',        accent: '#a67c52' },
    { type: 'map',          icon: 'map',          label: 'Map',          accent: '#61f1ff' },
    { type: 'commentaries', icon: 'commentary',   label: 'Commentary',   accent: '#a3e635' },
    { type: 'notes',        icon: 'notes',        label: 'Notes',        accent: '#fde047' },
    { type: 'journal',      icon: 'journal',      label: 'Journal',      accent: '#f2893e' },
    { type: 'isbe',         icon: 'encyclopedia', label: 'Encyclopedia', accent: '#4a90e2' },
    { type: 'naves',        icon: 'topical',      label: 'Topical',      accent: '#a78bfa' },
    { type: 'person',       icon: 'people',       label: 'People',       accent: '#2dd4bf' },
    { type: 'art',          icon: 'art',          label: 'Art',          accent: '#fb7185' },
  ];

  function handleContentSelect(contentType: ContentType) {
    // Set initial content state based on type
    let contentState = {};

    if (contentType === 'bible') {
      contentState = {
        translation: DEFAULT_TRANSLATION,
        book: 'Genesis',
        chapter: 1,
      };
    } else if (contentType === 'commentaries') {
      const navState = $navigationStore;
      // The first commentary window takes the anchor and follows the reader, so
      // it opens with no pinned position. Any later one is a deliberate second
      // view, so it opens frozen where the reader is now.
      const isFirst = !get(windowStore).some(w => w.contentType === 'commentaries');
      contentState = isFirst
        ? { author: undefined, anchored: true }
        : {
            author: undefined,
            anchored: false,
            book: navState.book,
            chapter: navState.chapter,
          };
    } else if (contentType === 'map') {
      contentState = {
        center: [31.7683, 35.2137], // Jerusalem
        zoom: 8,
      };
    } else if (contentType === 'journal') {
      contentState = {
        date: localDateStr(new Date()), // Today
      };
    } else if (contentType === 'notes') {
      contentState = {
        view: 'browse',
      };
    } else if (contentType === 'isbe' || contentType === 'person' || contentType === 'naves') {
      // Land back on what you were reading only if you closed this shelf a few
      // minutes ago — enough to undo a misfired close, not enough to hand you
      // yesterday's lookup. Otherwise open on the contents. Either way the entry
      // stays in Recently Viewed and one flip away.
      const prefs = get(libraryPrefsStore);
      if (contentType === 'isbe') {
        const last = resumeTarget(prefs, 'isbe');
        contentState = last
          ? { kind: 'entry', entryId: Number(last.id), placeId: null, primaryName: last.name }
          : {};
      } else if (contentType === 'person') {
        const last = resumeTarget(prefs, 'people');
        contentState = last ? { personId: String(last.id), primaryName: last.name } : {};
      } else {
        const last = resumeTarget(prefs, 'naves');
        contentState = last ? { topicId: Number(last.id), primaryName: last.name } : {};
      }
    }

    windowStore.setWindowContent(windowId, contentType, contentState);
  }
</script>

<div class="content-selector">
  <div class="button-grid">
    {#each TILES as tile (tile.type)}
      <button
        class="content-button {tile.type}"
        style="--accent: {tile.accent}"
        on:click={() => handleContentSelect(tile.type)}
      >
        <span class="badge"><PanelIcon name={tile.icon} /></span>
        <span class="label">{tile.label}</span>
      </button>
    {/each}
  </div>

  <p class="instruction">Select a content type to fill this window</p>
</div>

<style>
  /* The grid and the caption each take an auto margin on their outer edge, so
     the pair sits centred while there is room and simply starts at the top once
     there isn't. `justify-content: center` used to do the centring, which meant
     an overflowing grid spilled off both ends and put the first row out of
     reach — a panel dragged short could not scroll back up to it. */
  .content-selector {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    height: 100%;
    padding: 16px;
    gap: 12px;
    box-sizing: border-box;
  }

  /* auto-fill measures the panel, not the viewport, which is the only thing
     that works here: a panel's width is an inline percentage set by the drag,
     so no media query can see it. Narrow side panel lands on 2 columns, a wide
     bottom panel on 5, and all nine tiles stay on screen either way.

     The min() guards the floor: a bare minmax(96px, …) keeps its 96px minimum
     even once the panel is narrower than that, and the grid starts overflowing
     sideways. Wrapped in min(…, 100%) the single column gives up and shrinks
     instead, so a panel dragged down to a sliver never scrolls horizontally. */
  .button-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(96px, 100%), 1fr));
    gap: 10px;
    width: 100%;
    margin-top: auto;
  }

  .content-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    padding: 12px 8px;
    background: #232323;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    color: #e0e0e0;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
  }

  .content-button:hover {
    background: #2a2a2a;
    border-color: #667eea;
  }

  .content-button:active {
    transform: scale(0.96);
  }

  .content-button:focus-visible {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25);
  }

  /* The nav bar's badge formula at tile scale. The second color stop is the
     state: 20% resting, 35% on hover, the same ladder the chapter grid walks. */
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    line-height: 0;
    flex-shrink: 0;
    background: radial-gradient(circle, var(--accent) 0%, var(--accent) 20%, #222 100%);
    transition: background 0.15s;
  }

  .content-button:hover .badge {
    background: radial-gradient(circle, var(--accent) 0%, var(--accent) 35%, #222 100%);
  }

  .label {
    font-size: 12px;
    line-height: 1.2;
    text-align: center;
  }

  .instruction {
    color: #888;
    font-size: 11px;
    margin: 0;
    margin-bottom: auto;
    text-align: center;
  }
</style>
