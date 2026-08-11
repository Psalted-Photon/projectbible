<script lang="ts">
  /**
   * Theme picker for a writing surface (Notes or Journal).
   *
   * Slides down over the editor rather than opening as a popover: the pickers
   * are tall, the panes are often narrow, and a floating menu that big would
   * spill off the edge of a phone. Covering the canvas is honest about what is
   * happening and gives every control room to be touched.
   *
   * Chrome is dark like the settings pane, deliberately *not* themed by the
   * colours being chosen — a picker that recolours itself as you drag is very
   * hard to aim. Only the preview line shows the result.
   */
  import { createEventDispatcher, onMount } from "svelte";
  import ColorField from "../../components/ColorField.svelte";
  import FontField from "../../components/FontField.svelte";
  import {
    getCustomThemeSettings,
    updateCustomThemeSettings,
    MAX_COLOR_PRESETS,
    type EditorThemeSettings,
  } from "../../adapters/settings";
  import { contrastRatio, isLowContrast, isValidHex } from "../../lib/themeColors";
  import { editorPreviewStyle } from "../editorTheme";

  /** Live theme. Bound by the editor, which persists every change. */
  export let theme: EditorThemeSettings;
  /** "Notes" / "Journal" — used in the intro line and the picker labels. */
  export let surfaceLabel: string = "this space";

  const dispatch = createEventDispatcher<{ close: void }>();

  /**
   * Saved swatches are shared with the reader's Custom theme rather than kept
   * per surface, so a colour saved anywhere is available everywhere. Read on
   * mount and written straight back through the same helpers the settings pane
   * uses, which keeps one list and one sync path.
   */
  let textPresets: string[] = [];
  let bgPresets: string[] = [];
  let editingText = false;
  let editingBg = false;

  onMount(loadPresets);

  function loadPresets() {
    const c = getCustomThemeSettings();
    textPresets = c.textPresets;
    bgPresets = c.bgPresets;
  }

  $: contrast = contrastRatio(theme.textColor, theme.bgColor);
  $: lowContrast = isLowContrast(theme.textColor, theme.bgColor);
  // Clamped at zero: a list synced from another device could arrive
  // over-length, and Array(-1) throws.
  $: textSlotsFree = Array(Math.max(0, MAX_COLOR_PRESETS - textPresets.length)).fill(0);
  $: bgSlotsFree = Array(Math.max(0, MAX_COLOR_PRESETS - bgPresets.length)).fill(0);

  function savePreset(kind: "text" | "bg") {
    const color = kind === "text" ? theme.textColor : theme.bgColor;
    if (!isValidHex(color)) return;
    const list = kind === "text" ? textPresets : bgPresets;
    if (list.includes(color) || list.length >= MAX_COLOR_PRESETS) return;
    if (kind === "text") {
      textPresets = [...list, color];
      updateCustomThemeSettings({ textPresets });
    } else {
      bgPresets = [...list, color];
      updateCustomThemeSettings({ bgPresets });
    }
  }

  function removePreset(kind: "text" | "bg", index: number) {
    if (kind === "text") {
      textPresets = textPresets.filter((_, i) => i !== index);
      updateCustomThemeSettings({ textPresets });
    } else {
      bgPresets = bgPresets.filter((_, i) => i !== index);
      updateCustomThemeSettings({ bgPresets });
    }
  }

  function usePreset(kind: "text" | "bg", color: string) {
    if (kind === "text") theme = { ...theme, textColor: color };
    else theme = { ...theme, bgColor: color };
  }

  function setMode(mode: "default" | "custom") {
    if (theme.mode === mode) return;
    theme = { ...theme, mode };
  }

  /** Escape closes, same as the Done button. */
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      dispatch("close");
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="etp"
  role="dialog"
  aria-label="{surfaceLabel} appearance"
  tabindex="-1"
  on:keydown={onKeydown}
