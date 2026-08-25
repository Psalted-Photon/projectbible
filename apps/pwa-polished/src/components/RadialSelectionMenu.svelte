<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { backOut, cubicOut } from 'svelte/easing';
  import BookOpenText from 'phosphor-svelte/lib/BookOpenText';
  import MapPin from 'phosphor-svelte/lib/MapPin';
  import Highlighter from 'phosphor-svelte/lib/Highlighter';
  import NotePencil from 'phosphor-svelte/lib/NotePencil';
  import Repeat from 'phosphor-svelte/lib/Repeat';
  import ArrowsOutLineHorizontal from 'phosphor-svelte/lib/ArrowsOutLineHorizontal';
  import User from 'phosphor-svelte/lib/User';
  import Article from 'phosphor-svelte/lib/Article';
  import SpeakerHigh from 'phosphor-svelte/lib/SpeakerHigh';
  import {
    BADGE,
    ringRadius,
    outerRadius,
    seatAngles,
    seatOffset,
    radialItems,
    type RadialItem,
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
  /** Greek/Hebrew selection Read Aloud can pronounce. */
  export let canSpeak = false;
  /**
   * Accepted for parity with SelectionToast, and deliberately unused. That
   * component hides itself for a frame while the caller measures it; the ring
   * derives its own size and is placed synchronously, so it has nothing to wait
   * for — and a hidden first frame would swallow the start of the sweep.
   */
  export let placed = true;
  void placed;

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
    speak: SpeakerHigh,
  };

  // The sweep runs in list order, which seatAngles already returns as one
  // continuous counter-clockwise path from the right gap round to the right gap.
  //
  // What makes the sweep readable is the ratio, not the total: POP_MS ~4.5x
  // STAGGER keeps five of seven buttons in flight at the peak. Shrink STAGGER on
  // its own and the overlap climbs until every button moves at once, which reads
  // as a single pop rather than a sweep — so move the two together.
  const STAGGER = 25;
  const POP_MS = 120;

  const reduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  // --- What the ring is showing -------------------------------------------
  //
  // The person/ISBE lookups resolve within milliseconds of opening, and adding
  // the Map button shifts every seat after it round the arc — mid-entrance.
  // So a change that moves seats waits for the sweep to finish; a change that
  // only rewrites labels (Define → Bio → Info) is adopted straight away,
  // because nothing has to move for it.
  $: live = radialItems({ mode, wordCount, isPlace, isPerson, moreInfo, extendArmed, canSpeak });

  let shown: RadialItem[] = [];
  let settled = reduceMotion;

  // `live !== shown` matters: radialItems returns a fresh array each time, and
  // without it this statement would re-trigger on its own assignment forever.
  $: if (shown.length === 0 || settled || live.length === shown.length) {
    if (live !== shown) shown = live;
  }

  $: radius = ringRadius(lineHeight, shown.length);
  $: outer = outerRadius(lineHeight, shown.length);
  $: seats = seatAngles(shown.length).map((a) => seatOffset(a, radius));

  onMount(() => {
    if (settled) return;
    const timer = setTimeout(
      () => { settled = true; },
      (shown.length - 1) * STAGGER + POP_MS,
    );
    return () => clearTimeout(timer);
  });

  /**
   * A button arriving at its seat: thrown outward from two-thirds of the way in,
   * scaling up as it lands. Written as a transition rather than a CSS animation
   * so the reverse sweep actually plays when the menu is removed.
   *
   * The offsets are baked in as literal pixels rather than read from the --dx /
   * --dy custom properties the static transform uses. Svelte 5 feeds this string
   * straight to element.animate(), and a keyframe value the engine cannot parse
   * is dropped in silence — var() inside a script-supplied keyframe is not
   * reliably substituted, and losing `transform` leaves a button fading in where
   * it lands instead of flying to it. Svelte's own `fly` resolves to px for the
   * same reason.
   */
  function pop(
    dx: number,
    dy: number,
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
          ` translate(${(dx * reach).toFixed(2)}px, ${(dy * reach).toFixed(2)}px)` +
          ` scale(${(0.3 + 0.7 * t).toFixed(3)});` +
          `opacity: ${Math.min(1, t).toFixed(3)};${dead}`
        );
      },
    };
  }

  const seatIn = (_n: Element, { i }: { i: number }) =>
    pop(seats[i]?.dx ?? 0, seats[i]?.dy ?? 0, reduceMotion ? 0 : i * STAGGER, POP_MS);

  // Closing runs the same path in reverse, and quicker — a dismissed ring has to
  // be gone before the next one has finished arriving.
  //
  // The delay is clamped because it is worked out from the *new* length against
  // the departing seat's *old* index, so a seat leaving from beyond the end of
  // the new ring produces a negative one. A negative duration is rejected by
  // element.animate outright, and that throw escapes mid-flush and leaves the
  // scheduler unable to queue anything further — the whole app stops redrawing
  // until a reload. It was unreachable while the trailing seat was always Verse,
  // which never left; the scope toggle can leave, so now it isn't.
  const seatOut = (_n: Element, { i }: { i: number }) =>
    pop(
      seats[i]?.dx ?? 0,
      seats[i]?.dy ?? 0,
      reduceMotion ? 0 : Math.max(0, (shown.length - 1 - i) * (STAGGER * 0.5)),
      POP_MS * 0.55,
      { inert: true },
    );

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
  bind:this={rootEl}
  style="left: {cx - outer}px; top: {cy - outer}px; width: {outer * 2}px; height: {outer * 2}px; --badge: {BADGE}px;"
>
  <!--
    |global on both directives is load-bearing, not decoration. Svelte 5 made
    transitions local by default, and a local transition only plays when the
    block it sits in is itself what changed. This {#each} is created along with
    the whole component, by BibleReader's {#if showToast} — so without |global
    the runtime skips the intro (the each block has no EFFECT_RAN yet) and drops
    the outro (pause_children collects nothing), and the ring just appears and
    vanishes. Removing these two modifiers silently kills the animation.
  -->
  {#each shown as item, i (item.id)}
    <button
      class="seat"
      class:mode-seat={item.kind === 'mode'}
      style="--dx: {seats[i]?.dx ?? 0}px; --dy: {seats[i]?.dy ?? 0}px; --accent: {item.accent ?? '#3a3a3a'};"
      in:seatIn|global={{ i }}
      out:seatOut|global={{ i }}
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
  }

  /* When a button resolves in late — Map, once the place lookup lands — every
     seat shifts round the arc. Glide rather than jump.
     Safe to leave on during the entrance: that runs as a Web Animation, and an
     animation outranks a transition on the same property, so the two never
     fight. The seats only move after the sweep has settled in any case. */
  .seat {
    transition: transform 0.14s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .seat:active {
    transform: translate(-50%, -50%) translate(var(--dx), var(--dy)) scale(0.94);
  }

  /* The scope toggle: a word rather than an icon, so it is set apart from the
     actions — but it still has to read as something you can take. It carries no
     "current" state, because its label is where you'd be going rather than where
     you are.

     The colour lives in the word, not behind it. A tinted fill was see-through
     enough to read the verse through, and a coloured disc with an outline was
     the only thing on the ring whose whole circle was visible — which made the
     smallest button look like the biggest. Keeping the same near-solid dark
     circle its neighbours wear leaves the coloured word as the thing you see,
     the way their coloured icon is. Indigo is the accent armed Extend uses. */
  .mode-seat {
    width: calc(var(--badge) - 6px);
    height: calc(var(--badge) - 6px);
    font-weight: 600;
    color: #8fa3f5;
  }

  .mode-seat:hover {
    color: #b9c4fa;
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
