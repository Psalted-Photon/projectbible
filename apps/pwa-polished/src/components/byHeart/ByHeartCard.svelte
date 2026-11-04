<script lang="ts">
  /**
   * The card a game is played on: the real share card with its words covered,
   * centered on the screen with its background filling the rest, so the words
   * sit in the same place on every device.
   *
   * A word blur is a blurred copy of the whole card, painted over each covered
   * word; a black box is a box. Both are painted on the canvas itself, so a long
   * passage costs no more than a short one. `blur` is a share of the text size,
   * so one number means the same at every size. The first `revealed` words are
   * clear, and each one clears at once as it is reached.
   */
  import { onDestroy } from 'svelte';
  import { CARD_SIZES, getGradient, gradientCss, renderCard, type CardContent, type CardImage, type CardStyle, type Emphasis, type WordBox } from '../../lib/shareCard';
  import type { GameCover } from '../../lib/byHeart/game';

  export let content: CardContent;
  export let style: CardStyle;
  export let emphasis: Record<number, Emphasis> = {};
  export let image: CardImage | null = null;
  export let qrUrl = '';
  export let cover: GameCover = 'wordblur';
  export let blur = 0.29;
  export let revealed = 0;
  /** Covers the reference too, for when it has to be said. */
  export let coverReference = false;
  export let onTapWord: ((index: number) => void) | undefined = undefined;

  let canvas: HTMLCanvasElement | null = null;
  let innerWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  let innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  /** Each word's place, then the reference's. */
  let zones: WordBox[] = [];
  let wordCount = 0;
  let fontCardPx = 0;
  let sharp: HTMLCanvasElement | null = null;
  let soft: HTMLCanvasElement | null = null;

  $: W = CARD_SIZES[style.size].w;
  $: H = CARD_SIZES[style.size].h;
  $: scale = Math.min(innerWidth / W, innerHeight / H);
  $: stageBackground = style.background === 'gradient' ? gradientCss(getGradient(style.gradientId)) : style.bgColor;

  // ── Drawing the card ───────────────────────────────────────────────────────

  let drawToken = 0;
  $: drawKey = JSON.stringify([content, style, emphasis, qrUrl]);
  $: if (canvas && drawKey) {
    void image;
    void draw();
  }

  async function draw() {
    const token = ++drawToken;
    const target = (sharp ??= document.createElement('canvas'));
    const done = await renderCard(target, content, style, { emphasis, image, qrUrl });
    if (token !== drawToken || !canvas) return;
    wordCount = done.boxes.length;
    zones = [...done.boxes, { index: done.boxes.length, ...done.referenceBox }];
    fontCardPx = done.fontSize;
    // Through a local: setting a property on `canvas` itself counts as changing
    // it, which starts another draw, and with nothing left to load the draws
    // chain without ever letting the page paint or take a tap.
    const shown = canvas;
    shown.width = target.width;
    shown.height = target.height;
    softBlur = -1;
    paintAll();
  }

  // ── The covers ─────────────────────────────────────────────────────────────

  let softBlur = -1;
  /** Which zones are painted covered right now. */
  let covered: boolean[] = [];

  const coveredAt = (i: number) => (i >= wordCount ? coverReference : i >= revealed);

  function buildSoft() {
    if (!sharp) return;
    const cardPx = blur * fontCardPx;
    if (cardPx === softBlur && soft) return;
    soft ??= document.createElement('canvas');
    soft.width = sharp.width;
    soft.height = sharp.height;
    const ctx = soft.getContext('2d')!;
    if (typeof (ctx as { filter?: unknown }).filter === 'string') {
      ctx.filter = `blur(${cardPx}px)`;
      ctx.drawImage(sharp, 0, 0);
    } else {
      // Older iPhones ignore ctx.filter: draw small and scale back up, as a photo's blur does.
      const f = 1 / (1 + cardPx / 4);
      const small = document.createElement('canvas');
      small.width = Math.max(2, Math.round(sharp.width * f));
      small.height = Math.max(2, Math.round(sharp.height * f));
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(sharp, 0, 0, small.width, small.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, sharp.width, sharp.height);
    }
    softBlur = cardPx;
  }

  function paintZone(ctx: CanvasRenderingContext2D, i: number) {
    const b = zones[i];
    if (!b || !sharp) return;
    ctx.drawImage(sharp, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    if (!covered[i]) return;
    if (cover === 'box') {
      // A faint edge, so a black box still shows on a black card.
      ctx.fillStyle = '#000';
      ctx.strokeStyle = 'rgba(127, 127, 127, 0.5)';
      ctx.lineWidth = Math.max(1, b.h * 0.015);
      const inset = b.h * 0.08;
      ctx.fillRect(b.x, b.y + inset, b.w, b.h - inset * 2);
      ctx.strokeRect(b.x, b.y + inset, b.w, b.h - inset * 2);
    } else if (soft) {
      ctx.drawImage(soft, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    }
  }

  /** The whole card again: a new draw, or a change of cover. */
  function paintAll() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !sharp) return;
    ctx.drawImage(sharp, 0, 0);
    if (cover === 'wordblur') buildSoft();
    zones.forEach((_, i) => {
      covered[i] = coveredAt(i);
      paintZone(ctx, i);
    });
  }

  /** Only the zones whose cover changed. */
  function paintChanges() {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    zones.forEach((_, i) => {
      const want = coveredAt(i);
      if (covered[i] === want) return;
      covered[i] = want;
      paintZone(ctx, i);
    });
  }
  $: revealed, coverReference, zones, paintChanges();

  // The slider: every covered word again from a new blurred copy, once a frame.
  let blurFrame = 0;
  function blurChanged() {
    if (cover !== 'wordblur' || blurFrame) return;
    blurFrame = requestAnimationFrame(() => {
      blurFrame = 0;
      const ctx = canvas?.getContext('2d');
      if (!ctx || cover !== 'wordblur') return;
      buildSoft();
      zones.forEach((_, i) => {
        if (covered[i]) paintZone(ctx, i);
      });
    });
  }
  $: if (blur >= 0) blurChanged();

  let shownCover: GameCover = cover;
  $: if (cover !== shownCover) {
    shownCover = cover;
    paintAll();
  }

  onDestroy(() => {
    drawToken++;
    if (blurFrame) cancelAnimationFrame(blurFrame);
    // Phones run short on these; they don't wait to be collected.
    for (const c of [sharp, soft]) {
      if (c) c.width = c.height = 0;
    }
  });

  // ── Taps ───────────────────────────────────────────────────────────────────

  function tapped(e: MouseEvent) {
    if (!onTapWord || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hit = zones.slice(0, wordCount).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) onTapWord(hit.index);
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="stage" style="background: {stageBackground};">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="card" style="width: {W * scale}px; height: {H * scale}px;" on:click={tapped}>
    <canvas bind:this={canvas} aria-label="{content.reference}, with its words covered"></canvas>
  </div>
</div>

<style>
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card {
    position: relative;
    flex-shrink: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