>
  <div class="etp-head">
    <span class="etp-title">{surfaceLabel} appearance</span>
    <button class="etp-done" type="button" on:click={() => dispatch("close")}>Done</button>
  </div>

  <div class="etp-body">
    <div class="etp-modes">
      <button
        type="button"
        class="etp-mode"
        class:on={theme.mode === "default"}
        on:click={() => setMode("default")}
      >Default</button>
      <button
        type="button"
        class="etp-mode"
        class:on={theme.mode === "custom"}
        on:click={() => setMode("custom")}
      >Custom</button>
    </div>

    {#if theme.mode === "default"}
      <p class="etp-intro">
        {surfaceLabel} looks the way it always has. Choose Custom to pick your own
        typeface and colors — they'll be saved and follow you to your other devices.
      </p>
    {:else}
      <p class="etp-intro">
        Changes the writing area only. The rest of the app stays as it is.
      </p>

      <div class="etp-field">
        <span class="etp-label">Preview</span>
        <div class="etp-preview" style={editorPreviewStyle(theme)}>
          The grass withereth, the flower fadeth: but the word of our God shall
          stand for ever.
        </div>
        {#if lowContrast}
          <p class="etp-warn">
            Low contrast ({contrast.toFixed(1)}:1) — this may be hard to read.
            Using it anyway is fine.
          </p>
        {/if}
      </div>

      <div class="etp-field">
        <span class="etp-label">Typeface</span>
        <FontField bind:value={theme.fontId} defaultLabel="Default" />
      </div>

      <div class="etp-field">
        <div class="etp-head-row">
          <span class="etp-label">Text color</span>
          <button
            class="etp-btn"
            class:on={editingText}
            type="button"
            disabled={textPresets.length === 0}
            on:click={() => (editingText = !editingText)}
          >{editingText ? "Done" : "Edit"}</button>
        </div>
        <ColorField bind:value={theme.textColor} label="{surfaceLabel} text">
          <button
            class="etp-btn"
            type="button"
            disabled={textPresets.includes(theme.textColor) || textPresets.length >= MAX_COLOR_PRESETS}
            on:click={() => savePreset("text")}
          >Add</button>
        </ColorField>
        <div class="etp-presets">
          {#each textPresets as color, i}
            <button
              class="etp-swatch"
              class:removing={editingText}
              type="button"
              style="background: {color}"
              title={color}
              on:click={() => (editingText ? removePreset("text", i) : usePreset("text", color))}
            >{#if editingText}<span class="etp-x">×</span>{/if}</button>
          {/each}
          {#each textSlotsFree as _}
            <span class="etp-swatch empty"></span>
          {/each}
        </div>
      </div>

      <div class="etp-field">
        <div class="etp-head-row">
          <span class="etp-label">Background color</span>
          <button
            class="etp-btn"
            class:on={editingBg}
            type="button"
            disabled={bgPresets.length === 0}
            on:click={() => (editingBg = !editingBg)}
          >{editingBg ? "Done" : "Edit"}</button>
        </div>
        <ColorField bind:value={theme.bgColor} label="{surfaceLabel} background">
          <button
            class="etp-btn"
            type="button"
            disabled={bgPresets.includes(theme.bgColor) || bgPresets.length >= MAX_COLOR_PRESETS}
            on:click={() => savePreset("bg")}
          >Add</button>
        </ColorField>
        <div class="etp-presets">
          {#each bgPresets as color, i}
            <button
              class="etp-swatch"
              class:removing={editingBg}
              type="button"
              style="background: {color}"
              title={color}
              on:click={() => (editingBg ? removePreset("bg", i) : usePreset("bg", color))}
            >{#if editingBg}<span class="etp-x">×</span>{/if}</button>
          {/each}
          {#each bgSlotsFree as _}
            <span class="etp-swatch empty"></span>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Covers the writing area, not the whole window — the host's header and the
     bumper stay reachable so you always know where you are. */
  .etp {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: #202020;
    color: #e0e0e0;
    font-family: inherit;
    text-align: left;
  }

  .etp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex: none;
    padding: 8px 12px;
    border-bottom: 1px solid #3a3a3a;
    background: #262626;
  }

  .etp-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ddd;
    text-transform: capitalize;
  }

  .etp-done {
    flex: none;
    padding: 6px 14px;
    background: #2f2f2f;
    border: 1px solid #667eea;
    border-radius: 6px;
    color: #9aa9f5;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  .etp-done:hover { background: #353535; }

  .etp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }

  .etp-modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .etp-mode {
    padding: 10px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #bbb;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .etp-mode:hover { border-color: #667eea; }
  .etp-mode.on {
    border-color: #667eea;
    background: #23273d;
    color: #fff;
  }

  .etp-intro {
    font-size: 0.8rem;
    color: #999;
    line-height: 1.5;
    margin: 0;
  }

  .etp-field {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .etp-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .etp-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: #bbb;
  }

  .etp-btn {
    flex: none;
    padding: 6px 12px;
    background: #2f2f2f;
    border: 1px solid #4a4a4a;
    border-radius: 6px;
    color: #ddd;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, opacity 0.15s;
  }
  .etp-btn:hover:not(:disabled) { border-color: #667eea; background: #353535; }
  .etp-btn:disabled { opacity: 0.35; cursor: default; }
  .etp-btn.on { border-color: #667eea; color: #9aa9f5; }

  .etp-presets {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 6px;
  }

  .etp-swatch {
    aspect-ratio: 1;
    min-height: 22px;
    border: 1px solid #4a4a4a;
    border-radius: 5px;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.12s, border-color 0.12s;
  }
  .etp-swatch:hover { transform: scale(1.12); border-color: #667eea; }
  .etp-swatch.removing { border-color: #e05252; }
  .etp-swatch.empty {
    background: #262626;
    border-style: dashed;
    border-color: #3a3a3a;
    cursor: default;
  }
  .etp-swatch.empty:hover { transform: none; border-color: #3a3a3a; }

  .etp-x {
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    color: #fff;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
  }

  .etp-preview {
    padding: 14px 16px;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    font-size: 1rem;
    line-height: 1.6;
    transition: background 0.15s, color 0.15s;
  }

  .etp-warn {
    font-size: 0.78rem;
    color: #e0a94a;
    line-height: 1.45;
    margin: 0;
  }
</style>
