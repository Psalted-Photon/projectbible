<script lang="ts">
  /**
   * The real share card (lib/shareCard) with its words covered, the way a game
   * will show it. Three covers to compare:
   *
   * - Blur pills: one element per word over the card, frosting what is behind it.
   * - Word blur: no elements. A blurred copy of the card is painted over each
   *   covered word on the canvas itself, the fallback if pills are too slow.
   * - Black box: a plain box per word.
   *
   * `blur` is a share of the text size on screen, so one number means the same
   * thing at every size. The first `revealed` words are uncovered.
   */
  import { onDestroy } from 'svelte';
  import { getGradient, gradientCss, renderCard, CARD_SIZES, type CardStyle, type Emphasis, type WordBox } from '../../../lib/shareCard';
  import type { CoverKind } from '../../../lib/byHeart/lab/labResults';

  export let passage = '';
  export let reference = '';
  export let translationLabel = '';
  export let style: CardStyle;
  export let emphasis: Record<number, Emphasis> = {};
  /** Null shows the card bare. */
  export let cover: CoverKind | null = 'pill';
  export let blur = 0.5;
  export let revealed = 0;
  /** Over the whole screen, as a game shows it. */
  export let full = false;
  export let onTapWord: ((index: number) => void) | undefined = undefined;
  /** Told after each draw. */
  export let onDrawn: ((info: { fontCardPx: number; fontScreenPx: number; fullScale: number; drawMs: number; words: number }) => void) | undefined =
    undefined;

  /** How long a pill takes to clear, in ms. */
  const FADE_MS = 180;

  let canvas: HTMLCanvasElement | null = null;
  let stageWidth = 0;
  let innerWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  let innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  let boxes: WordBox[] = [];
  let fontCardPx = 0;
  let sharp: HTMLCanvasElement | null = null;
  let soft: HTMLCanvasElement | null = null;
  /** How long the last blurred copy took to make. */
  export let buildMs: number | null = null;

  $: W = CARD_SIZES[style.size].w;
  $: H = CARD_SIZES[style.size].h;
  $: scale = full
    ? Math.min(innerWidth / W, innerHeight / H)
    : Math.min((stageWidth || innerWidth) / W, (innerHeight * 0.6) / H);
  $: fontScreenPx = fontCardPx * scale;
  $: blurPx = blur * fontScreenPx;
  $: stageBackground =
    style.background === 'gradient' ? gradientCss(getGradient(style.gradientId)) : style.bgColor;

  // ── Drawing the card ───────────────────────────────────────────────────────

  let drawToken = 0;
  $: drawKey = JSON.stringify([passage, reference, translationLabel, style, emphasis]);
  $: if (canvas && drawKey) void draw();

  async function draw() {
    const token = ++drawToken;
    const from = performance.now();
    const target = (sharp ??= document.createElement('canvas'));
    const done = await renderCard(target, { passage, reference, translationLabel }, style, { emphasis });
    if (token !== drawToken || !canvas) return;
    boxes = done.boxes;
    fontCardPx = done.fontSize;
    canvas.width = target.width;
    canvas.height = target.height;
    softBlur = -1;
    alpha = [];
    paintAll();
    onDrawn?.({
      fontCardPx,
      fontScreenPx: fontCardPx * scale,
      fullScale: Math.min(window.innerWidth / target.width, window.innerHeight / target.height),
      drawMs: performance.now() - from,
      words: boxes.length,
    });
  }

  // ── Word blur: the blurred copy over each covered word ─────────────────────

  let softBlur = -1;
  /** Each word's cover: 1 covered, 0 clear. */
  let alpha: number[] = [];
  let raf = 0;
  let lastFrame = 0;

  function buildSoft() {
    if (!sharp) return;
    const cardPx = scale > 0 ? blurPx / scale : 0;
    if (cardPx === softBlur && soft) return;
    const from = performance.now();
    soft ??= document.createElement('canvas');
    soft.width = sharp.width;
    soft.height = sharp.height;
    const ctx = soft.getContext('2d')!;
    const canFilter = typeof (ctx as { filter?: unknown }).filter === 'string';
    if (canFilter) {
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
    buildMs = performance.now() - from;
  }

  function paintWord(ctx: CanvasRenderingContext2D, i: number) {
    const b = boxes[i];
    if (!b || !sharp) return;
    ctx.drawImage(sharp, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    const a = alpha[i] ?? 0;
    if (a > 0 && soft) {
      ctx.globalAlpha = a;
      ctx.drawImage(soft, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
      ctx.globalAlpha = 1;
    }
  }

  /** The whole card again: a new draw, or a change of cover. */
  function paintAll() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !sharp) return;
    ctx.globalAlpha = 1;
    ctx.drawImage(sharp, 0, 0);
    if (cover !== 'wordblur') return;
    buildSoft();
    boxes.forEach((_, i) => {
      alpha[i] = i < revealed ? 0 : 1;
      paintWord(ctx, i);
    });
  }

  /** Move each word's cover toward where it belongs, painting only what changed. */
  function step(now: number) {
    raf = 0;
    const ctx = canvas?.getContext('2d');
    if (!ctx || cover !== 'wordblur') return;
    const change = lastFrame ? (now - lastFrame) / FADE_MS : 1;
    lastFrame = now;
    let moving = false;
    boxes.forEach((_, i) => {
      const want = i < revealed ? 0 : 1;
      const a = alpha[i] ?? want;
      if (a === want) return;
      const next = want > a ? Math.min(want, a + change) : Math.max(want, a - change);
      alpha[i] = next;
      paintWord(ctx, i);
      if (next !== want) moving = true;
    });
    if (moving) raf = requestAnimationFrame(step);
    else lastFrame = 0;
  }

  function startFade() {
    if (cover === 'wordblur' && boxes.length && !raf) raf = requestAnimationFrame(step);
  }
  $: revealed, boxes, cover, startFade();

  // The slider: every covered word again from a new blurred copy, once a frame.
  let blurFrame = 0;
  function blurChanged() {
    if (cover !== 'wordblur' || blurFrame) return;
    blurFrame = requestAnimationFrame(() => {
      blurFrame = 0;
      const ctx = canvas?.getContext('2d');
      if (!ctx || cover !== 'wordblur') return;
      buildSoft();
      boxes.forEach((_, i) => {
        if ((alpha[i] ?? 0) > 0) paintWord(ctx, i);
      });
    });
  }
  $: if (blurPx >= 0) blurChanged();

  let shownCover: CoverKind | null | undefined = undefined;
  $: if (cover !== shownCover) {
    shownCover = cover;
    paintAll();
  }

  onDestroy(() => {
    drawToken++;
    if (raf) cancelAnimationFrame(raf);
    if (blurFrame) cancelAnimationFrame(blurFrame);
  });

  // ── Taps ───────────────────────────────────────────────────────────────────

  function tapped(e: MouseEvent) {
    if (!onTapWord || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const hit = boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) onTapWord(hit.index);
  }
</script>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="stage" class:full bind:clientWidth={stageWidth} style="background: {full ? stageBackground : 'transparent'};">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="card" style="width: {W * scale}px; height: {H * scale}px; --blur: {blurPx}px;" on:click={tapped}>
    <canvas bind:this={canvas}></canvas>
    {#if cover === 'pill' || cover === 'box'}
      {#each boxes as b, i (b.index)}
        <span
          class="cover"
          class:box={cover === 'box'}
          class:gone={i < revealed}
          style="left: {(b.x / W) * 100}%; top: {((b.y + b.h * 0.08) / H) * 100}%; width: {(b.w / W) * 100}%; height: {((b.h * 0.84) / H) * 100}%;"
        ></span>
      {/each}
    {/if}
  </div>
</div>

<style>
  .stage {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .stage.full {
    position: fixed;
    inset: 0;
    z-index: 5;
    align-items: center;
  }

  .card {
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .cover {
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
    -webkit-backdrop-filter: blur(var(--blur));
    backdrop-filter: blur(var(--blur));
    background: rgba(127, 127, 127, 0.08);
    transition: opacity 180ms ease-out;
  }

  .cover.box {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background: #000;
    border-radius: 4px;
  }

  .cover.gone {
    opacity: 0;
  }
</style>
