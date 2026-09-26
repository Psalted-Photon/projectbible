<script lang="ts">
  /**
   * The Card side of the Share sheet: a live preview of the image card and
   * the ways to send it.
   *
   * The preview canvas *is* the card. It is drawn at full size and scaled
   * down by CSS, and the PNG that leaves the app is read straight off it, so
   * nothing can differ between what was seen and what was sent.
   *
   * The PNG is made as soon as the preview finishes, not when Share is
   * tapped. The share sheet only opens straight from a tap, and drawing a
   * card (fonts, icon, text fitting) takes long enough that a phone would
   * refuse it.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { CARD_SIZES, defaultCardStyle, renderCard, type CardSize, type CardStyle } from '../lib/shareCard';
  import { download } from '../lib/backup/saveFile';
  import { isIOS, isPhoneOrTablet } from '../lib/device';
  import { showNotice } from '../stores/noticeStore';

  export let passage = '';
  export let reference = '';
  export let translationLabel = '';

  const dispatch = createEventDispatcher<{ close: void }>();

  let style: CardStyle = defaultCardStyle();
  let canvas: HTMLCanvasElement | null = null;
  let file: File | null = null;
  let drawing = false;

  const SIZE_ORDER: CardSize[] = ['square', 'portrait', 'story'];

  /** "John 3:16" → "John-3-16.png" */
  $: fileName = `${reference.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'verse'}.png`;

  // ── Drawing ────────────────────────────────────────────────────────────────

  /** Only the newest draw may publish its file; an older one finishing late is dropped. */
  let drawToken = 0;

  async function draw(target: HTMLCanvasElement, s: CardStyle, name: string) {
    const token = ++drawToken;
    drawing = true;
    file = null;
    try {
      await renderCard(target, { passage, reference, translationLabel }, s);
      const blob = await new Promise<Blob | null>((r) => target.toBlob(r, 'image/png'));
      if (token !== drawToken) return;
      file = blob ? new File([blob], name, { type: 'image/png' }) : null;
    } catch (err) {
      console.error('[ShareCard] draw failed', err);
    } finally {
      if (token === drawToken) drawing = false;
    }
  }

  $: if (canvas) void draw(canvas, style, fileName);

  // ── What this device can do ───────────────────────────────────────────────

  /** Can the OS share sheet take an image file? Probed once with a real PNG type. */
  const canShareFiles = (() => {
    try {
      const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
      return typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  })();

  // iOS's share sheet has Save Image in it, and a blob download there opens a
  // bare preview page, so on iOS Share is the one way out.
  const showSave = !(isIOS() && canShareFiles);
  const showCopy =
    !isPhoneOrTablet() &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function';

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleShare() {
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
      dispatch('close');
    } catch (err) {
      // Dismissing the sheet leaves this one open so the choice can be made again.
      if ((err as Error)?.name === 'AbortError') return;
      console.warn('[ShareCard] share failed, saving instead', err);
      download(file);
    }
  }

  let saved = false;
  let copyState: 'idle' | 'done' | 'failed' = 'idle';
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function resetFeedbackSoon() {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      saved = false;
      copyState = 'idle';
    }, 1500);
  }

  function handleSave() {
    if (!file) return;
    download(file);
    saved = true;
    resetFeedbackSoon();
  }

  async function handleCopy() {
    if (!file) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
      copyState = 'done';
    } catch (err) {
      console.warn('[ShareCard] copy failed', err);
      copyState = 'failed';
      showNotice('This browser would not copy the image. Save it instead.', 'error');
    }
    resetFeedbackSoon();
  }

  onDestroy(() => {
    drawToken++;
    if (feedbackTimer) clearTimeout(feedbackTimer);
  });
</script>

<div class="sc-preview" class:sc-drawing={drawing}>
  <canvas bind:this={canvas} class="sc-canvas" aria-label="Card preview"></canvas>
</div>

<div class="sc-sizes" role="group" aria-label="Card size">
  {#each SIZE_ORDER as size}
    <button
      class="sc-size"
      class:active={style.size === size}
      aria-pressed={style.size === size}
      on:click={() => (style = { ...style, size })}
    >
      <span class="sc-size-shape sc-shape-{size}" aria-hidden="true"></span>
      {CARD_SIZES[size].label}
    </button>
  {/each}
</div>

{#if isIOS() && canShareFiles}
  <p class="sc-hint">To keep it, tap Share, then Save Image.</p>
{/if}

<div class="sc-actions">
  {#if showCopy}
    <button class="sc-btn sc-btn-plain" class:sc-btn-done={copyState === 'done'} disabled={!file} on:click={handleCopy}>
      {copyState === 'done' ? 'Copied ✓' : copyState === 'failed' ? 'Could not copy' : 'Copy image'}
    </button>
  {/if}
  {#if showSave}
    <button class="sc-btn sc-btn-plain" class:sc-btn-done={saved} disabled={!file} on:click={handleSave}>
      {saved ? 'Saved ✓' : 'Save image'}
    </button>
  {/if}
  {#if canShareFiles}
    <button class="sc-btn sc-btn-share" disabled={!file} on:click={handleShare}>Share…</button>
  {/if}
</div>

<style>
  /* ── Preview ──
     The canvas is 1080px wide; CSS scales it down to fit, never up. The
     height cap keeps a Story card from pushing the buttons off the screen. */
  .sc-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 10px;
    height: min(44vh, 380px);
    transition: opacity 0.15s;
  }
  .sc-drawing { opacity: 0.7; }

  .sc-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
  }

  /* ── Sizes ── */
  .sc-sizes {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .sc-size {
    display: inline-flex;
    align-items: center;
    gap: 7px;
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
  .sc-size:hover { color: #ccc; }
  .sc-size.active {
    background: #1e3a5f;
    border-color: #2f6ba8;
    color: #9fd0ff;
  }

  /* A little outline of each shape, so the choice is visible, not just named. */
  .sc-size-shape {
    display: inline-block;
    border: 1.5px solid currentColor;
    border-radius: 2px;
    width: 10px;
  }
  .sc-shape-square { height: 10px; }
  .sc-shape-portrait { height: 12.5px; }
  .sc-shape-story { height: 17.8px; }

  .sc-hint {
    margin: 10px 2px 0;
    font-size: 0.75rem;
    color: #888;
  }

  /* ── Actions ── matches the Text side's buttons */
  .sc-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
    justify-content: flex-end;
  }

  .sc-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }
  .sc-btn:disabled { opacity: 0.5; cursor: default; }

  .sc-btn-plain {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
    min-width: 116px;
  }
  .sc-btn-plain:hover:not(:disabled) { background: #333; }
  .sc-btn-done {
    background: #14532d;
    border-color: #1d6b3c;
    color: #86efac;
  }

  .sc-btn-share {
    background: #3b82f6;
    color: #fff;
    flex: 1;
    max-width: 160px;
  }
  .sc-btn-share:hover:not(:disabled) { background: #2563eb; }
</style>
