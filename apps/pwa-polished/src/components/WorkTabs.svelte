<script context="module" lang="ts">
  import type { WorkKey as Key } from "../lib/openWork";
  import type { MotionLevel } from "../lib/motion";

  /**
   * A tab switch on its way from the card being left to the one arriving.
   *
   * Every work draws its own row of tabs, so switching works throws this row
   * away and the next work brings a new one. The old row writes down where its
   * underline was gliding and which way the page went, and the new row picks
   * both up as it mounts. `host` is what both cards sit in (the lookup card's
   * frame, or the window), so a second window opening at the same moment can't
   * take a switch that isn't its own.
   */
  type Glide = { from: number; to: number; at: number };
  type Handoff = {
    host: Element | null;
    to: Key;
    dir: number;
    level: MotionLevel;
    glide: Glide | null;
    at: number;
  };
  let handoff: Handoff | null = null;
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { WorksResolution } from "../adapters/lexicon-lookup";
  import { worksInWindow, dictionaryAvailable, type WorkKey } from "../lib/openWork";
  import { EASE_ENTER, EASE_EXIT, EASE_STANDARD, MOTION, motionLevel } from "../lib/motion";

  /**
   * The five reference works, across the top of every lookup card.
   *
   * These replaced a row of "bridge pills" that changed depending on which card
   * you were in — the encyclopedia offered Topical and Dictionary, and stepping
   * into Topical changed the set — so there was never a fixed thing to aim at.
   * All five are always drawn, always in this order, and grayed when that work
   * has nothing for the subject. Equal widths, so a tab is in the same place
   * every time regardless of how long the labels are. Where the full names
   * don't fit, every tab takes its short name together.
   *
   * Availability comes from resolveWorks, which returns the ids rather than
   * booleans — so a tab that is lit is one that will definitely open something.
   */
  export let works: WorksResolution | null = null;
  export let current: WorkKey;
  /** True while the A–Z index is showing, where tabs switch index rather than
   *  subject — there is no subject to cross-reference. */
  export let onIndex = false;
  /** Set when this card is a docked window, which not every work can be. */
  export let inWindow = false;
  export let onSelect: (work: WorkKey) => void;

  const TABS: { key: WorkKey; label: string; short: string }[] = [
    { key: "encyclopedia", label: "Encyclopedia", short: "Encyc." },
    { key: "topical", label: "Topical", short: "Topical" },
    { key: "people", label: "People", short: "People" },
    { key: "dictionary", label: "Dictionary", short: "Dict." },
    { key: "strongs", label: "Strong’s", short: "Strong’s" },
  ];

  function isAvailable(key: WorkKey, w: WorksResolution | null, idx: boolean, win: boolean): boolean {
    // The one you're on is always live: you are demonstrably looking at it,
    // whether or not the resolver has answered yet.
    if (key === current) return true;
    // A pinned window can only hold works that have a window form.
    if (win && !worksInWindow(key)) return false;
    // Browsing an index, the tabs move you between indexes. Every work has one
    // except the dictionary, which has no A–Z list to show, and Strong's, whose
    // list comes in the next step.
    if (idx) return key !== "dictionary" && key !== "strongs";
    switch (key) {
      case "dictionary":
        return dictionaryAvailable(w, win);
      case "strongs":
        return !!w?.strongs;
      case "topical":
        return !!w?.topic;
      case "encyclopedia":
        return !!w?.entry;
      case "people":
        return !!w?.person;
    }
  }

  /** Why a tab is grayed, so hovering it says something useful. */
  function reason(key: WorkKey, win: boolean): string {
    if (win && !worksInWindow(key)) return `${label(key)} can't be pinned into a window yet`;
    return `Nothing in ${label(key)} for this`;
  }

  function label(key: WorkKey): string {
    return TABS.find((t) => t.key === key)?.label ?? key;
  }

  // --- The switch ----------------------------------------------------------
  //
  // The tab you tap lights at once and one underline glides over to it. The
  // page under the tabs slides a little the other way and fades, the next work
  // opens while it can't be seen, and its page slides in from the side you
  // tapped. Tap again mid-switch and it goes straight to the new tab: nothing
  // queues. On Reduced the page fades and the underline jumps; on Off the work
  // just changes. Timings are MOTION.tabs in lib/motion.ts.

  let tabsEl: HTMLDivElement;
  let indEl: HTMLDivElement;
  /** The tab tapped, lit while the page slides out and before its work opens. */
  let picked: WorkKey | null = null;
  $: shown = picked ?? current;
  $: shownAt = indexOf(shown);

  let glideAnim: Animation | null = null;
  let lastGlide: Glide | null = null;
  let pageAnims: Animation[] = [];
  /** The switch waiting on the page to slide out, if any. */
  let leaving: { key: WorkKey } | null = null;
  let destroyed = false;

  // --- Short names --------------------------------------------------------
  //
  // Measured rather than set at a screen width, so it follows Bar size and
  // whatever the tabs sit in — a narrow window on a wide screen included. The
  // hidden row holds the full names in the tabs' own font and padding; if the
  // widest won't fit an equal share of the row, every tab goes short at once,
  // so the row never mixes the two.

  let measureEl: HTMLDivElement;
  let compact = false;
  let resizeObs: ResizeObserver | null = null;

  function measure() {
    if (!tabsEl || !measureEl) return;
    const share = tabsEl.clientWidth / TABS.length;
    if (!share) return;
    let widest = 0;
    for (const el of Array.from(measureEl.children)) widest = Math.max(widest, (el as HTMLElement).offsetWidth);
    compact = widest > share;
  }

  onMount(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The row changes width with the card or window; the hidden names change
    // width with Bar size.
    resizeObs = new ResizeObserver(() => measure());
    resizeObs.observe(tabsEl);
    resizeObs.observe(measureEl);
  });

  function indexOf(key: WorkKey): number {
    return Math.max(0, TABS.findIndex((t) => t.key === key));
  }

  /** Where the underline is right now, in tab widths, mid-glide included. */
  function underlineAt(): number {
    if (!indEl || !tabsEl) return shownAt;
    const w = indEl.offsetWidth;
    if (!w) return shownAt;
    return (indEl.getBoundingClientRect().left - tabsEl.getBoundingClientRect().left) / w;
  }

  /** The card's page: everything under the tabs. */
  function pageEls(): HTMLElement[] {
    const els: HTMLElement[] = [];
    for (let el = tabsEl?.nextElementSibling; el; el = el.nextElementSibling) {
      if (el instanceof HTMLElement) els.push(el);
    }
    return els;
  }

  function glide(from: number, to: number, elapsed = 0) {
    glideAnim?.cancel();
    glideAnim = null;
    lastGlide = null;
    const ms = MOTION.tabs.underlineMs;
    if (motionLevel() !== "full" || Math.abs(from - to) < 0.01 || elapsed >= ms) return;
    if (!indEl || typeof indEl.animate !== "function") return;
    glideAnim = indEl.animate(
      [{ transform: `translateX(${from * 100}%)` }, { transform: `translateX(${to * 100}%)` }],
      { duration: ms, easing: EASE_STANDARD },
    );
    glideAnim.currentTime = elapsed;
    lastGlide = { from, to, at: performance.now() - elapsed };
  }

  function stopPage() {
    for (const a of pageAnims) a.cancel();
    pageAnims = [];
  }

  /** The lookup card's frame or the window: whatever this card sits in. */
  function host(): Element | null {
    return tabsEl?.parentElement?.parentElement ?? null;
  }

  /** Open the work. If it didn't open after all, this row is still here: put
   *  the page back and the underline home. */
  function go(key: WorkKey, dir: number) {
    leaving = null;
    const level = motionLevel();
    handoff = level === "off" ? null : { host: host(), to: key, dir, level, glide: lastGlide, at: performance.now() };
    onSelect(key);
    tick().then(() => {
      if (destroyed) return;
      handoff = null;
      stopPage();
      picked = null;
      glide(underlineAt(), indexOf(current));
    });
  }

  async function pick(key: WorkKey) {
    if (key === shown || !isAvailable(key, works, onIndex, inWindow)) return;
    const from = underlineAt();

    // Back to the tab you were on before the page had gone: it comes back.
    if (key === current) {
      leaving = null;
      stopPage();
      picked = null;
      glide(from, indexOf(key));
      return;
    }

    const dir = indexOf(key) > indexOf(current) ? 1 : -1;
    const level = motionLevel();
    const els = pageEls();
    picked = key;
    glide(from, indexOf(key));
    // A second tap mid-switch: the page is already on its way out, so go
    // straight to the new tab.
    if (level === "off" || leaving || !els.length || typeof els[0].animate !== "function") {
      go(key, dir);
      return;
    }

    const full = level === "full";
    const px = MOTION.tabs.slidePx;
    const frames: Keyframe[] = full
      ? [{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${-dir * px}px)`, opacity: 0 }]
      : [{ opacity: 1 }, { opacity: 0 }];
    const ms = full ? MOTION.tabs.outMs : MOTION.reducedFadeMs * 0.4;
    stopPage();
    const anims = els.map((el) => el.animate(frames, { duration: ms, easing: EASE_EXIT, fill: "forwards" }));
    pageAnims = anims;
    const mine = { key };
    leaving = mine;
    try {
      await Promise.all(anims.map((a) => a.finished));
    } catch {
      return; // cancelled: tapped back, or this row went away
    }
    if (leaving === mine && !destroyed) go(key, dir);
  }

  // The arriving row: carry on the glide and bring the page in.
  onMount(() => {
    const h = handoff;
    if (!h || h.to !== current || h.host !== host()) return;
    handoff = null;
    if (performance.now() - h.at > 500) return;
    if (h.glide) glide(h.glide.from, h.glide.to, performance.now() - h.glide.at);
    const els = pageEls();
    if (!els.length || typeof els[0].animate !== "function") return;
    const full = h.level === "full";
    const px = MOTION.tabs.slidePx;
    const frames: Keyframe[] = full
      ? [{ transform: `translateX(${h.dir * px}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }]
      : [{ opacity: 0 }, { opacity: 1 }];
    const ms = full ? MOTION.tabs.inMs : MOTION.reducedFadeMs * 0.6;
    pageAnims = els.map((el) => el.animate(frames, { duration: ms, easing: EASE_ENTER }));
  });

  onDestroy(() => {
    resizeObs?.disconnect();
    destroyed = true;
    leaving = null;
    glideAnim?.cancel();
  });
