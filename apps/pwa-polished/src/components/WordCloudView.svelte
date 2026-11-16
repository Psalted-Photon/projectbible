<script lang="ts">
  /**
   * A book's word cloud, full screen: its 160 most used words in the NET,
   * sized by how often the book uses them, filler words left out. Opened by
   * tapping the small cloud under a book's chapter 1 title or at the top of
   * its Introduction; closed by × and Escape.
   *
   * Pinch, scroll or double-tap to zoom in on the small words (the Bubbles'
   * pan and zoom, bubbleScene.ts). Tapping a word shows how often the book
   * uses it, with "See it on the Bubbles" and "Show verses in [book]"; both
   * make the word a Repeat. A verse picked from the list goes to the reader
   * the cloud was opened from, which leaves its own crumb (WordCloudOpen.leave).
   *
   * Over everything, outside the theme's invert, so it is drawn straight in
   * its Light or Dark: the picture, the bar and the card alike.
   */
  import { onMount } from 'svelte';
  import { CirclesThree, ListBullets, Minus, Plus } from 'phosphor-svelte';
  import CloseX from './CloseX.svelte';
  import RepeatVersesPanel from './RepeatVersesPanel.svelte';
  import { bookTitle, getBookColor, inkStyle, normalizeBookName, outlineColorFor } from '../lib/bibleData';
  import { loadBubbleData } from '../lib/bookPicture/bubbleData';
  import { GROUNDS, bubbleGround, setBubbleGround, type BubbleGround } from '../lib/bookPicture/ground';
  import { cloudAccent, cloudFontReady, drawWordCloud, packBookCloud, rectMask } from '../lib/bookPicture/cloudDraw';
  import { cloudWordAt, type Cloud, type CloudWord } from '../lib/bookPicture/cloud';
  import { ZoomView } from '../lib/bookPicture/bubbleScene';
  import {
    bubbleTranslation,
    closeWordCloud,
    makeRepeat,
    showOnBubbles,
    type WordCloudOpen,
  } from '../stores/bubbleViewStore';

  export let open: WordCloudOpen;

  const WORDS = 160;
  const WORLD_W = 1000;

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let view: ZoomView | null = null;
  let words: CloudWord[] = [];
  let cloud: Cloud | null = null;
  /** The world's height; its width is WORLD_W. Follows the screen's shape. */
  let worldH = 1000;
  let ground: BubbleGround = bubbleGround();
  /** The tapped word, as a placed index. */
  let picked = -1;
  let versesButton: HTMLButtonElement;
  let verses: { word: string; label: string; colorIndex: number; anchor: HTMLElement | null } | null = null;
  let failed = false;

  $: book = open.book;
  $: color = getBookColor(book);
  $: lit = bubbleTranslation(open.translation);
  $: g = GROUNDS[ground];
  $: accent = cloudAccent({ ground: g, color, ring: '' });
  $: pickedWord = cloud && picked >= 0 ? words[cloud.placed[picked]?.word] ?? null : null;

  /** The screen's shape, which the cloud is packed to fill. */
  function shapeFor(w: number, h: number): number {
    return Math.round(WORLD_W * Math.min(2.4, Math.max(0.45, h / Math.max(1, w))));
  }

  function pack(): void {
    if (!words.length || !view) return;
    worldH = shapeFor(view.cssW, view.cssH);
    cloud = packBookCloud(book, words, rectMask(WORLD_W, worldH), WORDS);
    picked = -1;
    view.viewSet = false;
    view.fitView();
    draw();
  }

  function draw(): void {
    if (!view || !canvas) return;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = g.bg;
    c.fillRect(0, 0, canvas.width, canvas.height);
    if (!cloud) return;
    const r = view.dpr;
    drawWordCloud(
      c,
      cloud,
      view.tx * r,
      view.ty * r,
      view.k * r,
      { ground: g, color, ring: outlineColorFor(color) },
      r,
      picked,
      { w: canvas.width, h: canvas.height },
    );
  }

  $: if (g) draw();

  function tap(x: number, y: number): void {
    if (!view || !cloud) return;
    verses = null;
    picked = cloudWordAt(cloud, (x - view.tx) / view.k, (y - view.ty) / view.k, 6 / view.k);
    draw();
  }

  function setGround(next: BubbleGround): void {
    if (next === ground) return;
    ground = next;
    setBubbleGround(next);
  }

  function zoomBy(f: number): void {
    view?.animateZoomAt(view.cssW / 2, view.cssH / 2, f);
  }

  function seeOnBubbles(): void {
    if (pickedWord) showOnBubbles(pickedWord.text, { translation: lit });
  }

  function showVerses(): void {
    if (!pickedWord) return;
    const group = makeRepeat(pickedWord.text, { translation: lit });
    if (!group) return;
    verses = { word: group.word, label: group.label, colorIndex: group.colorIndex, anchor: versesButton };
  }

  function openVerse(b: string, chapter: number, verse: number): void {
    verses = null;
    closeWordCloud();
    open.leave(b, chapter, verse, lit);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    // The verse list goes first; it closes itself on the same key.
    if (verses) {
      verses = null;
      return;
    }
    closeWordCloud();
  }

  function onSettings(): void {
    ground = bubbleGround();
  }

  function fitStage(): void {
    if (!view || !stage) return;
    const r = stage.getBoundingClientRect();
    const before = worldH;
    view.resize(r.width, r.height);
    // A turn of the phone packs it again to fill the new shape.
    if (cloud && Math.abs(shapeFor(view.cssW, view.cssH) - before) / before > 0.15) pack();
  }

  onMount(() => {
    const v = new ZoomView(canvas, {
      world: () => ({ w: WORLD_W, h: worldH }),
      limits: (kf) => [kf * 0.8, kf * 8],
      draw: () => draw(),
      tap,
    });
    view = v;
    fitStage();
    const ro = new ResizeObserver(fitStage);
    ro.observe(stage);
    Promise.all([loadBubbleData(), cloudFontReady()])
      .then(([data]) => {
        if (view !== v) return;
        words = data.clouds.get(normalizeBookName(book)) ?? [];
        pack();
      })
      .catch((error) => {
        console.error('[Word cloud] could not load:', error);
        failed = true;
      });
    window.addEventListener('keydown', onKey);
    window.addEventListener('settingsUpdated', onSettings);
    return () => {
      ro.disconnect();
      v.destroy();
      view = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('settingsUpdated', onSettings);
    };
  });
