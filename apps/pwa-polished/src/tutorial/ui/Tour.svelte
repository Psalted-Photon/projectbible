<script lang="ts">
  /**
   * Runs a list of tour steps.
   *
   * Each step waits for the app to be free (no Verse of the Day, no modal, no
   * pane unless the step lives in one), spotlights its target, and moves on
   * either when the person does the thing or when they tap Next. While the app
   * is busy with something else the tour draws nothing at all, so it never
   * sits on top of a dialog someone needs to answer.
   */
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import type { TourStep, StepContext, EdgeLane } from "../content/types";
  import { boxOf, unionBoxes, padBox, onScreen, reveal, type Box } from "../engine/targets";
  import { appQuiet, anyPaneOpen, watchScreen } from "../engine/watch";
  import { paneStore } from "../../stores/paneStore";
  import { windowStore } from "../../lib/stores/windowStore";
  import { installAllState } from "../../lib/packInstaller";
  import Spotlight from "./Spotlight.svelte";
  import TipCard from "./TipCard.svelte";
  import EdgeHint from "./EdgeHint.svelte";

  export let steps: TourStep[];

  const dispatch = createEventDispatcher<{ finish: Record<string, any>; skip: void }>();

  /** How long a missing target is waited for before its card shows without a spotlight. */
  const TARGET_GRACE_MS = 1500;

  let index = -1;
  let step: TourStep | null = null;
  let moving = false;
  let revealed = false;

  const ctx: StepContext = {
    tour: {},
    enteredAt: 0,
    goTo: (id: string) => {
      const i = steps.findIndex((s) => s.id === id);
      if (i >= 0 && !moving) void enter(i);
    },
  };

  let showing = false;
  let box: Box | null = null;
  let lane: EdgeLane | null = null;
  let dragging = false;
  let title = "";
  let body = "";

  function text(value: string | ((c: StepContext) => string)): string {
    return typeof value === "function" ? value(ctx) : value;
  }

  /** Arrive at the first step from `from` that isn't skipped, or finish. */
  async function enter(from: number) {
    moving = true;
    showing = false;
    try {
      for (let i = from; i < steps.length; i++) {
        const candidate = steps[i];
        if (candidate.skipIf && (await candidate.skipIf(ctx))) continue;
        index = i;
        step = candidate;
        revealed = false;
        ctx.enteredAt = Date.now();
        await candidate.onEnter?.(ctx);
        return;
      }
      step = null;
      dispatch("finish", ctx.tour);
    } finally {
      moving = false;
      update();
    }
  }

  function next() {
    if (!moving && step) void enter(index + 1);
  }

  /** Look at the screen again: is the step's moment here, done, or blocked? */
  function update() {
    if (!step || moving) return;
    const s = step;

    if (!get(appQuiet) || (!s.allowPanes && anyPaneOpen())) {
      showing = false;
      return;
    }

    if (s.doneWhen?.(ctx)) {
      next();
      return;
    }

    title = text(s.title);
    body = text(s.body);
    dragging = !!document.querySelector(".drag-preview");

    if (s.lane) {
      lane = s.lane(ctx);
      box = lane ? padBox(lane.box, 4) : null;
      showing = true;
      return;
    }
    lane = null;

    if (!s.target) {
      box = null;
      showing = true;
      return;
    }

    const found = s.target(ctx);
    const elements = found ? (Array.isArray(found) ? found : [found]) : [];
    if (elements.length === 0) {
      box = null;
      showing = Date.now() - ctx.enteredAt > TARGET_GRACE_MS;
      return;
    }

    if (s.reveal && !revealed) {
      revealed = true;
      reveal(elements[0] as HTMLElement);
    }

    const union = unionBoxes(elements.map(boxOf));
    box = union && onScreen(union) ? padBox(union, s.pad ?? 6) : null;
    showing = true;
  }

  let stopWatching: (() => void) | null = null;

  onMount(() => {
    stopWatching = watchScreen(update, [appQuiet, paneStore, windowStore, installAllState]);
    void enter(0);
  });

  onDestroy(() => stopWatching?.());
</script>

{#if step && showing}
  <Spotlight {box} passThrough={lane ? false : (step.passThrough ?? true)} faded={dragging} />

  {#if lane}
    <EdgeHint {lane} {dragging} />
  {/if}

  {#if !dragging}
    <TipCard
      {title}
      {body}
      box={lane ? null : box}
      nextLabel={step.nextLabel ?? "Next"}
      altLabel={step.alt?.label ?? null}
      extra={step.extra}
      on:next={next}
      on:alt={() => step?.alt?.run(ctx)}
      on:skip={() => dispatch("skip")}
    />
  {/if}
{/if}