</script>

<div class="work-tabs" role="tablist" aria-label="Reference works" bind:this={tabsEl}>
  {#each TABS as tab (tab.key)}
    {@const live = isAvailable(tab.key, works, onIndex, inWindow)}
    <button
      class="work-tab"
      class:active={tab.key === shown}
      disabled={!live}
      role="tab"
      aria-selected={tab.key === current}
      title={live ? tab.label : reason(tab.key, inWindow)}
      on:click={() => pick(tab.key)}
    >
      {compact ? tab.short : tab.label}
    </button>
  {/each}
  <div
    class="tab-ind"
    style:width="{100 / TABS.length}%"
    style:transform="translateX({shownAt * 100}%)"
    bind:this={indEl}
    aria-hidden="true"
  ></div>
  <div class="tab-measure" bind:this={measureEl} aria-hidden="true">
    {#each TABS as tab (tab.key)}
      <span class="work-tab">{tab.label}</span>
    {/each}
  </div>
</div>

<style>
  /* Deliberately not called .tabs: IsbeContent and NavesContent style their
     section tabs as an unqualified `.tabs button`, which would capture this. */
  .work-tabs {
    position: relative;
    display: flex;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border-color, #333);
  }
  .work-tab {
    /* Equal widths so each work keeps the same spot in every card. */
    flex: 1 1 0;
    min-width: 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #999);
    font-family: inherit;
    font-size: calc(12px * var(--bar-scale, 1));
    padding: calc(9px * var(--bar-scale, 1)) calc(6px * var(--bar-scale, 1));
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition:
      color var(--motion-fade-ms, 120ms),
      background var(--motion-fade-ms, 120ms);
  }
  .work-tab:hover:not(:disabled):not(.active) {
    color: var(--text-color, #fff);
    background: rgba(255, 255, 255, 0.04);
  }
  .work-tab.active {
    color: var(--color-primary, #4a90e2);
    background: rgba(74, 144, 226, 0.08);
  }
  /* One underline for the row, which glides from tab to tab, instead of each
     tab drawing its own. It sits over the tabs' own transparent 2px border, so
     the row is the same height it always was. */
  .tab-ind {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--color-primary, #4a90e2);
    pointer-events: none;
  }
  /* The full names, laid out like tabs but never seen: measure() reads their
     widths to decide whether the row goes short. */
  .tab-measure {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    visibility: hidden;
    pointer-events: none;
    height: 0;
    overflow: hidden;
  }
  .tab-measure .work-tab {
    flex: none;
    overflow: visible;
  }
  /* Grayed rather than hidden — the point is that the row never changes shape,
     so you can see at a glance what this subject does and doesn't have. */
  .work-tab:disabled {
    opacity: 0.3;
    cursor: default;
  }
</style>
