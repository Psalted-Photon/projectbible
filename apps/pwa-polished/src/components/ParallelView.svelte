<script lang="ts">
  /**
   * The parallel-accounts view: up to four readers showing the same event.
   *
   * This is not a docking arrangement. The window system puts panels against the
   * screen edges, which in portrait gives you one from the top, one from the
   * bottom and a wonky third from the side — there is no way to get four even
   * panes out of it. So this is a single dedicated screen with fixed rows and no
   * draggable boundaries, exactly as asked.
   *
   * Each pane is a real BibleReader, mounted with its own windowId, so
   * everything the reader already does per instance — tapping words, highlights,
   * diamonds, commentary icons — works untouched. The readers are registered in
   * windowStore on the `harmony` edge, which nothing that draws docked windows
   * looks at, and are marked transient so a reload cannot bring them back
   * orphaned (see the note on WindowState.transient).
   *
   * The view owns three things and nothing else: the grid, the strip along the
   * top, and the lifetime of the panes. All the motion belongs to parallelSync,
   * which it hands this container to on mount.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import BibleReader from './BibleReader.svelte';
  import { windowStore } from '../lib/stores/windowStore';
  import { parallelStore, type ParallelLayout } from '../stores/parallelStore';
  import { navigationStore } from '../stores/navigationStore';
  import * as parallelSync from '../lib/parallelSync';
  import { groupById, stepSection } from '../lib/parallelIndex';

  /**
   * Below this width the panes are stacked whatever the user chose.
   *
   * Two columns of a Bible reader at 360px each is about 28 characters a line,
   * which is unreadable — the reader's own paragraph layout gives up long before
   * that. 720px is where two columns first become worth having, and it is also
   * roughly where a folding phone lands when it opens.
   */
  const SIDE_BY_SIDE_MIN_PX = 720;

  let container: HTMLElement;
  let viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;

  $: panes = $parallelStore.panes;
  $: masterId = $parallelStore.masterId;

  /**
   * Keep each pane's recorded book in step with the reader inside it.
   *
   * The picker sets the book when the view opens, but a pane is a real reader
   * and can be navigated by hand — with the anchor off (phase 7) that is the
   * whole point of it. The engine asks the group for a passage in `pane.book`,
   * so a pane showing Luke while the store still says Mark would be driven to
   * Mark's verses inside Luke's chapter, or dimmed for a book it is no longer
   * displaying.
   *
   * Watched here rather than written from the reader: the window state is
   * already the reader's own record of where it is, so this follows the truth
   * instead of adding a second place that has to be told. setPaneBook bails when
   * nothing changed, so this costs a comparison per pane on window-state writes.
   */
  $: for (const w of $windowStore) {
    if (w.edge === 'harmony' && w.contentState?.book) {
      parallelStore.setPaneBook(w.id, w.contentState.book);
    }
  }

  /**
   * The layout actually used, which is the user's choice unless the screen
   * cannot take it.
   *
   * Demoted rather than overwritten: the store keeps `columns` while a phone in
   * portrait shows it stacked, so turning the phone restores the choice instead
   * of making the user pick again. `corners` needs four panes as well as the
   * width — a 2x2 of three panes leaves a hole.
   */
  $: wideEnough = viewportWidth >= SIDE_BY_SIDE_MIN_PX;
  $: effectiveLayout = resolveLayout($parallelStore.layout, panes.length, wideEnough);
  $: demoted = effectiveLayout !== $parallelStore.layout;

  function resolveLayout(
    chosen: ParallelLayout,
    count: number,
    wide: boolean,
  ): ParallelLayout {
    if (chosen === 'stacked') return 'stacked';
    if (!wide) return 'stacked';
    if (chosen === 'corners' && count < 4) return 'columns';
    return chosen;
  }

  /**
   * The grid. Rows and columns rather than a flex direction, because the ask was
   * even panes with fixed boundaries: `1fr` each means four panes are exactly a
   * quarter of the screen whatever is inside them, and nothing a reader does to
   * its own content can push a neighbour around.
   */
  $: gridStyle =
    effectiveLayout === 'columns'
      ? `grid-template-columns: repeat(${panes.length}, 1fr); grid-template-rows: 1fr;`
      : effectiveLayout === 'corners'
        ? 'grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;'
        : `grid-template-columns: 1fr; grid-template-rows: repeat(${panes.length}, 1fr);`;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Hand the engine the container once the readers are in the DOM.
   *
   * After `tick()` rather than straight away: the engine resolves every pane by
   * querying inside this element, and attaching before the {#each} has rendered
   * would give it a container with nothing in it. It would recover on the first
   * scroll, but the first scroll is the one that matters.
   */
  onMount(async () => {
    await tick();
    parallelSync.attach(container);
  });

  onDestroy(() => {
    parallelSync.detach();
  });

  function onResize() {
    viewportWidth = window.innerWidth;
  }

  // ── Leaving ───────────────────────────────────────────────────────────────

  /**
   * Close the view and put the main reader where the master was.
   *
   * The position is read from the pane's own window state rather than from the
   * engine, because the master is the one pane the engine never tracks — it is
   * the thing being followed. The reader writes its own state as it scrolls, so
   * that state is the master's position by definition.
   *
   * Order matters: the store closes first so nothing re-renders a pane whose
   * window has already gone, then the panes, then the reader is moved. The
   * engine's own teardown is onDestroy, which Svelte runs on the way out of the
   * {#if} in App.svelte.
   */
  function close() {
    const master = masterId
      ? $windowStore.find((w) => w.id === masterId)
      : undefined;
    const at = master?.contentState;

    parallelStore.close();
    windowStore.closeHarmonyPanes();

    if (at?.book && at?.chapter) {
      // No highlight: you are not being sent anywhere, you are being put back
      // where you already were, and a "start reading here" mark on arrival would
      // claim otherwise.
      navigationStore.navigateTo(
        at.translation ?? $navigationStore.translation,
        at.book,
        at.chapter,
        null,
        false,
      );
    }
  }

  /**
   * Escape, and the phone's back gesture.
   *
   * The history entry is pushed on mount and consumed here. It is the only
   * pushState in the app — everything else uses replaceState — which is
   * deliberate: one entry that exists exactly as long as this view does cannot
   * desynchronise the rest of the app from the history stack, whereas a general
   * routing scheme would be a much larger decision than this view should make.
   */
  let pushedHistory = false;

  onMount(() => {
    try {
      history.pushState({ pbHarmony: true }, '');
      pushedHistory = true;
    } catch {
      // A blocked pushState costs the back gesture and nothing else; × and
      // Escape still work.
    }
  });

  function onPopState() {
    // The entry is already gone by the time this fires, so closing must not try
    // to pop it again.
    pushedHistory = false;
    close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const target = e.target as HTMLElement | null;
    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable
    ) {
      return;
    }
    closeFromUser();
  }

  /**
   * Leaving by × or Escape, rather than by the back gesture.
   *
   * Goes back through history rather than closing directly, so the entry pushed
   * on mount is consumed. Closing without it would leave a dead entry on the
   * stack and the next back gesture would appear to do nothing.
   */
  function closeFromUser() {
    if (pushedHistory) {
      pushedHistory = false;
      history.back();
      return;
    }
    close();
  }

  // ── The strip ─────────────────────────────────────────────────────────────

  /**
   * What the strip says about a pane, when it is dimmed.
   *
   * Phrased from the tagged reason rather than stored as a sentence, so the
   * engine can compare reasons without string matching and the wording can
   * change here alone.
   */
  function dimLabel(pane: (typeof panes)[number]): string {
    const reason = pane.dimReason;
    if (!reason) return '';
    if (reason.kind === 'no-group') return 'No parallel here';
    if (reason.kind === 'no-passage') return `Not in ${reason.book}`;
    return `${reason.book} ${reason.chapter} not loaded`;
  }

  // ── Stepping by Robertson section ─────────────────────────────────────────

  /**
   * The section the strip names, and what the arrows step from.
   *
   * Read straight out of the store: the engine works it out on each tick from
   * the master position it already has, so this costs a lookup by id and no DOM
   * access at all. Deriving it here from `currentGroupId` instead would not
   * work — that is whatever `bestParallel` chose, and in the Gospels it is a
   * BSB marker with no place in Robertson's sequence about two times in three.
   */
  $: section =
    $parallelStore.currentSectionId !== null
      ? groupById($parallelStore.currentSectionId)
      : null;

  /**
   * The arrows are an anchored-only control.
   *
   * A step moves the whole harmony to the same event in every pane, which is
   * precisely what switching the anchor off says you do not want — with it off
   * the panes are ordinary readers and there is no "whole harmony" to move. The
   * store's section is also frozen at wherever the master was when the anchor
   * went off, since nothing ticks to update it, so an arrow that still worked
   * would step from a stale place. Disabled rather than hidden, for the same
   * reason the end-of-harmony arrows are.
   */
  $: canStep = $parallelStore.anchorOn && section !== null;

  /**
   * Whether an arrow can go anywhere, worked out from the section rather than
   * attempted and discovered. A disabled arrow is how the ends of the harmony
   * are shown — see the note on stepSection about not wrapping.
   */
  $: canStepBack = canStep && section !== null && stepSection(section.id, -1) !== null;
  $: canStepFwd = canStep && section !== null && stepSection(section.id, 1) !== null;

  /** What the strip calls where the master is, when it is in a named section. */
  $: sectionLabel = section
    ? `§${section.robertsonSection} · ${section.title ?? ''}`.replace(/ · $/, '')
    : '';

  /**
   * Only this Gospel carries the section the master is in.
   *
   * Shown in the strip as well as tinting the pane, because in the harmony the
   * three empty panes already say something is missing — what the strip adds is
   * which Gospel it is that has it, which is the actual insight.
   */
  $: soloBook =
    section?.soloRobertson === true ? (section.passages[0]?.book ?? null) : null;

  function step(delta: 1 | -1) {
    if (!section) return;
    const next = stepSection(section.id, delta);
    if (next) parallelSync.goToSection(next);
  }
