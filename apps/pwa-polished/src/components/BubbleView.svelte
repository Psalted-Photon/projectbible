<script lang="ts">
  /**
   * The Bubbles: every book of the Bible as a circle sized by its length and
   * colored by its group, splitting into chapters and then verses as you zoom
   * in, with each book's word cloud inside it while zoomed out. Every English
   * Repeat lights the verses holding it in its Repeats color, fades the books
   * without it, and is counted under each book's name.
   *
   * Full screen under the main reader's navbar, so the Repeat tabs and their
   * menus work over it (BibleReader mounts it and keeps the bar shown). Closes
   * by × and Escape only. Opened and left through stores/bubbleViewStore.ts.
   *
   * The map comes from the NET for everyone (lib/bookPicture/bubbleData.ts);
   * lit words are found in the translation being read, or the NET under
   * Greek and Hebrew, by the search's word lists. The drawing and the touch
   * handling are shared with the book picture lab (bubbleScene.ts).
   *
   * In light and sepia the reader is drawn inverted by the theme's filter, so
   * the picture cancels it, as the Connections strip does, and paints in its
   * own Light or Dark. The bar and the verse card follow the theme.
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { Minus, Plus } from 'phosphor-svelte';
  import CloseX from './CloseX.svelte';
  import VerseRefRow from './VerseRefRow.svelte';
  import { repeatsStore, type RepeatGroup } from '../stores/repeatsStore';
  import { navigationStore } from '../stores/navigationStore';
  import {
    bubbleTranslation,
    bubbleView,
    closeBubbles,
    goFromBubbles,
    registerBubbleView,
    showOnBubbles,
    type BubbleCard,
  } from '../stores/bubbleViewStore';
  import { showNotice } from '../stores/noticeStore';
  import { REPEAT_COLORS } from '../lib/repeatColors';
  import { FILLER_WORDS } from '../lib/fillerWords';
  import { getBookColor, normalizeBookName, outlineColorFor } from '../lib/bibleData';
  import { schemeOf, convertRef } from '../lib/versification';
  import { versesWithWord } from '../lib/search/searchClient';
  import { BUBBLE_WORLD, loadBubbleData, verseIndex, type BubbleData } from '../lib/bookPicture/bubbleData';
  import { bubbleZoomLimits, type BookBubble } from '../lib/bookPicture/bubbles';
  import {
    ZoomView,
    bookZoomK,
    chapterZoomK,
    drawBubbles,
    hitBubbles,
    queueBubbleClouds,
    type BubbleGlow,
    type BubbleLook,
  } from '../lib/bookPicture/bubbleScene';
  import { GROUNDS, bubbleGround, setBubbleGround, type BubbleGround } from '../lib/bookPicture/ground';
  import type { Cloud } from '../lib/bookPicture/cloud';

  /** Where the navbar ends, in px from the top of the reader. */
  export let top = 0;

  const FONT = { family: '"Gentium Plus", Georgia, serif', weight: 400 };

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let view: ZoomView | null = null;
  let data: BubbleData | null = null;
  let bubbleOf = new Map<string, BookBubble>();
  let failed = false;
  let ground: BubbleGround = bubbleGround();
  const clouds = new Map<string, Cloud>();
  let stopClouds: () => void = () => {};
  let card: BubbleCard | null = get(bubbleView).card;

  // ── Lit words ─────────────────────────────────────────────────────────────

  let glows: BubbleGlow[] = [];
  /** The words lit right now, as Repeats keeps them, with their colors. */
  let lit: RepeatGroup[] = [];
  let finding = false;
  let note = '';

  $: litIn = bubbleTranslation($navigationStore.translation);
  $: if (data) void light(data, $repeatsStore, litIn);

  /** A Repeat color's bright form (its in-text border without the see-through). */
  function brightOf(colorIndex: number): string {
    const m = REPEAT_COLORS[colorIndex]?.border.match(/\d+/g);
    if (!m) return REPEAT_COLORS[colorIndex]?.pill ?? '#ffffff';
    return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }

  /** Each word's verses as the map numbers them, by book; null when the word lists could not say. */
  const found = new Map<string, Promise<Map<string, Int32Array> | null>>();

  function versesFor(d: BubbleData, translation: string, word: string): Promise<Map<string, Int32Array> | null> {
    const key = `${translation.toLowerCase()}|${word}`;
    let p = found.get(key);
    if (!p) {
      p = versesWithWord(translation, word).then((res) => {
        if (!res) return null;
        // The map is in English numbering; a text that numbers differently is put into it.
        const convert = schemeOf(res.translation) !== 'english';
        const perBook = new Map<string, Int32Array>();
        for (const [book, refs] of res.books) {
          const bv = d.byBook.get(normalizeBookName(book));
          if (!bv) continue;
          const at: number[] = [];
          for (const ref of refs) {
            let chapter = Math.floor(ref / 1000), verse = ref % 1000;
            if (convert) {
              const m = convertRef(res.translation, 'net', { book: bv.book, chapter, verse })[0];
              if (!m) continue;
              chapter = m.chapter;
              verse = m.verse;
            }
            const v = verseIndex(bv, chapter, verse);
            if (v >= 0) at.push(v);
          }
          if (!at.length) continue;
          const sorted = Int32Array.from(new Set(at)).sort();
          perBook.set(bv.book, sorted);
        }
        return perBook;
      });
      found.set(key, p);
      // A miss is asked again next time; the word lists may just not be built yet.
      void p.then((r) => {
        if (!r && found.get(key) === p) found.delete(key);
      });
    }
    return p;
  }

  let lightRun = 0;

  async function light(d: BubbleData, groups: RepeatGroup[], translation: string): Promise<void> {
    const run = ++lightRun;
    // Greek and Hebrew Repeats keep their tab but don't light the map yet;
    // filler words would light nearly every verse.
    const english = groups.filter((g) => !g.strongs);
    const wanted = english.filter((g) => !FILLER_WORDS.has(g.word));
    finding = wanted.some((g) => !found.has(`${translation.toLowerCase()}|${g.word}`));
    const lists = await Promise.all(wanted.map((g) => versesFor(d, translation, g.word)));
    if (run !== lightRun) return;
    finding = false;
    lit = wanted;
    glows = wanted.map((g, i) => ({
      color: brightOf(g.colorIndex),
      deep: REPEAT_COLORS[g.colorIndex]?.pill,
      perBook: lists[i] ?? new Map(),
    }));
    const notes: string[] = [];
    const missing = wanted.filter((_, i) => !lists[i]);
    if (missing.length) notes.push(`Couldn’t look up ${missing.map((g) => `‘${g.label}’`).join(', ')} yet. Try again in a moment.`);
    const filler = english.filter((g) => FILLER_WORDS.has(g.word));
    if (filler.length) notes.push(`${filler.map((g) => `‘${g.label}’`).join(', ')}: too common to light.`);
    if (groups.length > english.length) notes.push('Greek and Hebrew words don’t light the Bubbles yet.');
    note = notes.join(' ');
    draw();
  }

  $: litPattern = lit.length
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])(${lit.map((g) => g.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}'’])`,
        'giu',
      )
    : null;
  $: litColors = lit.length ? Object.fromEntries(lit.map((g) => [g.word, REPEAT_COLORS[g.colorIndex]?.bg ?? ''])) : null;

  // ── Drawing ───────────────────────────────────────────────────────────────

  function look(): BubbleLook {
    return {
      ground: GROUNDS[ground],
      family: FONT.family,
      weight: FONT.weight,
      colorOf: getBookColor,
      ringOf: outlineColorFor,
      verses: (book) => data!.byBook.get(book)!,
      clouds,
      glows,
      here: normalizeBookName(get(navigationStore).book),
    };
  }

  function draw(): void {
    if (!view || !data || !canvas) return;
    const c = canvas.getContext('2d');
    if (!c) return;
    drawBubbles(c, data.map, look(), canvas.width, canvas.height, view.k, view.tx, view.ty, view.dpr);
  }

  function setGround(g: BubbleGround): void {
    if (g === ground) return;
    ground = g;
    setBubbleGround(g);
    draw();
  }

  function zoomBy(f: number): void {
    view?.animateZoomAt(view.cssW / 2, view.cssH / 2, f);
  }

  // ── Adding words ──────────────────────────────────────────────────────────

  let typed = '';

  /** "Add a word": it becomes a new Repeat tab, lit here with the rest. */
  function addWord(): void {
    const word = typed.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word) return;
    if (/\s/.test(word)) {
      showNotice('One word at a time: Repeats light single words.', 'info');
      return;
    }
    if (showOnBubbles(word, { translation: litIn })) typed = '';
  }

  function onAddKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      addWord();
      (e.currentTarget as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      typed = '';
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  // ── Taps ──────────────────────────────────────────────────────────────────

  function tap(x: number, y: number): void {
    if (!data || !view) return;
    const hit = hitBubbles(data.map, look(), view.k, view.tx, view.ty, x, y);
    if (!hit) {
      card = null;
      return;
    }
    const b = bubbleOf.get(hit.book);
    if (hit.kind === 'verse') {
      const ref = data.byBook.get(hit.book)?.verseRef[hit.v];
      if (ref) card = { book: hit.book, chapter: Math.floor(ref / 1000), verse: ref % 1000 };
      return;
    }
    card = null;
    if (hit.kind === 'cloud') {
      // A word in a book's cloud lights up like an added one.
      const w = data.clouds.get(hit.book)?.[hit.word];
      if (w) showOnBubbles(w.text, { translation: litIn });
      return;
    }
    if (!b) return;
    if (hit.kind === 'chapter') {
      const ch = b.chapters[hit.ci];
      view.animateCenter(ch.x, ch.y, chapterZoomK(ch, view.cssW, view.cssH));
      return;
    }
    // A book: in to its chapters.
    view.animateCenter(b.x, b.y, bookZoomK(b, view.cssW, view.cssH));
  }

  function openCard(c: BubbleCard): void {
    goFromBubbles(c.book, c.chapter, c.verse, 'net');
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const t = e.target as HTMLElement | null;
    // Escape in a text box is the box's own.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    closeBubbles();
  }

  function onSettings(): void {
    const g = bubbleGround();
    if (g !== ground) {
      ground = g;
      draw();
    }
  }

  function fitStage(): void {
    if (!view || !stage) return;
    const r = stage.getBoundingClientRect();
    view.resize(r.width, r.height);
  }

  onMount(() => {
    const v = new ZoomView(canvas, {
      world: () => ({ w: BUBBLE_WORLD, h: BUBBLE_WORLD }),
      limits: (kf) => (data ? bubbleZoomLimits(data.map, kf) : [kf * 0.5, kf * 8]),
      draw: () => draw(),
      tap,
    });
    view = v;
    fitStage();
    const ro = new ResizeObserver(fitStage);
    ro.observe(stage);

    loadBubbleData()
      .then((d) => {
        if (view !== v) return;
        data = d;
        bubbleOf = new Map(d.map.books.map((b) => [b.book, b]));
        const spot = get(bubbleView).spot;
        if (spot) v.goTo(spot);
        else v.fitView();
        v.clampView();
        draw();
        stopClouds = queueBubbleClouds(
          d.books.map((b) => b.book),
          (book) => d.clouds.get(book) ?? [],
          FONT,
          clouds,
          () => v.requestFrame(),
        );
      })
      .catch((error) => {
        console.error('[Bubbles] could not load the map:', error);
        failed = true;
      });

    const unregister = registerBubbleView(() => ({ spot: view && data ? view.spot() : null, card }));
    window.addEventListener('keydown', onKey);
    window.addEventListener('settingsUpdated', onSettings);
    return () => {
      unregister();
      ro.disconnect();
      stopClouds();
      v.destroy();
      view = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('settingsUpdated', onSettings);
    };
  });

  // The ring on the book being read moves with the reader.
  $: hereBook = normalizeBookName($navigationStore.book);
  $: if (hereBook) draw();
</script>

<div class="bubble-view" style="top:{top}px">
  <div class="bv-bar">
    <form class="bv-add" on:submit|preventDefault={addWord}>
      <input
        type="text"
        class="bv-add-input"
        placeholder="Add a word"
        aria-label="Add a word to light on the Bubbles"
        enterkeyhint="go"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={typed}
        on:keydown={onAddKey}
      />
    </form>
    <div class="bv-ground" role="group" aria-label="Background">
      <button type="button" class:on={ground === 'light'} aria-pressed={ground === 'light'} on:click={() => setGround('light')}>Light</button>
      <button type="button" class:on={ground === 'dark'} aria-pressed={ground === 'dark'} on:click={() => setGround('dark')}>Dark</button>
    </div>
    <button type="button" class="bv-btn" title="Zoom out" aria-label="Zoom out" on:click={() => zoomBy(0.5)}>
      <Minus size="1.15em" weight="bold" />
    </button>
    <button type="button" class="bv-btn" title="Zoom in" aria-label="Zoom in" on:click={() => zoomBy(2)}>
      <Plus size="1.15em" weight="bold" />
    </button>
    <CloseX label="Close the Bubbles" on:click={closeBubbles} />
  </div>
  <div class="bv-body">
    <div class="bv-stage" bind:this={stage} style="background:{GROUNDS[ground].bg};color:{GROUNDS[ground].neutral}">
      <canvas bind:this={canvas} aria-label="Every book of the Bible as a bubble"></canvas>
      <div class="bv-note-line">
        {#if finding}
          Finding verses…
        {:else if note}
          {note}
        {:else if lit.length}
          Verses in the {litIn.toUpperCase()}
        {:else}
          Tap a book to zoom in, or a word in its cloud to light it
        {/if}
      </div>
      {#if failed}
        <div class="bv-wait">The Bubbles couldn’t load. Close and try again.</div>
      {:else if !data}
        <div class="bv-wait">Loading the Bubbles…</div>
      {/if}
    </div>
    {#if card}
      {@const c = card}
      <div class="bv-card">
        <div class="bv-card-row">
          <VerseRefRow
            book={c.book}
            chapter={c.chapter}
            verse={c.verse}
            translation={litIn}
            highlight={litPattern}
            markColors={litColors}
            full
            onOpen={() => openCard(c)}
          />
        </div>
        <CloseX label="Close the verse" on:click={() => (card = null)} />
      </div>
    {/if}
  </div>
</div>

<style>
  .bubble-view {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    /* Under the navbar (1000), over the reader's text. */
    z-index: 999;
    display: flex;
    flex-direction: column;
    background: var(--reader-bg, #1a1a1a);
    color: var(--reader-text, #e0e0e0);
  }

  .bv-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: calc(6px * var(--bar-scale, 1));
    min-height: calc(40px * var(--bar-scale, 1));
    padding: 0 calc(4px * var(--bar-scale, 1)) 0 calc(10px * var(--bar-scale, 1));
    font-size: calc(13px * var(--bar-scale, 1));
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
  }

  .bv-add {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    margin: 0;
  }

  .bv-add-input {
    width: 100%;
    min-width: 0;
    max-width: 260px;
    box-sizing: border-box;
    height: calc(30px * var(--bar-scale, 1));
    padding: 0 calc(10px * var(--bar-scale, 1));
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font: inherit;
    /* 16px keeps a phone from zooming the page when the box is tapped. */
    font-size: max(16px, 1em);
  }

  .bv-add-input::placeholder {
    color: inherit;
    opacity: 0.55;
  }

  .bv-add-input:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.4);
  }

  .bv-note-line {
    position: absolute;
    top: 8px;
    left: 12px;
    right: 12px;
    font-size: 12.5px;
    line-height: 1.35;
    opacity: 0.75;
    pointer-events: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bv-ground {
    flex: none;
    display: flex;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    overflow: hidden;
  }

  .bv-ground button {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    padding: calc(4px * var(--bar-scale, 1)) calc(10px * var(--bar-scale, 1));
    cursor: pointer;
    opacity: 0.65;
  }

  .bv-ground button.on {
    background: rgba(255, 255, 255, 0.14);
    opacity: 1;
    font-weight: 600;
  }

  .bv-btn {
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

  .bv-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .bv-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }

  .bv-stage {
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

  /* The theme's invert would turn the picture's colors into their opposites. */
  :global(body.light-theme .themed) .bv-stage,
  :global(body.sepia-theme .themed) .bv-stage {
    filter: invert(1) hue-rotate(180deg);
  }

  .bv-wait {
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

  .bv-card {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    width: min(560px, calc(100% - 24px));
    max-height: 45%;
    overflow-y: auto;
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 8px 4px 8px 8px;
    box-sizing: border-box;
    border-radius: 12px;
    background: var(--reader-bg, #1a1a1a);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  }

  .bv-card-row {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