</script>

<div
  class="word-cloud-view"
  class:light={g.light}
  style="--wc-bg:{g.bg};--wc-ink:{g.neutral}"
  role="dialog"
  aria-label="{bookTitle(book)}’s most used words"
>
  <div class="wc-bar">
    <div class="wc-title">
      <span class="wc-book" style={g.light ? `color:${accent}` : inkStyle(color)}>{bookTitle(book)}</span>
      <span class="wc-sub">most used words</span>
    </div>
    <div class="wc-ground" role="group" aria-label="Background">
      <button type="button" class:on={ground === 'light'} aria-pressed={ground === 'light'} on:click={() => setGround('light')}>Light</button>
      <button type="button" class:on={ground === 'dark'} aria-pressed={ground === 'dark'} on:click={() => setGround('dark')}>Dark</button>
    </div>
    <button type="button" class="wc-btn" title="Zoom out" aria-label="Zoom out" on:click={() => zoomBy(0.5)}>
      <Minus size="1.15em" weight="bold" />
    </button>
    <button type="button" class="wc-btn" title="Zoom in" aria-label="Zoom in" on:click={() => zoomBy(2)}>
      <Plus size="1.15em" weight="bold" />
    </button>
    <CloseX label="Close the word cloud" on:click={closeWordCloud} />
  </div>

  <div class="wc-body">
    <div class="wc-stage" bind:this={stage}>
      <canvas bind:this={canvas}></canvas>
      {#if failed}
        <div class="wc-wait">The word cloud couldn’t load. Close and try again.</div>
      {:else if !cloud}
        <div class="wc-wait">Gathering {bookTitle(book)}’s words…</div>
      {/if}
    </div>

    {#if pickedWord}
      {@const w = pickedWord}
      <div class="wc-card">
        <div class="wc-card-head">
          <span class="wc-word" style="color:{accent}">“{w.text}”</span>
          <span class="wc-count">{w.count.toLocaleString()} {w.count === 1 ? 'time' : 'times'} in {bookTitle(book)}</span>
        </div>
        <div class="wc-actions">
          <button type="button" class="wc-action" on:click={seeOnBubbles}>
            <CirclesThree size="1.1em" weight="bold" />
            <span>See it on the Bubbles</span>
          </button>
          <button type="button" class="wc-action" bind:this={versesButton} on:click={showVerses}>
            <ListBullets size="1.1em" weight="bold" />
            <span>Show verses in {bookTitle(book)}</span>
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if verses}
    {@const rv = verses}
    <RepeatVersesPanel
      word={rv.word}
      label={rv.label}
      colorIndex={rv.colorIndex}
      translation={lit}
      {book}
      chapter={1}
      scope="book"
      anchor={rv.anchor}
      onClose={() => (verses = null)}
      onOpen={openVerse}
    />
  {/if}
</div>

<style>
  .word-cloud-view {
    position: fixed;
    inset: 0;
    z-index: 10030;
    display: flex;
    flex-direction: column;
    background: var(--wc-bg);
    color: var(--wc-ink);
    --wc-line: rgba(255, 255, 255, 0.14);
    --wc-raise: rgba(255, 255, 255, 0.07);
  }

  .word-cloud-view.light {
    --wc-line: rgba(0, 0, 0, 0.14);
    --wc-raise: rgba(0, 0, 0, 0.05);
  }

  .wc-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: calc(6px * var(--bar-scale, 1));
    min-height: calc(44px * var(--bar-scale, 1));
    padding: env(safe-area-inset-top, 0px) calc(4px * var(--bar-scale, 1)) 0 calc(12px * var(--bar-scale, 1));
    font-size: calc(13px * var(--bar-scale, 1));
    border-bottom: 1px solid var(--wc-line);
    box-sizing: border-box;
  }

  .wc-title {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    overflow: hidden;
    white-space: nowrap;
  }

  .wc-book {
    font-weight: 700;
    font-size: 1.2em;
  }

  .wc-sub {
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wc-ground {
    flex: none;
    display: flex;
    border: 1px solid var(--wc-line);
    border-radius: 999px;
    overflow: hidden;
  }

  .wc-ground button {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    padding: calc(4px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    cursor: pointer;
    opacity: 0.65;
  }

  .wc-ground button.on {
    background: var(--wc-raise);
    opacity: 1;
    font-weight: 600;
  }

  .wc-btn {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: calc(34px * var(--bar-scale, 1));
    height: calc(34px * var(--bar-scale, 1));
    background: none;
    border: 0;
    border-radius: 8px;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
  }

  .wc-btn:hover {
    background: var(--wc-raise);
  }

  .wc-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }

  .wc-stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .wc-wait {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    text-align: center;
    font-size: 14px;
    opacity: 0.75;
    pointer-events: none;
  }

  /* Under the bar, so the verse list can hang below it. */
  .wc-card {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100% - 24px));
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--wc-bg);
    border: 1px solid var(--wc-line);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  }

  .wc-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    font-size: 15px;
  }

  .wc-word {
    font-weight: 700;
    font-size: 17px;
  }

  .wc-count {
    opacity: 0.8;
  }

  .wc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .wc-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid var(--wc-line);
    background: var(--wc-raise);
    color: inherit;
    font: inherit;
    font-size: 13.5px;
    cursor: pointer;
  }

  .wc-action:hover {
    border-color: currentColor;
  }
</style>
