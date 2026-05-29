<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { BCV, HighlightStyle, UserHighlight, UserWordHighlight } from '@projectbible/core';
  import { userProfileStore } from '../stores/userProfileStore';

  export let reference: BCV;
  export let existingHighlight: UserHighlight | UserWordHighlight | null = null;
  export let selectionType: 'verse' | 'word' = 'verse';

  const dispatch = createEventDispatcher<{
    save: HighlightStyle;
    remove: void;
    close: void;
  }>();

  // ── Palette definitions ────────────────────────────────────────────────────

  const MARKER_COLORS = [
    { value: '#fef08a', label: 'Yellow' },
    { value: '#bbf7d0', label: 'Green' },
    { value: '#fbcfe8', label: 'Pink' },
    { value: '#fed7aa', label: 'Orange' },
    { value: '#a5f3fc', label: 'Aqua' },
    { value: '#ddd6fe', label: 'Purple' },
    { value: '#fecaca', label: 'Red' },
    { value: '#bfdbfe', label: 'Blue' },
  ] as const;

  const BOLD_MARKER_COLORS = [
    { value: '#ca8a04', label: 'Dark Gold' },
    { value: '#15803d', label: 'Forest Green' },
    { value: '#c2410c', label: 'Rust Orange' },
    { value: '#0891b2', label: 'Dark Cyan' },
    { value: '#6d28d9', label: 'Deep Violet' },
    { value: '#b91c1c', label: 'Deep Red' },
    { value: '#1d4ed8', label: 'Navy Blue' },
    { value: '#0f766e', label: 'Deep Teal' },
  ] as const;

  const TEXT_COLORS = [
    { value: '#eab308', label: 'Gold' },
    { value: '#f97316', label: 'Coral' },
    { value: '#22c55e', label: 'Mint' },
    { value: '#38bdf8', label: 'Sky' },
    { value: '#a78bfa', label: 'Lavender' },
    { value: '#f43f5e', label: 'Crimson' },
  ] as const;

  const UNDERLINE_STYLES = [
    { style: 'solid'  as const, label: 'Solid' },
    { style: 'dashed' as const, label: 'Dashed' },
    { style: 'wavy'   as const, label: 'Wavy' },
  ];

  const UNDERLINE_COLORS = [
    { value: '#eab308', label: 'Gold' },
    { value: '#f97316', label: 'Coral' },
    { value: '#38bdf8', label: 'Sky' },
    { value: '#f43f5e', label: 'Crimson' },
  ] as const;

  // ── Selection state ────────────────────────────────────────────────────────

  // Determine active type/color/underlineStyle from an existing highlight
  function initFromExisting(hl: UserHighlight | UserWordHighlight | null): HighlightStyle {
    if (hl) return { ...hl.style };
    return { type: 'background', color: MARKER_COLORS[0].value };
  }

  let selected: HighlightStyle = initFromExisting(existingHighlight);

  $: isLoggedIn = $userProfileStore.isSignedIn;
  $: hasExisting = existingHighlight !== null;

  function selectMarker(color: string) {
    selected = { type: 'background', color };
  }

  function selectTextColor(color: string) {
    selected = { type: 'text-color', color };
  }

  function selectUnderline(style: 'solid' | 'dashed' | 'wavy', color: string) {
    selected = { type: 'underline', color, underlineStyle: style };
  }

  $: activeType = selected.type;
  $: activeColor = selected.color;
  $: activeUnderlineStyle = selected.underlineStyle;

  function isActiveMarker(color: string) {
    return activeType === 'background' && activeColor === color;
  }

  function isActiveTextColor(color: string) {
    return activeType === 'text-color' && activeColor === color;
  }

  function isActiveUnderline(style: string, color: string) {
    return activeType === 'underline' && activeUnderlineStyle === style && activeColor === color;
  }

  function handleSave() {
    if (!isLoggedIn) return;
    dispatch('save', selected);
  }

  function handleRemove() {
    dispatch('remove');
  }

  function handleClose() {
    dispatch('close');
  }

  // ── Keyboard / backdrop ────────────────────────────────────────────────────

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('hl-modal-backdrop')) {
      handleClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose();
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="hl-modal-backdrop" on:click={handleBackdropClick}>
  <div class="hl-modal" role="dialog" aria-modal="true" aria-label="Highlight options">

    <div class="hl-modal-header">
      <span class="hl-modal-title">Highlight</span>
      <span class="hl-modal-subtitle">{selectionType === 'word' ? 'Word' : 'Verse'} · {reference.book} {reference.chapter}:{reference.verse}</span>
      <button class="hl-close-btn" on:click={handleClose} aria-label="Close">✕</button>
    </div>

    {#if !isLoggedIn}
      <div class="hl-auth-gate">
        <span class="hl-auth-icon">🔒</span>
        <span>Sign in to save highlights</span>
      </div>
    {/if}

    <!-- Marker highlights -->
    <div class="hl-section">
      <div class="hl-section-label">Marker</div>
      <div class="hl-swatches">
        {#each MARKER_COLORS as { value, label }}
          <button
            class="hl-swatch hl-swatch-marker"
            class:hl-swatch-active={isActiveMarker(value)}
            style="--swatch-color: {value}"
            title={label}
            on:click={() => selectMarker(value)}
            aria-label="{label} marker"
            aria-pressed={isActiveMarker(value)}
          >
            {#if isActiveMarker(value)}<span class="hl-check">✓</span>{/if}
          </button>
        {/each}
      </div>
      <div class="hl-swatches" style="margin-top: 8px">
        {#each BOLD_MARKER_COLORS as { value, label }}
          <button
            class="hl-swatch hl-swatch-marker"
            class:hl-swatch-active={isActiveMarker(value)}
            style="--swatch-color: {value}"
            title={label}
            on:click={() => selectMarker(value)}
            aria-label="{label} marker"
            aria-pressed={isActiveMarker(value)}
          >
            {#if isActiveMarker(value)}<span class="hl-check hl-check-bold">✓</span>{/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Text color -->
    <div class="hl-section">
      <div class="hl-section-label">Text Color</div>
      <div class="hl-swatches">
        {#each TEXT_COLORS as { value, label }}
          <button
            class="hl-swatch hl-swatch-text"
            class:hl-swatch-active={isActiveTextColor(value)}
            style="--swatch-color: {value}"
            title={label}
            on:click={() => selectTextColor(value)}
            aria-label="{label} text color"
            aria-pressed={isActiveTextColor(value)}
          >
            <span class="hl-swatch-text-preview" style="color: {value}">Aa</span>
            {#if isActiveTextColor(value)}<span class="hl-check hl-check-text">✓</span>{/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Underline -->
    <div class="hl-section">
      <div class="hl-section-label">Underline</div>
      <div class="hl-underline-grid">
        {#each UNDERLINE_STYLES as { style, label }}
          <div class="hl-underline-row">
            <span class="hl-underline-label">{label}</span>
            <div class="hl-swatches hl-swatches-underline">
              {#each UNDERLINE_COLORS as { value, label: colorLabel }}
                <button
                  class="hl-swatch hl-swatch-underline"
                  class:hl-swatch-active={isActiveUnderline(style, value)}
                  style="--swatch-color: {value}"
                  title="{label} {colorLabel}"
                  on:click={() => selectUnderline(style, value)}
                  aria-label="{label} {colorLabel} underline"
                  aria-pressed={isActiveUnderline(style, value)}
                >
                  <span class="hl-underline-preview" style="text-decoration: underline {style} {value}; text-underline-offset: 2px;">Aa</span>
                  {#if isActiveUnderline(style, value)}<span class="hl-check">✓</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Actions -->
    <div class="hl-actions">
      {#if hasExisting}
        <button class="hl-btn hl-btn-remove" on:click={handleRemove}>Remove</button>
      {/if}
      <button
        class="hl-btn hl-btn-save"
        class:hl-btn-disabled={!isLoggedIn}
        disabled={!isLoggedIn}
        on:click={handleSave}
      >
        {hasExisting ? 'Update' : 'Apply'}
      </button>
    </div>

  </div>
</div>

<style>
  .hl-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 9000;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .hl-modal {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-width: 480px;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.6);
    user-select: none;
  }

  /* ── Header ── */
  .hl-modal-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 18px;
  }

  .hl-modal-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .hl-modal-subtitle {
    font-size: 0.75rem;
    color: #888;
    flex: 1;
  }

  .hl-close-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    border-radius: 4px;
    transition: color 0.15s;
  }
  .hl-close-btn:hover { color: #ccc; }

  /* ── Auth gate ── */
  .hl-auth-gate {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #2a1f0e;
    border: 1px solid #5a3e10;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 16px;
    color: #f59e0b;
    font-size: 0.8125rem;
  }

  .hl-auth-icon { font-size: 0.875rem; }

  /* ── Sections ── */
  .hl-section {
    margin-bottom: 16px;
  }

  .hl-section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 8px;
  }

  /* ── Swatches ── */
  .hl-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .hl-swatch {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, transform 0.1s;
    padding: 0;
  }

  .hl-swatch:hover { transform: scale(1.12); }

  .hl-swatch-active {
    border-color: #fff !important;
    transform: scale(1.08);
  }

  /* Marker swatches: organic squarish fill */
  .hl-swatch-marker {
    background: var(--swatch-color);
    /* Subtle squircle shape */
    border-radius: 40% 60% 55% 45% / 50% 40% 60% 50%;
  }

  /* Text-color swatches: dark bg with "Aa" preview */
  .hl-swatch-text {
    background: #2a2a2a;
    border-color: #444;
    width: 44px;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .hl-swatch-text-preview { pointer-events: none; }

  /* Underline swatches */
  .hl-swatch-underline {
    background: #2a2a2a;
    border-color: #444;
    width: 44px;
    height: 32px;
    border-radius: 6px;
    font-size: 0.8125rem;
  }

  .hl-underline-preview { pointer-events: none; }

  .hl-check {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 14px;
    height: 14px;
    background: #fff;
    color: #111;
    border-radius: 50%;
    font-size: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    pointer-events: none;
  }

  .hl-check-text {
    background: var(--swatch-color, #fff);
    color: #111;
  }

  /* On dark/bold swatches the checkmark badge uses white text for contrast */
  .hl-check-bold {
    background: rgba(255,255,255,0.9);
    color: #111;
  }

  /* ── Underline grid ── */
  .hl-underline-grid { display: flex; flex-direction: column; gap: 8px; }

  .hl-underline-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hl-underline-label {
    width: 46px;
    font-size: 0.6875rem;
    color: #888;
    flex-shrink: 0;
  }

  .hl-swatches-underline { gap: 6px; }

  /* ── Actions ── */
  .hl-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
    justify-content: flex-end;
  }

  .hl-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s;
  }

  .hl-btn-remove {
    background: #2a1515;
    color: #f87171;
    border: 1px solid #4a2020;
  }
  .hl-btn-remove:hover { background: #3a1818; }

  .hl-btn-save {
    background: #3b82f6;
    color: #fff;
    flex: 1;
    max-width: 160px;
  }
  .hl-btn-save:hover { background: #2563eb; }

  .hl-btn-disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .hl-btn-disabled:hover { background: #3b82f6; }
</style>
