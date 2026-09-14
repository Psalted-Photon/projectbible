<script lang="ts">
  /**
   * The lime dots, once the tour is over.
   *
   * Every tip whose target is on screen and on top gets one small pulsing dot.
   * Tapping a dot opens its card: what the thing does, "Show me" (spotlight it
   * and wait for a tap on it), "Got it", and a way to switch the tutorial off.
   * A tip that needs a pack the device doesn't have offers the pack instead of
   * "Show me".
   *
   * Dots that would crowd each other (a row of buttons, the word ring) share
   * one numbered dot, which opens a short list of what's there.
   *
   * Dots are worked out again whenever the screen changes, at most a few times
   * a second, and hidden while anything scrolls: a dot left behind by a moving
   * page would point at the wrong thing.
   *
   * The screen edges a window can slide out from glow faintly, with one dot
   * just inside, while nothing else is open.
   */
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import type { Tip, TourStep, EdgeLane } from "../content/types";
  import { ALL_TIPS, EDGE_TIP } from "../content/tips";
  import { TURN_OFF } from "../content/turn-off";
  import { slideOutWindowStep } from "../content/steps";
  import { locateAll, locateTip, clusterSpots, type Spot, type Cluster } from "../engine/hotspots";
  import { edgeLane, freeEdges, freeEdge, LANE_DEPTH } from "../engine/edges";
  import { boxOf, hasSize, padBox, unionBoxes, type Box } from "../engine/targets";
  import { appQuiet, anyPaneOpen, overlayOpen } from "../engine/watch";
  import { paneStore } from "../../stores/paneStore";
  import { windowStore } from "../../lib/stores/windowStore";
  import { PACK_CATALOG } from "../../lib/packInstaller";
  import { packInstallFinished } from "../../adapters/db-manager";
  import TipCard from "./TipCard.svelte";
  import Tour from "./Tour.svelte";

  /** The most often the dots are worked out again. */
  const THROTTLE_MS = 150;
  /** How long a scroll has to stop before the dots come back. */
  const SCROLL_SETTLE_MS = 200;
  /** Catches movement nothing announces, like a sheet sliding in. */
  const POLL_MS = 600;

  type Mode =
    | { kind: "dots" }
    | { kind: "list"; spots: Spot[] }
    | { kind: "card"; tip: Tip; el: Element | null }
    | { kind: "show"; steps: TourStep[] }
    | { kind: "turn-off" };

  let mode: Mode = { kind: "dots" };
  let clusters: Cluster[] = [];
  let lanes: EdgeLane[] = [];
  let edgeDot: { x: number; y: number } | null = null;
  let scrolling = false;

  let cardBox: Box | null = null;
  let checkingPack = false;
  let missingPack: string | null = null;

  // ── Where the dots go ────────────────────────────────────────────────────

  function clearDots() {
    clusters = [];
    lanes = [];
    edgeDot = null;
  }

  function isLaidOut(el: Element | null): el is Element {
    return !!el && el.isConnected && hasSize(el);
  }

  /** The reader is what sits under this point: no window, pane or popup over it. */
  function readerAt(x: number, y: number): boolean {
    const hit = document.elementsFromPoint(x, y).find((el) => !el.closest(".tut-root"));
    return !!hit?.closest(".main-content");
  }

  function laneIsClear(lane: EdgeLane): boolean {
    return readerAt(lane.box.left + lane.box.width / 2, lane.box.top + lane.box.height / 2);
  }

  /** Just inside a lane, clear of the strip a drag starts from. */
  function dotInside(lane: EdgeLane): { x: number; y: number } | null {
    const inset = LANE_DEPTH + 18;
    const midX = lane.box.left + lane.box.width / 2;
    const midY = lane.box.top + lane.box.height / 2;
    switch (lane.edge) {
      case "right":
        return { x: window.innerWidth - inset, y: midY };
      case "left":
        return { x: inset, y: midY };
      case "bottom":
        return { x: midX, y: window.innerHeight - inset };
      default:
        return null;
    }
  }

  function compute() {
    if (mode.kind === "card") {
      clearDots();
      const { tip, el } = mode;
      if (tip === EDGE_TIP) {
        const edge = freeEdge();
        cardBox = edge ? padBox(edgeLane(edge).box, 2) : null;
      } else if (el) {
        if (!isLaidOut(el)) {
          backToDots();
          return;
        }
        cardBox = padBox(boxOf(el), 4);
      }
      return;
    }

    if (mode.kind === "list") {
      clearDots();
      const live = mode.spots.filter((s) => isLaidOut(s.el));
      if (live.length === 0) {
        backToDots();
        return;
      }
      const union = unionBoxes(live.map((s) => boxOf(s.el)));
      cardBox = union ? padBox(union, 4) : null;
      return;
    }

    if (mode.kind !== "dots") {
      clearDots();
      return;
    }

    if (!scrolling) clusters = clusterSpots(locateAll(ALL_TIPS));

    // The top edge is left out: the navbar lives there, and a glow over it is noise.
    const plain = get(appQuiet) && !anyPaneOpen() && !overlayOpen() && !document.querySelector(".toast");
    lanes = plain
      ? freeEdges()
          .filter((edge) => edge !== "top")
          .map(edgeLane)
          .filter(laneIsClear)
      : [];
    const inside = lanes.length ? dotInside(lanes[0]) : null;
    edgeDot = inside && readerAt(inside.x, inside.y) ? inside : null;
  }

  let timer = 0;
  let lastRun = 0;
  let scrollTimer = 0;

  function schedule() {
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - lastRun));
    timer = window.setTimeout(() => {
      timer = 0;
      lastRun = performance.now();
      compute();
    }, wait);
  }

  function handleScroll() {
    if (!scrolling) {
      scrolling = true;
      clusters = [];
    }
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      scrolling = false;
      schedule();
    }, SCROLL_SETTLE_MS);
    // An open card follows its target as the page moves.
    if (mode.kind === "card" || mode.kind === "list") schedule();
  }

  function outsideTutorial(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;
    return !el?.closest(".tut-root");
  }

  let stop: (() => void) | null = null;

  onMount(() => {
    // Only changes to the app count; the dots redrawing themselves must not
    // set off another round.
    const observer = new MutationObserver((records) => {
      if (records.some((r) => outsideTutorial(r.target))) schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-expanded"],
    });
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const poll = window.setInterval(schedule, POLL_MS);
    const unsubs = [
      appQuiet.subscribe(() => schedule()),
      paneStore.subscribe(() => schedule()),
      windowStore.subscribe(() => schedule()),
    ];

    stop = () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", schedule);
      window.clearInterval(poll);
      window.clearTimeout(timer);
      window.clearTimeout(scrollTimer);
      unsubs.forEach((u) => u());
    };
    schedule();
  });

  onDestroy(() => stop?.());

  // ── A dot's card ─────────────────────────────────────────────────────────

  /** Packs found installed stay installed for the session; missing ones are asked again. */
  const installed = new Set<string>();

  async function packReady(id: string): Promise<boolean> {
    if (installed.has(id)) return true;
    const ready = await packInstallFinished(id).catch(() => false);
    if (ready) installed.add(id);
    return ready;
  }

  async function openCard(tip: Tip, el: Element | null) {
    mode = { kind: "card", tip, el };
    missingPack = null;
    checkingPack = !!tip.needs;
    compute();
    if (!tip.needs) return;
    const ready = await packReady(tip.needs);
    if (mode.kind !== "card" || mode.tip !== tip) return;
    missingPack = ready ? null : (PACK_CATALOG.find((p) => p.id === tip.needs)?.name ?? tip.needs);
    checkingPack = false;
  }

  function backToDots() {
    mode = { kind: "dots" };
    schedule();
  }

  function openDot(cluster: Cluster) {
    if (cluster.spots.length === 1) {
      void openCard(cluster.spots[0].tip, cluster.spots[0].el);
    } else {
      mode = { kind: "list", spots: cluster.spots };
      compute();
    }
  }

  /** The ripple on each dot starts at its own moment, so a screenful doesn't pulse in step. */
  function rippleDelay(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return (Math.abs(hash) % 22) / 10;
  }

  function getPack() {
    paneStore.openPane("packs", "right");
    backToDots();
  }

  /** Spotlight the tip's target and wait for a press on it (or Done). */
  function pressStep(tip: Tip, el: Element | null): TourStep {
    return {
      id: "show-me",
      title: tip.title,
      body: "Go ahead, give it a try.",
      target: () => (el && el.isConnected && hasSize(el) ? el : (locateTip(tip)?.el ?? null)),
      reveal: true,
      anywhere: true,
      onEnter: (ctx) => {
        // A press that reaches the app went through the spotlight's hole:
        // everywhere else is covered by the tutorial's own tap catchers.
        const onPress = (event: Event) => {
          if (!(event.target as Element | null)?.closest?.(".tut-root")) ctx.tour.pressed = true;
        };
        window.addEventListener("pointerdown", onPress, true);
        ctx.tour.stopListening = () => window.removeEventListener("pointerdown", onPress, true);
      },
      onLeave: (ctx) => ctx.tour.stopListening?.(),
      doneWhen: (ctx) => !!ctx.tour.pressed,
      nextLabel: "Done",
    };
  }

  function showMe() {
    if (mode.kind !== "card") return;
    const { tip, el } = mode;
    const step =
      tip === EDGE_TIP ? { ...slideOutWindowStep("show-me"), nextLabel: "Done" } : pressStep(tip, el);
    mode = { kind: "show", steps: [step] };
  }

  function turnOff() {
    mode = { kind: "turn-off" };
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && (mode.kind === "card" || mode.kind === "list")) backToDots();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if mode.kind === "dots"}
  {#each lanes as lane (lane.edge)}
    <div
      class="strip strip-{lane.edge}"
      style="left:{lane.box.left}px; top:{lane.box.top}px; width:{lane.box.width}px; height:{lane.box.height}px;"
      aria-hidden="true"
    ></div>
  {/each}

  {#if edgeDot}
    <button
      class="dot no-edge-gesture"
      style="left:{edgeDot.x}px; top:{edgeDot.y}px;"
      aria-label="Tip: {EDGE_TIP.title}"
      on:click={() => openCard(EDGE_TIP, null)}
    ></button>
  {/if}

  {#each clusters as cluster (cluster.spots[0].tip.id)}
    {@const count = cluster.spots.length}
    <button
      class="dot no-edge-gesture"
      class:many={count > 1}
      style="left:{cluster.x}px; top:{cluster.y}px; --ripple-delay:{rippleDelay(cluster.spots[0].tip.id)}s;"
      aria-label={count > 1 ? `${count} tips here` : `Tip: ${cluster.spots[0].tip.title}`}
      on:click={() => openDot(cluster)}
    >
      {#if count > 1}<span class="count">{count}</span>{/if}
    </button>
  {/each}
{:else if mode.kind === "list"}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="catch no-edge-gesture" on:click={backToDots} aria-hidden="true"></div>
  {#if cardBox}
    <div
      class="focus"
      style="left:{cardBox.left}px; top:{cardBox.top}px; width:{cardBox.width}px; height:{cardBox.height}px;"
      aria-hidden="true"
    ></div>
  {/if}
  <TipCard title="{mode.spots.length} things here" body="Pick one to see what it does." box={cardBox}>
    <ul class="tip-list">
      {#each mode.spots as spot (spot.tip.id)}
        <li>
          <button class="tip-item" on:click={() => openCard(spot.tip, spot.el)}>{spot.tip.title}</button>
        </li>
      {/each}
    </ul>
    <svelte:fragment slot="buttons">
      <button class="tut-btn-ghost small" on:click={backToDots}>Got it</button>
    </svelte:fragment>
    <svelte:fragment slot="footer">
      <button class="off-link" on:click={turnOff}>Turn off Tutorial Mode</button>
    </svelte:fragment>
  </TipCard>
{:else if mode.kind === "card"}
  <!-- A tap anywhere else just closes the card. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="catch no-edge-gesture" on:click={backToDots} aria-hidden="true"></div>
  {#if cardBox}
    <div
      class="focus"
      style="left:{cardBox.left}px; top:{cardBox.top}px; width:{cardBox.width}px; height:{cardBox.height}px;"
      aria-hidden="true"
    ></div>
  {/if}
  <TipCard
    title={mode.tip.title}
    body={mode.tip.body}
    box={cardBox}
    extra={mode.tip.extra}
    note={missingPack ? `Needs the ${missingPack} pack.` : null}
  >
    <svelte:fragment slot="buttons">
      <button class="tut-btn-ghost small" on:click={backToDots}>Got it</button>
      <span class="spacer"></span>
      {#if missingPack}
        <button class="tut-btn small" on:click={getPack}>Get the pack</button>
      {:else if !checkingPack}
        <button class="tut-btn small" on:click={showMe}>Show me</button>
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="footer">
      <button class="off-link" on:click={turnOff}>Turn off Tutorial Mode</button>
    </svelte:fragment>
  </TipCard>
{:else if mode.kind === "show"}
  <Tour steps={mode.steps} skipLabel={null} on:finish={backToDots} on:skip={backToDots} />
{:else if mode.kind === "turn-off"}
  <Tour steps={TURN_OFF} skipLabel="Cancel" on:finish={backToDots} on:skip={backToDots} />
{/if}

<style>
  /* The tap area is kept small: dots sit on the corners of buttons, and a big
     one would take taps meant for the button. */
  .dot {
    position: fixed;
    z-index: var(--tut-z);
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
    animation: appear 0.25s ease both;
  }

  /* The dot itself, with a dark rim so it holds up on the light themes. */
  .dot::before,
  .dot::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
  }

  .dot::before {
    background: var(--tut-lime);
    box-shadow:
      0 0 0 1.5px rgba(11, 15, 0, 0.9),
      0 0 8px 2px rgba(198, 255, 0, 0.65);
  }

  /* A ring spreading out from it, again and again. */
  .dot::after {
    box-sizing: border-box;
    border: 2px solid var(--tut-lime);
    animation: ping 2.2s ease-out infinite;
    animation-delay: var(--ripple-delay, 0s);
  }

  /* Several tips in one spot: a bigger dot with the count on it. */
  .dot.many::before,
  .dot.many::after {
    width: 17px;
    height: 17px;
    margin: -8.5px 0 0 -8.5px;
  }

  .count {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tut-ink);
    font-family: var(--tut-font);
    font-size: 0.64rem;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
  }

  .tip-list {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .tip-item {
    appearance: none;
    width: 100%;
    padding: 0.5rem 0.7rem;
    text-align: left;
    background: var(--tut-lime-faint);
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--tut-text);
    font-family: var(--tut-font);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .tip-item::before {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin: 0 0.55rem 0.1rem 0;
    border-radius: 50%;
    background: var(--tut-lime);
  }

  .tip-item:hover,
  .tip-item:focus-visible {
    border-color: var(--tut-lime);
    outline: none;
  }

  .strip {
    position: fixed;
    z-index: var(--tut-z);
    pointer-events: none;
    opacity: 0.6;
  }

  /* A lime line with a faint dark edge, so it reads on light pages too. */
  .strip::before {
    content: "";
    position: absolute;
    background: linear-gradient(var(--dir), transparent, var(--tut-lime), transparent);
    box-shadow:
      0 0 0 1px rgba(11, 15, 0, 0.25),
      0 0 12px 2px rgba(198, 255, 0, 0.35);
  }

  .strip-right::before {
    --dir: 180deg;
    right: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }
  .strip-left::before {
    --dir: 180deg;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }
  .strip-bottom::before {
    --dir: 90deg;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
  }

  .catch {
    position: fixed;
    inset: 0;
    z-index: var(--tut-z);
    pointer-events: auto;
  }

  /* No dimming behind a dot's card, so the ring carries a dark edge of its own
     to stay visible on the light and sepia themes. */
  .focus {
    position: fixed;
    z-index: calc(var(--tut-z) + 1);
    border-radius: 10px;
    pointer-events: none;
    box-shadow:
      0 0 0 2px var(--tut-lime),
      0 0 0 3.5px rgba(11, 15, 0, 0.75),
      0 0 18px 3px rgba(198, 255, 0, 0.45);
  }

  .off-link {
    appearance: none;
    margin: 0.6rem 0 0;
    padding: 0;
    background: none;
    border: none;
    color: var(--tut-muted);
    font-family: var(--tut-font);
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .off-link:hover {
    color: var(--tut-text);
  }

  @keyframes appear {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes ping {
    0% {
      transform: scale(1);
      opacity: 0.8;
    }
    80%,
    100% {
      transform: scale(2.4);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot,
    .dot::after {
      animation: none;
    }
  }
</style>
