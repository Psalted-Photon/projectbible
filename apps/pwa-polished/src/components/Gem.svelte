<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { stoneById, stoneForTribe, type Stone } from '../lib/gems/stones';
  import type { GemView } from '../lib/gems/view';

  /** Pick the stone by tribe name, e.g. "Judah"… */
  export let tribe: string | undefined = undefined;
  /** …or by stone id, e.g. "nophek". */
  export let stone: string | undefined = undefined;
  /** Width and height in px. */
  export let size = 160;
  export let interactive = true;
  export let tilt = true;
  /** Dark stage behind the stone. Off to sit it on your own background. */
  export let stage = true;
  /** Called on a quick press that barely moves. A longer or moving press is a
   *  drag and only turns the stone, so the two never fight over one touch. */
  export let onTap: (() => void) | null = null;

  let canvas: HTMLCanvasElement;
  let view: GemView | null = null;
  // Swatch until the renderer arrives, and for good if WebGL won't start.
  let fallback = true;
  let destroyed = false;

  $: current = (stone ? stoneById(stone) : tribe ? stoneForTribe(tribe) : undefined) as Stone | undefined;
  $: if (view && current) view.setStone(current);

  // Tap vs flick. Measured on the wrapper, which the canvas's pointer events
  // bubble up to, so the renderer's own drag handling is left as it is.
  const TAP_SLOP_PX = 8;
  const TAP_MS = 350;
  let press: { id: number; x: number; y: number; t: number; far: boolean } | null = null;

  function onDown(e: PointerEvent) {
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), far: false };
  }
  function onMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) press.far = true;
  }
  function onUp(e: PointerEvent) {
    if (!onTap || !press || e.pointerId !== press.id) return;
    const tapped = !press.far && performance.now() - press.t < TAP_MS;
    press = null;
    if (tapped) onTap?.();
  }
  function onKey(e: KeyboardEvent) {
    if (!onTap) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onTap?.();
  }

  onMount(async () => {
    // three.js loads here, on first use, so it stays out of the main bundle.
    const { createGemView } = await import('../lib/gems/view');
    if (destroyed || !current) return;
    view = createGemView(canvas, current, { interactive, tilt });
    fallback = !view;
  });

  onDestroy(() => {
    destroyed = true;
    view?.destroy();
  });
</script>

{#if current}
  <!-- The role is button whenever it takes a tab stop; the check can't see
       through the ternary. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="gem"
    class:stage
    class:tappable={!!onTap}
    style="width:{size}px;height:{size}px;--sw:{current.sw}"
    role={onTap ? 'button' : 'img'}
    tabindex={onTap ? 0 : undefined}
    aria-label="{current.tr} ({current.kjv}), shown as {current.as}"
    on:pointerdown={onDown}
    on:pointermove={onMove}
    on:pointerup={onUp}
    on:pointercancel={() => (press = null)}
    on:keydown={onKey}
  >
    <canvas bind:this={canvas} class:hidden={fallback}></canvas>
    {#if fallback}<span class="swatch"></span>{/if}
  </div>
{/if}

<style>
  .gem {
    position: relative;
    display: inline-block;
    border-radius: 14px;
    overflow: hidden;
    flex: 0 0 auto;
  }
  .gem.tappable {
    cursor: pointer;
  }
  .gem.tappable:focus-visible {
    outline: 2px solid var(--sw);
    outline-offset: 2px;
  }
  /* The backdrop the stones were tuned against in gem-lab.html. */
  .gem.stage {
    background: radial-gradient(ellipse 70% 60% at 50% 42%, #1d2b4f 0%, #0a1024 70%, #050814 100%);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  canvas.hidden {
    visibility: hidden;
  }
  .swatch {
    position: absolute;
    inset: 32%;
    border-radius: 22%;
    background: var(--sw);
    box-shadow: inset 0 -6px 10px rgba(0, 0, 0, 0.28), inset 0 4px 6px rgba(255, 255, 255, 0.35);
  }
</style>
