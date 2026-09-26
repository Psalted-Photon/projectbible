<script lang="ts">
  /**
   * Looks: a card's style saved by name and reused with one tap.
   *
   * The first chip is always the reader's own theme, so there is a way back to
   * where every card started. Saved looks sync like the rest of settings. A
   * photo or painting is never part of a look; see applyLook.
   */
  import { createEventDispatcher } from 'svelte';
  import { getCardLooks, setCardLooks, MAX_CARD_LOOKS, type SavedCardLook } from '../adapters/settings';
  import { defaultCardStyle, getGradient, sanitizeStyle, type CardStyle } from '../lib/shareCard';
  import { getReaderFont } from '../lib/readerFonts';

  export let style: CardStyle;

  const dispatch = createEventDispatcher<{ apply: CardStyle }>();

  let looks: SavedCardLook[] = getCardLooks();
  let naming = false;
  let name = '';
  let editing = false;
  let nameInput: HTMLInputElement | null = null;

  /** A chip shows the look itself: its background with an "Aa" in its font and colour. */
  function chipStyle(raw: CardStyle | Record<string, unknown>): string {
    const s = sanitizeStyle(raw);
    const bg =
      s.background === 'gradient'
        ? `linear-gradient(135deg, ${getGradient(s.gradientId).from}, ${getGradient(s.gradientId).to})`
        : s.bgColor;
    const font = getReaderFont(s.fontId)?.stack ?? "'EB Garamond', Georgia, serif";
    return `background: ${bg}; color: ${s.textColor}; font-family: ${font};`;
  }

  function startNaming() {
    naming = true;
    name = `Look ${looks.length + 1}`;
    setTimeout(() => nameInput?.select(), 0);
  }

  function save() {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    const look: SavedCardLook = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      style: { ...style },
    };
    looks = [...looks, look].slice(0, MAX_CARD_LOOKS);
    setCardLooks(looks);
    naming = false;
  }

  function remove(id: string) {
    looks = looks.filter((l) => l.id !== id);
    setCardLooks(looks);
    if (looks.length === 0) editing = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') {
      e.stopPropagation();
      naming = false;
    }
  }
</script>

<div class="scl-row">
  <button class="scl-chip" on:click={() => dispatch('apply', { ...defaultCardStyle(), size: style.size })}>
    <span class="scl-swatch" style={chipStyle(defaultCardStyle())}>Aa</span>
    My reader theme
  </button>
  {#each looks as look (look.id)}
    <button
      class="scl-chip"
      class:removing={editing}
      on:click={() => (editing ? remove(look.id) : dispatch('apply', sanitizeStyle(look.style)))}
    >
      <span class="scl-swatch" style={chipStyle(look.style)}>Aa</span>
      {look.name}
      {#if editing}<span class="scl-x" aria-label="Remove">×</span>{/if}
    </button>
  {/each}
</div>

{#if naming}
  <div class="scl-name">
    <input
      bind:this={nameInput}
      bind:value={name}
      maxlength="30"
      placeholder="Name this look"
      aria-label="Name this look"
      on:keydown={onKey}
    />
    <button class="scl-btn" on:click={() => (naming = false)}>Cancel</button>
    <button class="scl-btn scl-btn-main" disabled={!name.trim()} on:click={save}>Save</button>
  </div>
{:else}
  <div class="scl-actions">
    <button class="scl-btn" disabled={looks.length >= MAX_CARD_LOOKS} on:click={startNaming}>
      + Save this look
    </button>
    {#if looks.length}
      <button class="scl-btn" class:on={editing} on:click={() => (editing = !editing)}>
        {editing ? 'Done' : 'Remove…'}
      </button>
    {/if}
  </div>
  <p class="scl-note">
    {editing
      ? 'Tap a look to remove it.'
      : 'A look keeps the font, colours, background and layout. Photos stay with the card they were picked for.'}
  </p>
{/if}

<style>
  .scl-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .scl-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 4px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #ddd;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .scl-chip:hover { border-color: #555; }
  .scl-chip.removing { border-color: #7f1d1d; }

  .scl-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    font-size: 0.8rem;
    font-weight: 400;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .scl-x {
    color: #f87171;
    font-size: 1rem;
    line-height: 1;
  }

  .scl-actions,
  .scl-name {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .scl-name input {
    flex: 1;
    min-width: 0;
    padding: 7px 12px;
    background: #161616;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #eee;
    font-size: 0.875rem;
  }

  .scl-btn {
    padding: 6px 14px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #ccc;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .scl-btn:disabled { opacity: 0.5; cursor: default; }
  .scl-btn.on { border-color: #7f1d1d; color: #fca5a5; }
  .scl-btn-main { background: #3b82f6; border-color: #3b82f6; color: #fff; }

  .scl-note {
    margin: 10px 2px 0;
    font-size: 0.75rem;
    color: #888;
    line-height: 1.4;
  }
</style>
