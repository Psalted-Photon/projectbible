<script lang="ts">
  /**
   * The Card side of the Share sheet: a live preview of the image card, the
   * controls that style it, and the ways to send it.
   *
   * The preview canvas *is* the card. It is drawn at full size and scaled
   * down by CSS, and the image that leaves the app is read straight off it, so
   * nothing can differ between what was seen and what was sent.
   *
   * The file is made shortly after the preview settles, not when Share is
   * tapped. The share sheet only opens straight from a tap, and making a
   * 1080px image takes long enough that a phone would refuse it.
   *
   * The preview also takes touches: a tap on a word cycles it plain → bold →
   * accent, and with a photo or painting behind the words a drag moves the
   * picture and a pinch zooms it. A touch that moves is a drag, one that
   * doesn't is a tap, so the two never fight.
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import ColorField from './ColorField.svelte';
  import FontField from './FontField.svelte';
  import ShareCardLooks from './ShareCardLooks.svelte';
  import ShareCardPaintings from './ShareCardPaintings.svelte';
  import {
    CARD_GRADIENTS,
    CARD_SIZES,
    applyLook,
    canvasToBlob,
    cardMime,
    cardWords,
    clampPan,
    decodeImage,
    getGradient,
    gradientCss,
    renderCard,
    rememberLastStyle,
    restoreLastStyle,
    suggestColours,
    type CardImage,
    type CardSize,
    type CardStyle,
    type CardTexture,
    type Emphasis,
    type WordBox,
  } from '../lib/shareCard';
  import type { ShareRef } from '../lib/shareText';
  import { IndexedDBArtStore } from '../adapters/ArtStore';
  import { getCustomThemeSettings, updateCustomThemeSettings, MAX_COLOR_PRESETS } from '../adapters/settings';
  import { contrastRatio, isValidHex } from '../lib/themeColors';
  import { download } from '../lib/backup/saveFile';
  import { isIOS, isPhoneOrTablet } from '../lib/device';
  import { showNotice } from '../stores/noticeStore';

  export let passage = '';
  export let reference = '';
  export let translationLabel = '';
  /** The raw reference, for finding paintings of the passage. */
  export let shareRef: ShareRef;
  /** The link a QR code on the card opens. */
  export let qrUrl = '';

  const dispatch = createEventDispatcher<{ close: void }>();

  let style: CardStyle = restoreLastStyle();
  let photo: CardImage | null = null;
  let painting: CardImage | null = null;
  let paintingId: string | null = null;
  let emphasis: Record<number, Emphasis> = {};

  $: image = style.background === 'photo' ? photo : style.background === 'painting' ? painting : null;
  $: hasEmphasis = Object.keys(emphasis).length > 0;
  $: wordCount = cardWords(passage).length;

  type Section = 'looks' | 'font' | 'colour' | 'background' | 'layout';
  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'looks', label: 'Looks' },
    { id: 'font', label: 'Font' },
    { id: 'colour', label: 'Colour' },
    { id: 'background', label: 'Background' },
    { id: 'layout', label: 'Layout' },
  ];
  let section: Section = 'looks';

  // ── Drawing ────────────────────────────────────────────────────────────────

  let canvas: HTMLCanvasElement | null = null;
  let boxes: WordBox[] = [];
  let file: File | null = null;
  let drawing = false;

  /** Only the newest draw may publish; an older one finishing late is dropped. */
  let drawToken = 0;
  let frame = 0;
  let exportTimer: ReturnType<typeof setTimeout> | null = null;

  /** Coalesce changes into one draw per frame — a drag fires far faster than that. */
  function scheduleDraw() {
    if (!canvas || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void draw();
    });
  }

  async function draw() {
    if (!canvas) return;
    const token = ++drawToken;
    const s = style;
    drawing = true;
    file = null;
    try {
      boxes = await renderCard(canvas, { passage, reference, translationLabel }, s, {
        image,
        emphasis,
        qrUrl,
      });
    } catch (err) {
      console.error('[ShareCard] draw failed', err);
    }
    if (token !== drawToken) return;
    if (exportTimer) clearTimeout(exportTimer);
    exportTimer = setTimeout(() => void exportFile(token, s), 250);
  }

  async function exportFile(token: number, s: CardStyle) {
    if (!canvas || token !== drawToken) return;
    const blob = await canvasToBlob(canvas, s);
    if (token !== drawToken) return;
    const ext = cardMime(s) === 'image/png' ? 'png' : 'jpg';
    const base = reference.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'verse';
    file = blob ? new File([blob], `${base}.${ext}`, { type: blob.type }) : null;
    drawing = false;
    rememberLastStyle(s);
  }

  $: if (canvas) {
    void style, image, emphasis;
    scheduleDraw();
  }

  // ── Touches on the preview ─────────────────────────────────────────────────

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    moved: boolean;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
    startDist: number;
    startZoom: number;
  } | null = null;

  /** Card pixels per screen pixel. */
  function cardScale(): number {
    if (!canvas) return 1;
    return canvas.width / canvas.getBoundingClientRect().width;
  }

  function setImage(next: CardImage) {
    const { w, h } = CARD_SIZES[style.size];
    const clamped = clampPan(next, w, h);
    if (style.background === 'photo') photo = clamped;
    else painting = clamped;
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    canvas?.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = {
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: image?.panX ?? 0, y: image?.panY ?? 0 },
        startDist: 0,
        startZoom: image?.zoom ?? 1,
      };
    } else if (pointers.size === 2 && gesture && image) {
      gesture.moved = true;
      gesture.startDist = pinchDistance();
      gesture.startZoom = image.zoom;
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!image) return;
    if (pointers.size >= 2 && gesture.startDist > 0) {
      const zoom = Math.max(1, Math.min(4, (gesture.startZoom * pinchDistance()) / gesture.startDist));
      setImage({ ...image, zoom });
      return;
    }
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true;
    const k = cardScale();
    setImage({ ...image, panX: gesture.startPan.x + dx * k, panY: gesture.startPan.y + dy * k });
  }

  function onPointerUp(e: PointerEvent) {
    const wasTap = pointers.size === 1 && gesture && !gesture.moved;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (wasTap) tapAt(e.clientX, e.clientY);
      gesture = null;
    } else if (gesture && image) {
      // One finger lifted mid-pinch: carry on as a drag from here.
      const [p] = [...pointers.values()];
      gesture = { ...gesture, startX: p.x, startY: p.y, startPan: { x: image.panX, y: image.panY }, startDist: 0 };
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
  }

  function tapAt(clientX: number, clientY: number) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const k = cardScale();
    const x = (clientX - rect.left) * k;
    const y = (clientY - rect.top) * k;
    const hit = boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hit) return;
    const next = { ...emphasis };
    const now = next[hit.index];
    if (!now) next[hit.index] = 'bold';
    else if (now === 'bold') next[hit.index] = 'accent';
    else delete next[hit.index];
    emphasis = next;
  }

  /** Mouse wheel zooms a picture on a computer; without one it scrolls as normal. */
  function wheelZoom(node: HTMLCanvasElement) {
    const onWheel = (e: WheelEvent) => {
      if (!image) return;
      e.preventDefault();
      const zoom = Math.max(1, Math.min(4, image.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      setImage({ ...image, zoom });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', onWheel) };
  }

  // ── Style changes ──────────────────────────────────────────────────────────

  function patch(p: Partial<CardStyle>) {
    style = { ...style, ...p };
  }

  function applyChosenLook(look: CardStyle) {
    const wantsPhoto = look.background === 'photo' && !!photo;
    const wantsPainting = look.background === 'painting' && !!painting;
    style = applyLook(look, wantsPhoto || wantsPainting);
  }

  // Colours
  type ColourTarget = 'text' | 'accent' | 'bg';
  let colourTarget: ColourTarget = 'text';
  const custom = getCustomThemeSettings();
  let textPresets: string[] = custom.textPresets;
  let bgPresets: string[] = custom.bgPresets;

  $: colourValue =
    colourTarget === 'text' ? style.textColor : colourTarget === 'accent' ? style.accentColor : style.bgColor;
  $: presets = colourTarget === 'bg' ? bgPresets : textPresets;

  function setColour(hex: string) {
    if (colourTarget === 'text') patch({ textColor: hex });
    else if (colourTarget === 'accent') patch({ accentColor: hex });
    // Choosing a background colour means wanting a plain background.
    else patch({ bgColor: hex, background: 'solid' });
  }

  function savePreset() {
    if (!isValidHex(colourValue)) return;
    if (colourTarget === 'bg') {
      if (bgPresets.includes(colourValue) || bgPresets.length >= MAX_COLOR_PRESETS) return;
      bgPresets = [...bgPresets, colourValue];
      updateCustomThemeSettings({ bgPresets });
    } else {
      if (textPresets.includes(colourValue) || textPresets.length >= MAX_COLOR_PRESETS) return;
      textPresets = [...textPresets, colourValue];
      updateCustomThemeSettings({ textPresets });
    }
  }

  /** Worst contrast between the words and what is behind them, where that can be known. */
  $: contrast = (() => {
    if (style.background === 'solid') return contrastRatio(style.textColor, style.bgColor);
    if (style.background === 'gradient') {
      const g = getGradient(style.gradientId);
      return Math.min(contrastRatio(style.textColor, g.from), contrastRatio(style.textColor, g.to));
    }
    return null; // a photo varies across the frame; the shadow and Darken handle it
  })();
  $: lowContrast = contrast !== null && contrast < 3;

  // Backgrounds
  let fileInput: HTMLInputElement | null = null;
  let loadingImage = false;
  const artStore = new IndexedDBArtStore();

  function useGradient(id: string) {
    const g = getGradient(id);
    patch({ background: 'gradient', gradientId: id, textColor: g.text, accentColor: g.accent });
  }

  function chooseBackground(kind: CardStyle['background']) {
    if (kind === 'photo' && !photo) {
      fileInput?.click();
      return;
    }
    if (kind === 'gradient' && style.background !== 'gradient') {
      useGradient(style.gradientId);
      return;
    }
    patch({ background: kind });
  }

  /** New picture on the card: colours from the picture, dimmed so pale words read. */
  function adoptImage(kind: 'photo' | 'painting', img: CardImage) {
    const c = suggestColours(img.source);
    if (kind === 'photo') photo = img;
    else painting = img;
    patch({
      background: kind,
      textColor: c.text,
      accentColor: c.accent,
      bgColor: c.bg,
      darken: Math.max(style.darken, 0.35),
    });
  }

  async function onPhotoPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = ''; // so the same photo can be picked again
    if (!picked) return;
    loadingImage = true;
    try {
      const d = await decodeImage(picked);
      adoptImage('photo', { ...d, zoom: 1, panX: 0, panY: 0 });
    } catch (err) {
      console.warn('[ShareCard] photo failed', err);
      showNotice('That photo could not be opened. Try a JPEG or PNG.', 'error');
    } finally {
      loadingImage = false;
    }
  }

  async function onPaintingPicked(e: CustomEvent<{ imageId: string; credit: string }>) {
    const { imageId, credit } = e.detail;
    if (imageId === paintingId && painting) {
      patch({ background: 'painting' });
      return;
    }
    loadingImage = true;
    try {
      const url = await artStore.getImageUrl(imageId);
      if (!url) throw new Error('image not installed');
      const d = await decodeImage(url);
      paintingId = imageId;
      adoptImage('painting', { ...d, zoom: 1, panX: 0, panY: 0, credit });
    } catch (err) {
      console.warn('[ShareCard] painting failed', err);
      showNotice('That painting could not be opened.', 'error');
    } finally {
      loadingImage = false;
    }
  }

  const TEXTURES: { id: CardTexture; label: string }[] = [
    { id: 'none', label: 'None' },
    { id: 'grain', label: 'Grain' },
    { id: 'paper', label: 'Paper' },
  ];

  const SIZE_ORDER: CardSize[] = ['square', 'portrait', 'story'];

  // ── What this device can do ───────────────────────────────────────────────

  /** Can the OS share sheet take an image file? Probed once with a real image type. */
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
    if (!canvas) return;
    try {
      // The clipboard takes PNG only, whatever the shared file is.
      const png = await new Promise<Blob | null>((r) => canvas!.toBlob(r, 'image/png'));
      if (!png) throw new Error('no image');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
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
    if (frame) cancelAnimationFrame(frame);
    if (exportTimer) clearTimeout(exportTimer);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    artStore.releaseImages();
  });
</script>

<div class="sc">
  <div class="sc-preview" class:sc-drawing={drawing || loadingImage}>
    <canvas
      bind:this={canvas}
      use:wheelZoom
      class="sc-canvas"
      class:sc-movable={!!image}
      aria-label="Card preview"
      on:pointerdown={onPointerDown}
      on:pointermove={onPointerMove}
      on:pointerup={onPointerUp}
      on:pointercancel={onPointerCancel}
    ></canvas>
  </div>

  <p class="sc-hint">
    {#if wordCount > 0}Tap a word for bold, again for accent colour.{/if}
    {#if image} Drag to move the picture, pinch to zoom.{/if}
    {#if hasEmphasis}<button class="sc-link" on:click={() => (emphasis = {})}>Clear words</button>{/if}
  </p>

  <div class="sc-sections" role="tablist" aria-label="Card settings">
    {#each SECTIONS as s}
      <button
        class="sc-section"
        class:active={section === s.id}
        role="tab"
        aria-selected={section === s.id}
        on:click={() => (section = s.id)}
      >{s.label}</button>
    {/each}
  </div>

  <div class="sc-controls">
    {#if section === 'looks'}
      <ShareCardLooks {style} on:apply={(e) => applyChosenLook(e.detail)} />

    {:else if section === 'font'}
      <FontField
        value={style.fontId}
        defaultLabel="Card default (EB Garamond)"
        on:change={(e) => patch({ fontId: e.detail })}
      />

    {:else if section === 'colour'}
      <div class="sc-chips">
        <button class="sc-chip" class:active={colourTarget === 'text'} on:click={() => (colourTarget = 'text')}>
          <span class="sc-dot" style="background:{style.textColor}"></span>Words
        </button>
        <button class="sc-chip" class:active={colourTarget === 'accent'} on:click={() => (colourTarget = 'accent')}>
          <span class="sc-dot" style="background:{style.accentColor}"></span>Accent
        </button>
        <button class="sc-chip" class:active={colourTarget === 'bg'} on:click={() => (colourTarget = 'bg')}>
          <span class="sc-dot" style="background:{style.bgColor}"></span>Background
        </button>
      </div>
      {#if colourTarget === 'accent'}
        <p class="sc-note">For words you tap twice on the card.</p>
      {:else if colourTarget === 'bg' && style.background !== 'solid'}
        <p class="sc-note">Picking a colour here switches the background to plain colour.</p>
      {/if}
      <ColorField value={colourValue} label="Card colour" on:change={(e) => setColour(e.detail)}>
        <button
          class="sc-small-btn"
          type="button"
          disabled={presets.includes(colourValue) || presets.length >= MAX_COLOR_PRESETS}
          on:click={savePreset}
        >Add</button>
      </ColorField>
      {#if presets.length}
        <div class="sc-swatches">
          {#each presets as colour}
            <button class="sc-swatch" style="background:{colour}" title={colour} on:click={() => setColour(colour)}></button>
          {/each}
        </div>
      {/if}
      {#if lowContrast && contrast !== null}
        <p class="sc-warn">Low contrast ({contrast.toFixed(1)}:1). The words may be hard to read.</p>
      {/if}

    {:else if section === 'background'}
      <div class="sc-chips">
        <button class="sc-chip" class:active={style.background === 'solid'} on:click={() => chooseBackground('solid')}>Colour</button>
        <button class="sc-chip" class:active={style.background === 'gradient'} on:click={() => chooseBackground('gradient')}>Gradient</button>
        <button class="sc-chip" class:active={style.background === 'photo'} on:click={() => chooseBackground('photo')}>Your photo</button>
        <button class="sc-chip" class:active={style.background === 'painting'} on:click={() => chooseBackground('painting')}>Painting</button>
      </div>
      <input bind:this={fileInput} type="file" accept="image/*" hidden on:change={onPhotoPicked} />

      {#if style.background === 'solid'}
        <p class="sc-note">Set the colour under Colour → Background.</p>
      {:else if style.background === 'gradient'}
        <div class="sc-gradients">
          {#each CARD_GRADIENTS as g}
            <button
              class="sc-gradient"
              class:active={style.gradientId === g.id}
              style="background:{gradientCss(g)}; color:{g.text}"
              on:click={() => useGradient(g.id)}
            >{g.label}</button>
          {/each}
        </div>
      {:else if style.background === 'photo'}
        <div class="sc-row">
          <button class="sc-small-btn" on:click={() => fileInput?.click()}>{photo ? 'Choose another photo' : 'Choose a photo'}</button>
          <span class="sc-note sc-inline">Stays on this device. It is never uploaded.</span>
        </div>
      {:else if style.background === 'painting'}
        <ShareCardPaintings
          book={shareRef.book}
          chapter={shareRef.chapter}
          verse={shareRef.startVerse}
          selectedId={paintingId}
          on:pick={onPaintingPicked}
        />
      {/if}

      {#if image}
        <label class="sc-slider">
          <span>Blur</span>
          <input type="range" min="0" max="1" step="0.02" value={style.blur}
            on:input={(e) => patch({ blur: +e.currentTarget.value })} />
        </label>
        <label class="sc-slider">
          <span>Darken</span>
          <input type="range" min="0" max="1" step="0.02" value={style.darken}
            on:input={(e) => patch({ darken: +e.currentTarget.value })} />
        </label>
        <label class="sc-slider">
          <span>Zoom</span>
          <input type="range" min="1" max="4" step="0.02" value={image.zoom}
            on:input={(e) => image && setImage({ ...image, zoom: +e.currentTarget.value })} />
        </label>
      {/if}

      <div class="sc-field-label">Texture</div>
      <div class="sc-chips">
        {#each TEXTURES as t}
          <button class="sc-chip" class:active={style.texture === t.id} on:click={() => patch({ texture: t.id })}>{t.label}</button>
        {/each}
      </div>

    {:else if section === 'layout'}
      <div class="sc-field-label">Size</div>
      <div class="sc-chips">
        {#each SIZE_ORDER as size}
          <button class="sc-chip" class:active={style.size === size} aria-pressed={style.size === size} on:click={() => patch({ size })}>
            <span class="sc-size-shape sc-shape-{size}" aria-hidden="true"></span>
            {CARD_SIZES[size].label}
          </button>
        {/each}
      </div>

      <div class="sc-field-label">Words</div>
      <div class="sc-chips">
        <button class="sc-chip" class:active={style.align === 'left'} on:click={() => patch({ align: 'left' })}>Left</button>
        <button class="sc-chip" class:active={style.align === 'center'} on:click={() => patch({ align: 'center' })}>Centre</button>
        <span class="sc-gap"></span>
        <button class="sc-chip" class:active={style.position === 'top'} on:click={() => patch({ position: 'top' })}>Top</button>
        <button class="sc-chip" class:active={style.position === 'middle'} on:click={() => patch({ position: 'middle' })}>Middle</button>
        <button class="sc-chip" class:active={style.position === 'bottom'} on:click={() => patch({ position: 'bottom' })}>Bottom</button>
      </div>

      <label class="sc-slider">
        <span>Text size</span>
        <input type="range" min="0.6" max="1.4" step="0.05" value={style.sizeNudge}
          on:input={(e) => patch({ sizeNudge: +e.currentTarget.value })} />
      </label>
      <p class="sc-note">Long verses shrink to fit whatever this is set to.</p>

      <label class="sc-toggle">
        <input type="checkbox" checked={style.qr} on:change={(e) => patch({ qr: e.currentTarget.checked })} />
        <span>QR code that opens this verse in the app</span>
      </label>
    {/if}
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
</div>

<style>
  /* The panel fills what the sheet has left and scrolls only its controls, so
     the preview and the Share button are always in view while adjusting. */
  .sc {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* ── Preview ──
     The canvas is 1080px wide; CSS scales it down to fit, never up. */
  .sc-preview {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 8px;
    height: min(36vh, 320px);
    transition: opacity 0.15s;
  }
  .sc-drawing { opacity: 0.75; }

  .sc-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    border-radius: 4px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    cursor: pointer;
    touch-action: manipulation;
  }
  .sc-movable {
    cursor: grab;
    touch-action: none;
  }

  .sc-hint {
    flex: none;
    margin: 8px 2px 0;
    font-size: 0.72rem;
    color: #888;
    line-height: 1.4;
  }
  .sc-link {
    background: none;
    border: none;
    padding: 0 0 0 6px;
    color: #9fd0ff;
    font-size: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  /* ── Section tabs ── */
  .sc-sections {
    flex: none;
    display: flex;
    gap: 4px;
    margin-top: 10px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .sc-section {
    flex: 1 0 auto;
    padding: 7px 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sc-section:hover { color: #ccc; }
  .sc-section.active {
    color: #f0f0f0;
    border-bottom-color: #3b82f6;
  }

  .sc-controls {
    flex: 1 1 auto;
    min-height: 110px;
    overflow-y: auto;
    padding: 12px 2px 4px;
    border-top: 1px solid #2a2a2a;
  }

  /* ── Shared control bits ── */
  .sc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .sc-gap { width: 8px; }

  .sc-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 13px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #999;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .sc-chip:hover { color: #ccc; }
  .sc-chip.active {
    background: #1e3a5f;
    border-color: #2f6ba8;
    color: #9fd0ff;
  }

  .sc-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }

  .sc-field-label {
    margin: 14px 2px 6px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #777;
  }
  .sc-field-label:first-child { margin-top: 0; }

  .sc-note {
    margin: 8px 2px;
    font-size: 0.75rem;
    color: #888;
    line-height: 1.4;
  }
  .sc-inline { margin: 0; }

  .sc-warn {
    margin: 8px 2px 0;
    font-size: 0.75rem;
    color: #fbbf24;
  }

  .sc-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }

  .sc-small-btn {
    padding: 6px 14px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 20px;
    color: #ddd;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sc-small-btn:disabled { opacity: 0.5; cursor: default; }

  .sc-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .sc-swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid #444;
    cursor: pointer;
    padding: 0;
  }

  .sc-gradients {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
    gap: 6px;
    margin-top: 12px;
  }
  .sc-gradient {
    height: 52px;
    border: 2px solid transparent;
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .sc-gradient.active { border-color: #9fd0ff; }

  .sc-slider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    font-size: 0.75rem;
    color: #aaa;
  }
  .sc-slider span { width: 64px; flex: none; }
  .sc-slider input { flex: 1; accent-color: #3b82f6; }

  .sc-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    font-size: 0.8rem;
    color: #ccc;
    cursor: pointer;
  }
  .sc-toggle input { accent-color: #3b82f6; width: 16px; height: 16px; }

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

  /* ── Actions ── matches the Text side's buttons */
  .sc-actions {
    flex: none;
    display: flex;
    gap: 10px;
    margin-top: 12px;
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
