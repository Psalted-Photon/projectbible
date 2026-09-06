<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { buildShareText, formatShareRef, type ShareRef } from '../lib/shareText';

  export let reference: ShareRef;
  /** The verse, or the phrase that was selected out of it. */
  export let passage = '';
  export let translation = '';

  const dispatch = createEventDispatcher<{ close: void }>();

  let includeLink = true;
  let includeTranslation = true;

  $: shareText = buildShareText({
    ref: reference,
    passage,
    translation,
    includeTranslation,
    includeLink,
  });

  /**
   * Firefox on the desktop has no share sheet, so the button would open nothing
   * at all — better to drop it and leave Copy as the single obvious way out.
   * Checked once: nothing about it changes while the sheet is open.
   */
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // ── Copy ───────────────────────────────────────────────────────────────────

  let copyState: 'idle' | 'done' | 'failed' = 'idle';
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pre-clipboard-API fallback, so the button is never simply dead. */
  function legacyCopy(text: string): boolean {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(el);
    return ok;
  }

  async function handleCopy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(shareText);
      ok = true;
    } catch {
      ok = legacyCopy(shareText);
    }
    // There is no snackbar anywhere in the app, so the button says it itself.
    copyState = ok ? 'done' : 'failed';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1500);
  }

  // ── Share ──────────────────────────────────────────────────────────────────

  async function handleShare() {
    try {
      // Text only, no separate `url` field: the link is already the last line,
      // and targets that accept both tend to paste the URL a second time.
      await navigator.share({ text: shareText });
      dispatch('close');
    } catch (err) {
      // Dismissing the sheet rejects with AbortError. That is not a failure,
      // and the sheet stays open so the choice can be made again.
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    }
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
