<script context="module" lang="ts">
  /**
   * What every strip on the page shares: whether the pack is installed, the
   * setting, and a redraw signal for theme changes. One check, one observer and
   * one listener for however many chapters the reader has rendered.
   */
  import { writable, type Writable } from 'svelte/store';
  import { getSettings } from '../adapters/settings';
  import { connectionsInstalled, type ConnectionsData } from '../lib/connections/data';
  import { chapterReach, STRIP, type ChapterReach } from '../lib/connections/strip';

  /** null until the first check comes back. */
  const installed: Writable<boolean | null> = writable(null);
  const enabled = writable(true);
  /** Bumped when the theme changes, so every strip redraws in the new colors. */
  const themeTick = writable(0);

  let watching = false;
  function watch() {
    if (watching || typeof window === 'undefined') return;
    watching = true;
    const check = () => void connectionsInstalled().then((yes) => installed.set(yes));
    check();
    enabled.set(getSettings().connectionsStrip !== false);
    window.addEventListener('packsUpdated', check);
    window.addEventListener('settingsUpdated', () => {
      enabled.set(getSettings().connectionsStrip !== false);
      themeTick.update((n) => n + 1);
    });
    new MutationObserver(() => themeTick.update((n) => n + 1)).observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  /** Each chapter's links, worked out once per loaded data. */
  const reaches = new WeakMap<ConnectionsData, Map<number, ChapterReach>>();
  function reachOf(data: ConnectionsData, span: { start: number; end: number }): ChapterReach {
    let held = reaches.get(data);
    if (!held) reaches.set(data, (held = new Map()));
    let reach = held.get(span.start);
    if (!reach) {
      reach = chapterReach(data, span, STRIP.voteFloor, STRIP.maxArcs);
      held.set(span.start, reach);
    }
    return reach;
  }
</script>

<script lang="ts">
  /**
   * The reader strip: a thin line of the whole Bible under a chapter's title,
   * with an arc from this chapter to everywhere it reaches (roadmap
   * Connections, Phase 8). The drawing is lib/connections/strip.ts.
   *
   * Shown only when the Connections pack is installed and the "Connections
   * strip" setting is on. A missing pack is never a get-packs card here: the
   * reader is for reading, and the strip is an extra.
   *
   * In light and sepia the reader is drawn inverted by the theme's filter, so
   * the canvas cancels it, as .emoji does, and paints in the theme's real
   * colors from palette(). The book colors then come out right in every theme.
   */
  import { onMount, onDestroy } from 'svelte';
  import { chapterSpan, holdConnections, loadConnections } from '../lib/connections/data';
  import { drawStrip } from '../lib/connections/strip';
  import { palette } from '../lib/connections/palette';

  export let book: string;
  export let chapter: number;

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let data: ConnectionsData | null = null;
  /** Off screen, nothing is worked out; the reader may have many chapters up. */
  let near = false;
  let width = 0;

  let letGo: (() => void) | null = null;

  $: show = $installed === true && $enabled;
  $: if (show) start();
  $: if (!show) stop();

  function start() {
    if (letGo) return;
    letGo = holdConnections();
    loadConnections()
      .then((d) => {
        if (letGo) data = d;
      })
      .catch(() => {
        data = null;
      });
  }

  function stop() {
    letGo?.();
    letGo = null;
    data = null;
  }

  $: span = chapterSpan(book, chapter);
  $: if (canvas && data && span && near && width > 0) paint(data, span, width, $themeTick);

  function paint(d: ConnectionsData, s: { start: number; end: number }, w: number, _tick: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const h = STRIP.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawStrip(ctx, d, reachOf(d, s), STRIP, { width: w, height: h }, { palette: palette(), background: false });
  }

  let sizeObserver: ResizeObserver | null = null;
  let viewObserver: IntersectionObserver | null = null;
  /** The box is rebuilt when the setting goes off and on, so it is watched afresh. */
  let observed: HTMLDivElement | null = null;
  $: if (host !== observed) {
    sizeObserver?.disconnect();
    viewObserver?.disconnect();
    observed = host ?? null;
    if (observed) {
      const el = observed;
      sizeObserver = new ResizeObserver(() => (width = el.clientWidth));
      sizeObserver.observe(el);
      viewObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) near = true;
        },
        { rootMargin: '600px 0px' },
      );
      viewObserver.observe(el);
    }
  }

  onMount(watch);

  onDestroy(() => {
    sizeObserver?.disconnect();
    viewObserver?.disconnect();
    stop();
  });
</script>

{#if show && span}
  <div class="connections-strip" bind:this={host} style="height:{STRIP.height}px">
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
  </div>
{/if}

<style>
  .connections-strip {
    width: 100%;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* The theme's invert would turn the book colors into their opposites. */
  :global(body.light-theme .themed) canvas,
  :global(body.sepia-theme .themed) canvas {
    filter: invert(1) hue-rotate(180deg);
  }
</style>
