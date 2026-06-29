<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    getInterlinearSettings,
    updateInterlinearSettings,
    INTERLINEAR_PRESETS,
    type InterlinearPreset,
    type InterlinearSettings,
  } from '../adapters/settings';

  // When true, show the master "Enable interlinear" toggle (Settings context).
  // In the reader popover the header button already toggles enable, so it's hidden there.
  export let showEnableToggle = true;

  const dispatch = createEventDispatcher();

  let s: InterlinearSettings = getInterlinearSettings();

  // Sample phrase for the live preview — John 1:1a.
  const SAMPLE = [
    { orig: 'Ἐν',    gloss: 'in',        translit: 'en',     lemma: 'ἐν',    parse: 'Prep',   strongs: 'G1722' },
    { orig: 'ἀρχῇ',  gloss: 'beginning', translit: 'archē',  lemma: 'ἀρχή',  parse: 'N-DSF',  strongs: 'G746'  },
    { orig: 'ἦν',    gloss: 'was',       translit: 'ēn',     lemma: 'εἰμί',  parse: 'V-IAI3S',strongs: 'G1510' },
    { orig: 'ὁ',     gloss: 'the',       translit: 'ho',     lemma: 'ὁ',     parse: 'Art',    strongs: 'G3588' },
    { orig: 'λόγος', gloss: 'word',      translit: 'logos',  lemma: 'λόγος', parse: 'N-NSM',  strongs: 'G3056' },
  ];

  const PRESETS: { id: Exclude<InterlinearPreset, 'custom'>; label: string }[] = [
    { id: 'minimal', label: 'Minimal' },
    { id: 'study',   label: 'Study'   },
    { id: 'scholar', label: 'Scholar' },
  ];

  type LayerKey = 'showGloss' | 'showTranslit' | 'showLemma' | 'showStrongs' | 'showParsing';
  const LAYERS: { key: LayerKey; label: string }[] = [
    { key: 'showGloss',    label: 'English gloss' },
    { key: 'showTranslit', label: 'Transliteration' },
    { key: 'showLemma',    label: 'Lemma (dictionary form)' },
    { key: 'showStrongs',  label: "Strong's number" },
    { key: 'showParsing',  label: 'Parsing' },
  ];

  function persist() {
    // When the master enable toggle isn't shown here (reader popover), the
    // header button owns `enabled` — don't write a stale value back over it.
    if (showEnableToggle) {
      updateInterlinearSettings(s);
    } else {
      const { enabled: _enabled, ...layers } = s;
      updateInterlinearSettings(layers);
    }
    // Reader (and any other listeners) re-read settings + re-render on this event.
    window.dispatchEvent(new CustomEvent('settingsUpdated'));
    dispatch('change', s);
  }

  function detectPreset(): InterlinearPreset {
    for (const name of ['minimal', 'study', 'scholar'] as const) {
      const p = INTERLINEAR_PRESETS[name];
      if (
        s.showGloss === p.showGloss &&
        s.showTranslit === p.showTranslit &&
        s.showLemma === p.showLemma &&
        s.showStrongs === p.showStrongs &&
        s.showParsing === p.showParsing
      ) return name;
    }
    return 'custom';
  }

  function applyPreset(id: Exclude<InterlinearPreset, 'custom'>) {
    s = { ...s, ...INTERLINEAR_PRESETS[id], preset: id };
    persist();
  }

  function onLayerToggle() {
    s = { ...s, preset: detectPreset() };
    persist();
  }

  function onEnableToggle() {
    persist();
  }
</script>

<div class="il-controls">
  {#if showEnableToggle}
    <label class="il-enable">
      <input type="checkbox" bind:checked={s.enabled} on:change={onEnableToggle} />
      <span>Enable interlinear for Greek &amp; Hebrew</span>
    </label>
  {/if}

  <div class="il-presets" role="group" aria-label="Interlinear presets">
    {#each PRESETS as p}
      <button
        type="button"
        class="il-chip"
        class:active={s.preset === p.id}
        on:click={() => applyPreset(p.id)}
      >{p.label}</button>
    {/each}
    {#if s.preset === 'custom'}
      <span class="il-chip il-chip-custom">Custom</span>
    {/if}
  </div>

  <div class="il-layers">
    {#each LAYERS as layer}
      <label class="il-layer">
        <input
          type="checkbox"
          bind:checked={s[layer.key]}
          on:change={onLayerToggle}
          disabled={layer.key === 'showGloss'}
        />
        <span>{layer.label}</span>
      </label>
    {/each}
  </div>

  <div class="il-preview-label">Preview</div>
  <div class="il-preview">
    {#each SAMPLE as w}
      <span class="il-word">
        <span class="il-orig">{w.orig}</span>
        {#if s.showGloss}<span class="il-gloss">{w.gloss}</span>{/if}
        {#if s.showTranslit}<span class="il-translit">{w.translit}</span>{/if}
        {#if s.showLemma}<span class="il-lemma">{w.lemma}</span>{/if}
        {#if s.showParsing}<span class="il-parse">{w.parse}</span>{/if}
        {#if s.showStrongs}<span class="il-strongs">{w.strongs}</span>{/if}
      </span>
    {/each}
  </div>
</div>

<style>
  .il-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: #e0e0e0;
  }

  .il-enable {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .il-enable input[type='checkbox'] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: #667eea;
  }

  .il-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .il-chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid #444;
    background: #1a1a1a;
    color: #ccc;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .il-chip:hover {
    border-color: #667eea;
  }
  .il-chip.active {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }
  .il-chip-custom {
    cursor: default;
    border-style: dashed;
    color: #888;
  }

  .il-layers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .il-layer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    font-size: 0.9rem;
    color: #ccc;
  }
  .il-layer input[type='checkbox'] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: #667eea;
  }
  .il-layer input[type='checkbox']:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  .il-preview-label {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #888;
    margin-top: 2px;
  }

  /* Live preview — uses its own fixed line-height + em sizes so it never
     depends on the app's --base-font-size / --line-spacing settings. */
  .il-preview {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 0.25em 0.8em;
    padding: 14px 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid #333;
    border-radius: 8px;
    line-height: 1.15;
    font-size: 21px;
  }
  .il-word {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .il-orig     { font-size: 1em; color: #f0f0f0; }
  .il-gloss    { font-size: 0.6em;  color: #cfe3ff; }
  .il-translit { font-size: 0.52em; color: #b0b0b0; font-style: italic; }
  .il-lemma    { font-size: 0.55em; color: #e3cd96; }
  .il-parse    { font-size: 0.48em; color: #9aa0a6; }
  .il-strongs  { font-size: 0.48em; color: #93c69a; }
</style>
