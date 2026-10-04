<script lang="ts">
  import { windowStore } from "../lib/stores/windowStore";
  import {
    WINDOW_TYPES,
    initialContentFor,
    openHarmonyView,
    type WindowChoice,
    type HarmonyChoice,
  } from "../lib/windowTypes";
  import PanelIcon from "./icons/PanelIcon.svelte";
  import HarmonyPicker from "./HarmonyPicker.svelte";

  export let windowId: string;

  /** The set picker, open over this window until a set is chosen or dismissed. */
  let showHarmonyPicker = false;

  /**
   * Every other tile fills the window the user just slid open and leaves it
   * docked. Harmonies opens a full-screen view instead, so this window goes
   * on the way (see openHarmonyView).
   */
  function openHarmony(e: CustomEvent<HarmonyChoice>) {
    showHarmonyPicker = false;
    openHarmonyView(e.detail, windowId);
  }

  function handleContentSelect(contentType: WindowChoice) {
    // Harmonies has no window content to set. It asks which harmony first,
    // and openHarmony closes this window rather than filling it.
    if (contentType === 'harmony') {
      showHarmonyPicker = true;
      return;
    }
    windowStore.setWindowContent(windowId, contentType, initialContentFor(contentType));
  }
</script>

<div class="content-selector">
  <div class="button-grid">
    {#each WINDOW_TYPES as tile (tile.type)}
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

{#if showHarmonyPicker}
  <HarmonyPicker
    on:choose={openHarmony}
    on:close={() => (showHarmonyPicker = false)}
  />
{/if}

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
