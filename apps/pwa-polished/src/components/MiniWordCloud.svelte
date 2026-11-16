<script context="module" lang="ts">
  import type { Cloud } from '../lib/bookPicture/cloud';

  /** Packed clouds, by shape and book: packing is the slow part, and a book's cloud never changes. */
  const packed = new Map<string, Cloud>();
</script>

<script lang="ts">
  /**
   * A book's word cloud, small: round under its chapter 1 title (above the
   * Connections strip), or wide across the top of its Introduction. Its most
   * used words in the NET, sized by how often the book uses them
   * (lib/bookPicture/cloudDraw.ts). Tapping it opens the full-screen cloud.
   *
   * Worked out and drawn only once it comes near the screen; the reader can
   * have many chapters up. The data loads with the first one.
   *
   * Drawn on the Light or Dark ground the Bubbles use. In light and sepia the
   * reader is inverted by the theme's filter, so the canvas cancels it, as
   * the Connections strip does.
   */
  import { onDestroy } from 'svelte';
  import { bookTitle, getBookColor, normalizeBookName, outlineColorFor } from '../lib/bibleData';
  import { loadBubbleData } from '../lib/bookPicture/bubbleData';
  import { GROUNDS, bubbleGround } from '../lib/bookPicture/ground';
  import { circleMask, cloudFontReady, drawWordCloud, packBookCloud, rectMask } from '../lib/bookPicture/cloudDraw';

  export let book: string;
  /** Wide across the top of the Introduction, rather than round. */
  export let wide = false;
  export let onOpen: () => void;

  /** Round: a box this many units square. Wide: this wide and WIDE_H tall. */
  const BOX = 200;
  const WIDE_W = 1000;
  const WIDE_H = 360;
  const ROUND_WORDS = 36;
  const WIDE_WORDS = 90;

  let host: HTMLButtonElement;
  let canvas: HTMLCanvasElement;
  let near = false;
  let width = 0;
  let cloud: Cloud | null = null;
  let tick = 0;

  $: if (near && book) void prepare(book, wide);

  async function prepare(b: string, isWide: boolean): Promise<void> {
    const key = `${isWide ? 'w' : 'r'}|${b}`;
    let c = packed.get(key);
    if (!c) {
      const [data] = await Promise.all([loadBubbleData(), cloudFontReady()]);
      const words = data.clouds.get(normalizeBookName(b));
      if (!words?.length) return;
      c = packed.get(key) ?? packBookCloud(b, words, isWide ? rectMask(WIDE_W, WIDE_H) : circleMask(BOX), isWide ? WIDE_WORDS : ROUND_WORDS);
      packed.set(key, c);
    }
    if (b === book && isWide === wide) cloud = c;
  }

  $: if (canvas && cloud && width > 0) paint(cloud, width, tick);

  function paint(c: Cloud, w: number, _tick: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const unitsW = wide ? WIDE_W : BOX;
    const unitsH = wide ? WIDE_H : BOX;
    const h = (w * unitsH) / unitsW;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    canvas.style.height = `${h}px`;
    const g = GROUNDS[bubbleGround()];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = g.bg;
    ctx.beginPath();
    if (wide) {
      const r = 12 * ratio;
      ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    } else {
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
    }
    ctx.fill();
    const color = getBookColor(book);
    drawWordCloud(ctx, c, 0, 0, canvas.width / unitsW, { ground: g, color, ring: outlineColorFor(color) }, ratio);
  }

  // Redrawn when the Light/Dark setting or the theme changes.
  function repaint(): void {
    tick++;
  }

  let sizeObserver: ResizeObserver | null = null;
  let viewObserver: IntersectionObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  $: if (host && !sizeObserver) {
    const el = host;
    sizeObserver = new ResizeObserver(() => (width = el.clientWidth));
    sizeObserver.observe(el);
    viewObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) near = true;
      },
      { rootMargin: '400px 0px' },
    );
    viewObserver.observe(el);
    themeObserver = new MutationObserver(repaint);
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('settingsUpdated', repaint);
  }

  onDestroy(() => {
    sizeObserver?.disconnect();
    viewObserver?.disconnect();
    themeObserver?.disconnect();
    window.removeEventListener('settingsUpdated', repaint);
  });
</script>

<button
  type="button"
  class="mini-cloud"
  class:wide
  bind:this={host}
  title="{bookTitle(book)}’s most used words"
  aria-label="{bookTitle(book)}’s most used words, as a word cloud"
  on:click|stopPropagation={onOpen}
>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</button>

<style>
  .mini-cloud {
    display: block;
    width: 140px;
    aspect-ratio: 1;
    margin: 6px auto 4px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .mini-cloud.wide {
    width: 100%;
    aspect-ratio: 1000 / 360;
    margin: 0 0 16px;
  }

  canvas {
    display: block;
    width: 100%;
  }

  /* The theme's invert would turn the ground and the book colors into their opposites. */
  :global(body.light-theme .themed) canvas,
  :global(body.sepia-theme .themed) canvas {
    filter: invert(1) hue-rotate(180deg);
  }
</style>