</script>

<svelte:window on:resize={onResize} on:popstate={onPopState} on:keydown={onKeydown} />

<div class="pv-root">
  <div class="pv-strip">
    <!-- The arrows move by Robertson section rather than by chapter, which is
         the unit a harmony is actually built from: a chapter boundary means
         four different things in four Gospels, whereas a section is the same
         event in all of them. -->
    <button
      class="pv-step"
      on:click={() => step(-1)}
      disabled={!canStepBack}
      aria-label="Previous section"
      title="Previous section">‹</button>
    <button
      class="pv-step"
      on:click={() => step(1)}
      disabled={!canStepFwd}
      aria-label="Next section"
      title="Next section">›</button>

    <span class="pv-set">
      {$parallelStore.setLabel ?? 'Harmony'}
      {#if sectionLabel}<span class="pv-section">{sectionLabel}</span>{/if}
    </span>

    {#if soloBook}
      <span class="pv-solo">Only in {soloBook}</span>
    {/if}
    {#if demoted}
      <!-- Said out loud rather than silently overriding: the user picked a
           layout and is getting a different one, and a screen that quietly
           ignores a choice reads as broken. -->
      <span class="pv-note">Stacked — screen too narrow for columns</span>
    {/if}
    <button class="pv-close" on:click={closeFromUser} aria-label="Close harmony">✕</button>
  </div>

  <div class="pv-grid" style={gridStyle} bind:this={container}>
    {#each panes as pane (pane.paneId)}
      <!-- data-parallel-pane is the engine's handle on this pane: every element
           lookup it does is scoped to the wrapper carrying this id, which is
           what stops a query for "the scroller" finding whichever pane the DOM
           happens to list first. -->
      <div
        class="pv-pane"
        class:dim={pane.dim}
        class:master={pane.paneId === masterId}
        data-parallel-pane={pane.paneId}
      >
        <BibleReader windowId={pane.paneId} />
        {#if pane.dim}
          <div class="pv-dim-label">{dimLabel(pane)}</div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .pv-root {
    position: fixed;
    inset: 0;
    z-index: 8000;
    display: flex;
    flex-direction: column;
    background: #141414;
  }

  .pv-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    padding-top: calc(6px + env(safe-area-inset-top, 0px));
    background: #1c1c1c;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .pv-set {
    font-size: 12px;
    font-weight: 600;
    color: #e0e0e0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The section number and title, after the set name. Dimmer than the set and
     allowed to be clipped by the set's own ellipsis, because on a phone the
     title is often long and the set name is the part that must survive. */
  .pv-section {
    color: #9a9a9a;
    font-weight: 400;
  }

  .pv-step {
    background: none;
    border: none;
    color: #bbb;
    font-size: 17px;
    line-height: 1;
    /* A 28px box round a small glyph: the arrows are the one control here that
       gets pressed repeatedly, and at strip height there is no room to make the
       glyph itself bigger. */
    min-width: 28px;
    height: 28px;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }

  .pv-step:hover:not(:disabled) {
    color: #fff;
  }

  .pv-step:disabled {
    /* Kept visible rather than hidden: an arrow that vanishes at the end of the
       harmony shifts everything beside it, and the gap reads as a glitch rather
       than as "there is nothing further this way". */
    opacity: 0.25;
    cursor: default;
  }

  .pv-solo {
    font-size: 10px;
    font-weight: 600;
    color: #d9b06a;
    border: 1px solid #5a4523;
    background: #2a2116;
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pv-note {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
  }

  .pv-close {
    background: none;
    border: none;
    color: #999;
    font-size: 15px;
    line-height: 1;
    padding: 4px 6px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .pv-close:hover {
    color: #e0e0e0;
  }

  .pv-grid {
    flex: 1;
    display: grid;
    /* 1px of gap, drawn by the background showing through, so the boundaries
       read as fixed dividers rather than as anything you could grab. */
    gap: 1px;
    background: #333;
    min-height: 0;
    overflow: hidden;
  }

  /* min-height/min-width 0 on the cell as well as the grid: a grid item's
     default `auto` minimum is its content size, so a reader with a long chapter
     in it would refuse to shrink to its share and push the rest off screen —
     the one thing fixed even rows must never do. */
  .pv-pane {
    position: relative;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: #1a1a1a;
    transition: opacity 0.25s;
  }

  .pv-pane.dim {
    opacity: 0.4;
  }

  /* The master is marked by a hairline rather than a border, so the panes stay
     exactly the same size whichever one is driving — a border on the master
     would resize every pane each time the role moved. */
  .pv-pane.master::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 1px solid rgba(74, 158, 201, 0.55);
    pointer-events: none;
    z-index: 5;
  }

  .pv-dim-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 5px 10px;
    background: rgba(0, 0, 0, 0.72);
    border-radius: 6px;
    color: #ccc;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 6;
  }
</style>
