<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { backOut, cubicOut } from 'svelte/easing';
  import BookOpenText from 'phosphor-svelte/lib/BookOpenText';
  import MapPin from 'phosphor-svelte/lib/MapPin';
  import Highlighter from 'phosphor-svelte/lib/Highlighter';
  import NotePencil from 'phosphor-svelte/lib/NotePencil';
  import Repeat from 'phosphor-svelte/lib/Repeat';
  import ArrowsOutLineHorizontal from 'phosphor-svelte/lib/ArrowsOutLineHorizontal';
  import User from 'phosphor-svelte/lib/User';
  import Article from 'phosphor-svelte/lib/Article';
  import {
    BADGE,
    ringRadius,
    outerRadius,
    seatAngles,
    seatOffset,
    radialItems,
  } from '../lib/radialMenu';

  /** Viewport centre of the ring — the middle of the tapped word. */
  export let cx = 0;
  export let cy = 0;
  /** The word's line box. Drives the ring's size, so the gap tracks font size. */
  export let lineHeight = 32;

  export let selectedText = '';
  /** Clicked word resolves to an ISBE place — shows the "Map" button. */
  export let isPlace = false;
  /** Clicked word resolves to a biblical character — button reads "Bio". */
  export let isPerson = false;
  /** Clicked word resolves to an ISBE entry/place — button reads "Info". */
  export let moreInfo = false;
  export let mode: 'word' | 'verse' = 'word';
  /** How many words the selection covers. Drives which buttons make sense. */
  export let wordCount = 1;
  /** True while the next tap is armed to stretch the selection. */
  export let extendArmed = false;
  /**
   * Carried for parity with SelectionToast. The radial menu derives its own size
   * so the caller places it synchronously and this is already true on open —
   * which matters, because a hidden first frame would eat the opening sweep.
   */
  export let placed = true;

  let rootEl: HTMLElement;

  /** Matches SelectionToast's measurement API. */
  export function rect(): DOMRect | null {
    return rootEl?.getBoundingClientRect() ?? null;
  }

  const dispatch = createEventDispatcher();

  const ICONS: Record<string, typeof BookOpenText> = {
    define: BookOpenText,
    info: Article,
    person: User,
    map: MapPin,
    highlight: Highlighter,
    notes: NotePencil,
    repeats: Repeat,
    extend: ArrowsOutLineHorizontal,
  };

  $: items = radialItems({ mode, wordCount, isPlace, isPerson, moreInfo, extendArmed });
  $: radius = ringRadius(lineHeight, items.length);
  $: outer = outerRadius(lineHeight, items.length);
  $: seats = seatAngles(items.length).map((a) => seatOffset(a, radius));

  // The sweep runs in list order, which seatAngles already returns as one
  // continuous counter-clockwise path from the right gap round to the right gap.
  const STAGGER = 20;
  const POP_MS = 160;

  const reduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  /**
   * A button arriving at its seat: thrown outward from two-thirds of the way in,
   * scaling up as it lands. Written as a transition rather than a CSS animation
   * so the reverse sweep actually plays when the menu is removed.
   */
  function pop(
    delay: number,
    duration: number,
    { inert = false }: { inert?: boolean } = {},
  ) {
    // `inert` is for the outro: a closing ring must not eat a tap aimed at the
    // one opening behind it, and tapping a new word does exactly that.
    const dead = inert ? 'pointer-events: none;' : '';
    if (reduceMotion) {
      return { duration: 120, easing: cubicOut, css: (t: number) => `opacity: ${t};${dead}` };
    }
    return {
      delay,
      duration,
      easing: backOut,
      css: (t: number) => {
        const reach = 0.65 + 0.35 * t;
        return (
          `transform: translate(-50%, -50%)` +
          ` translate(calc(var(--dx) * ${reach}), calc(var(--dy) * ${reach}))` +
          ` scale(${0.3 + 0.7 * t});` +
          `opacity: ${Math.min(1, t)};${dead}`
        );
      },
    };
  }

  const seatIn = (_n: Element, { i }: { i: number }) =>
    pop(reduceMotion ? 0 : i * STAGGER, POP_MS);

  // Closing runs the same path in reverse, and quicker.
  const seatOut = (_n: Element, { i }: { i: number }) =>
    pop(reduceMotion ? 0 : (items.length - 1 - i) * (STAGGER * 0.5), POP_MS * 0.75, {
      inert: true,
    });

  function activate(item: { kind: string; id: string }) {
    if (item.kind === 'mode') dispatch('modeChange', item.id);
    else dispatch('action', { action: item.id, text: selectedText });
  }
