<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { buildShareText, formatShareRef, type ShareRef } from '../lib/shareText';
  import { canShare, copyText, shareText as shareViaSheet } from '../lib/clipboard';
  import { translationLabel } from '../lib/bibleData';
  import ShareCardPanel from './ShareCardPanel.svelte';

  export let reference: ShareRef;
  /** The verse, or the phrase that was selected out of it. */
  export let passage = '';
  export let translation = '';

  const dispatch = createEventDispatcher<{ close: void }>();

  // ── Text | Card ────────────────────────────────────────────────────────────
  // Remembered on this device only, so someone who always sends cards lands
  // on Card. Storage can be missing (private mode), which just means Text.

  type Tab = 'text' | 'card';
  const TAB_KEY = 'share-sheet-tab';
  let tab: Tab = 'text';
  try {
    if (localStorage.getItem(TAB_KEY) === 'card') tab = 'card';
  } catch { /* no storage */ }

  function pickTab(t: Tab) {
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch { /* no storage */ }
  }

  let includeLink = true;
  let includeTranslation = true;

  $: shareText = buildShareText({
    ref: reference,
    passage,
    translation,
    includeTranslation,
    includeLink,
  });

  // ── Copy ───────────────────────────────────────────────────────────────────

  let copyState: 'idle' | 'done' | 'failed' = 'idle';
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleCopy() {
    const ok = await copyText(shareText);
    // There is no snackbar anywhere in the app, so the button says it itself.
    copyState = ok ? 'done' : 'failed';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1500);
  }

  // ── Share ──────────────────────────────────────────────────────────────────

  async function handleShare() {
    // Text only, no separate `url` field: the link is already the last line,
    // and targets that accept both tend to paste the URL a second time.
    // Dismissing the sheet leaves this one open so the choice can be made again.
    if (await shareViaSheet(shareText)) dispatch('close');
  }

  // ── Keyboard / backdrop ────────────────────────────────────────────────────

  function handleClose() {
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('sh-modal-backdrop')) handleClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose();
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="sh-modal-backdrop" on:click={handleBackdropClick}>
  <div class="sh-modal" role="dialog" aria-modal="true" aria-label="Share options">

    <div class="sh-modal-header">
      <span class="sh-modal-title">Share</span>
      <span class="sh-modal-subtitle">{formatShareRef(reference)}</span>
      <button class="sh-close-btn" on:click={handleClose} aria-label="Close">✕</button>
    </div>

    <div class="sh-tabs" role="tablist" aria-label="Share as">
      <button class="sh-tab" class:active={tab === 'text'} role="tab" aria-selected={tab === 'text'} on:click={() => pickTab('text')}>Text</button>
      <button class="sh-tab" class:active={tab === 'card'} role="tab" aria-selected={tab === 'card'} on:click={() => pickTab('card')}>Card</button>
    </div>

    {#if tab === 'card'}
      <ShareCardPanel
        {passage}
        reference={formatShareRef(reference)}
        translationLabel={translationLabel(translation)}
        on:close={handleClose}
      />
    {:else}
    <div class="sh-preview">{shareText}</div>

    <div class="sh-toggles">
      <button
        class="sh-toggle"
        class:active={includeTranslation}
        on:click={() => (includeTranslation = !includeTranslation)}
        aria-pressed={includeTranslation}
      >Translation</button>
      <button
        class="sh-toggle"
        class:active={includeLink}
        on:click={() => (includeLink = !includeLink)}
        aria-pressed={includeLink}
      >Link</button>
    </div>

    <div class="sh-actions">
      <button
        class="sh-btn sh-btn-copy"
        class:sh-btn-done={copyState === 'done'}
        on:click={handleCopy}
      >
        {copyState === 'done' ? 'Copied ✓' : copyState === 'failed' ? 'Could not copy' : 'Copy'}
      </button>
      {#if canShare}
        <button class="sh-btn sh-btn-share" on:click={handleShare}>Share…</button>
      {/if}
    </div>
    {/if}

  </div>
</div>

<style>
  .sh-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 9000;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .sh-modal {
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
  .sh-modal-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 14px;
  }

  .sh-modal-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .sh-modal-subtitle {
    font-size: 0.75rem;
    color: #888;
    flex: 1;
  }

  .sh-close-btn {
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
  .sh-close-btn:hover { color: #ccc; }

  /* ── Text | Card ── */
  .sh-tabs {
    display: flex;
    gap: 4px;
    padding: 3px;
    margin-bottom: 14px;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
  }

  .sh-tab {
    flex: 1;
    padding: 7px 0;
    background: none;
    border: none;
    border-radius: 7px;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .sh-tab:hover { color: #ccc; }
  .sh-tab.active {
    background: #2a2a2a;
    color: #f0f0f0;
  }

  /* ── Preview ──
     Exactly what leaves the app, wrapped as written. Selectable, unlike the
     rest of the sheet, so a line can still be lifted out by hand. */
  .sh-preview {
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #d8d8d8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 40vh;
    overflow-y: auto;
    user-select: text;
  }

  /* ── Toggles ── */
  .sh-toggles {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .sh-toggle {
    padding: 6px 14px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #888;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .sh-toggle:hover { color: #ccc; }
  .sh-toggle.active {
    background: #1e3a5f;
    border-color: #2f6ba8;
    color: #9fd0ff;
  }

  /* ── Actions ── */
  .sh-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
    justify-content: flex-end;
  }

  .sh-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .sh-btn-copy {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
    min-width: 116px;
  }
  .sh-btn-copy:hover { background: #333; }
  .sh-btn-done {
    background: #14532d;
    border-color: #1d6b3c;
    color: #86efac;
  }

  .sh-btn-share {
    background: #3b82f6;
    color: #fff;
    flex: 1;
    max-width: 160px;
  }
  .sh-btn-share:hover { background: #2563eb; }
</style>
