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

  let canvas: HTMLCanvasElement;
  let view: GemView | null = null;
  // Swatch until the renderer arrives, and for good if WebGL won't start.
  let fallback = true;
  let destroyed = false;

  $: current = (stone ? stoneById(stone) : tribe ? stoneForTribe(tribe) : undefined) as Stone | undefined;
  $: if (view && current) view.setStone(current);

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
  <div
    class="gem"
    class:stage
    style="width:{size}px;height:{size}px;--sw:{current.sw}"
    role="img"
    aria-label="{current.tr} ({current.kjv}), shown as {current.as}"
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