</script>

<!--
  One `.toast` root, because four closest(".toast") hit-tests in BibleReader
  depend on it. It is pointer-events:none so taps in the hole and through the two
  gaps fall through to the scrim underneath and dismiss, as they should — only
  the buttons themselves take a press.
-->
<div
  class="toast radial"
  class:measuring={!placed}
  bind:this={rootEl}
  style="left: {cx - outer}px; top: {cy - outer}px; width: {outer * 2}px; height: {outer * 2}px; --badge: {BADGE}px;"
>
  {#each items as item, i (item.id)}
    <button
      class="seat"
      class:mode-seat={item.kind === 'mode'}
      class:active={item.kind === 'mode' && item.id === mode}
      style="--dx: {seats[i]?.dx ?? 0}px; --dy: {seats[i]?.dy ?? 0}px; --accent: {item.accent ?? '#3a3a3a'};"
      in:seatIn={{ i }}
      out:seatOut={{ i }}
      on:click={() => activate(item)}
    >
      {#if item.icon}
        <span class="badge">
          <svelte:component this={ICONS[item.icon]} size={22} weight="bold" />
          <span class="icon-overlay">
            <svelte:component this={ICONS[item.icon]} size={22} weight="thin" />
          </span>
        </span>
      {/if}
      <span class="seat-label">{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .toast {
    position: fixed;
    z-index: 10000;
    /* The ring is mostly hole. Only the buttons may take a press. */
    pointer-events: none;
  }

  /* visibility, not display: we still need a real layout box to measure. */
  .toast.measuring {
    visibility: hidden;
  }

  .seat {
    position: absolute;
    left: 50%;
    top: 50%;
    /* --badge comes from radialMenu.ts, which the ring's radius is solved for. */
    width: var(--badge);
    height: var(--badge);
    transform: translate(-50%, -50%) translate(var(--dx), var(--dy));
    pointer-events: auto;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;

    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(26, 26, 26, 0.96);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    color: #e0e0e0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    /* When a button resolves in late — Map, once the place lookup lands — every
       seat shifts round the arc. Glide rather than jump. Harmless during the
       opening sweep, which runs as a keyframe animation, not a transition. */
    transition: transform 0.16s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .seat:active {
    transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) scale(0.94);
  }

  /* The Word/Verse pair reads as a mode switch, not another action: no splash,
     no icon, and it lights up when it is the mode you are already in. */
  .mode-seat {
    width: calc(var(--badge) - 6px);
    height: calc(var(--badge) - 6px);
    background: rgba(26, 26, 26, 0.96);
    border: 1px solid #3a3a3a;
    font-size: 11px;
    color: #888;
  }

  .mode-seat.active {
    background: #667eea;
    border-color: #667eea;
    color: #fff;
  }

  /* The app's icon-badge idiom: a bold glyph in black with a thin white copy
     stacked over it, on a radial splash. Same recipe as the nav bar. */
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    border-radius: 7px;
    padding: 3px;
    line-height: 0;
    color: #000000;
    background: radial-gradient(circle, var(--accent) 0%, var(--accent) 20%, #000000 100%);
  }

  .icon-overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }

  :global(.toast.radial .badge > svg) {
    filter: drop-shadow(0 0 2px #000000) drop-shadow(0 0 2px #000000);
  }

  .seat-label {
    font-size: 9px;
    line-height: 1.1;
    letter-spacing: 0.01em;
    max-width: 52px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
