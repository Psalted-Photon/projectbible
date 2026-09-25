<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { familyTreeStore } from '../stores/familyTreeStore';
  import { loadFamilyTree } from '../lib/familyTree/data';
  import { layout, ancestorChain, isPlaced, type TreeModel, type TreeRec } from '../lib/familyTree/layout';
  import { draw, fitView, pick, toWorld, viewFor, type View } from '../lib/familyTree/render';
  import { MAX_ZOOM, MIN_ZOOM_OF_FIT, FOCUS_ZOOM } from '../lib/familyTree/config';
  import FamilyTreeCard from './FamilyTreeCard.svelte';
  import FamilyTreeBioSheet from './FamilyTreeBioSheet.svelte';

  /**
   * The tree, full screen on black — opened from People, over everything the
   * user was doing there.
   *
   * Mounted in App.svelte beside LookupModal and moved to <body> by the same
   * portal action ArtViewer uses, so nothing under it — the People card, its
   * list, letter, search, scroll and trail — is ever unmounted. Closing this
   * simply removes the overlay and the user is exactly where they were, with
   * no restore code needed anywhere.
   */

  const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  /** Same portal ArtViewer uses: filters on the light/sepia themes make their
   *  element a fixed-position anchor, so this escapes to <body> instead. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  let rootEl: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let closeBtnEl: HTMLButtonElement;
  let ctx: CanvasRenderingContext2D | null = null;

  let W = 0;
  let H = 0;
  let DPR = 1;

  let model: TreeModel | null = null;
  let loading = true;
  let errored = false;

  let view: View = { x: 0, y: 0, k: 1 };
  /** The zoom that shows the whole tree — the floor for MIN_ZOOM_OF_FIT and
   *  the target for "Whole tree". Recalculated on every resize. */
  let fittedK = 1;
  $: minZoom = fittedK * MIN_ZOOM_OF_FIT;

  let tracedPath: Set<string> | null = null;
  let selectedTribe: string | null = null;
  let pinned: TreeRec | null = null;
  let hovered: TreeRec | null = null;
  /** The tribe lit whole, from a bio's stone. */
  let tribeLit: string | null = null;
  /** Whose line the tribe view frames: the person whose stone was tapped,
   *  or the tribe's founding son when they aren't on the tree. */
  let tribeFocus: TreeRec | null = null;

  /** True whenever `view` is still exactly what fitView last returned — i.e.
   *  nobody has panned, zoomed or glided anywhere since. Resize uses this to
   *  decide whether to simply refit (view === fit, nothing to preserve) or to
   *  keep the screen-centre world point and the current multiple of fit
   *  (view has drifted, and refitting outright would yank the user's place). */
  let atFittedView = false;

  function markViewFitted(v: View) {
    view = v;
    atFittedView = true;
  }
  /** Any pan/zoom/glide that moves `view` away from the fit calls this. */
  function markViewMoved() {
    atFittedView = false;
  }

  // ── All names ────────────────────────────────────────────────────────────
  const NAMES_KEY = 'projectbible-familytree-names';
  function readNamesPref(): boolean {
    try {
      const v = localStorage.getItem(NAMES_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  }
  let allNames = readNamesPref();
  function toggleAllNames() {
    allNames = !allNames;
    try {
      localStorage.setItem(NAMES_KEY, allNames ? '1' : '0');
    } catch {
      // Private mode, or storage blocked — the toggle still works this visit.
    }
    redraw();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function redraw() {
    if (!ctx || !model) return;
    draw({
      ctx,
      W,
      H,
      DPR,
      view,
      model,
      tracedPath,
      selectedTribe,
      pinnedId: pinned?.id ?? null,
      pulsePhase,
      allNames,
    });
  }

  /** Canvas sizing only, with no side effect on the view — shared by open and
   *  by every later resize, which then decide separately what to do with it. */
  function measure() {
    if (!canvas) return;
    DPR = window.devicePixelRatio || 1;
    W = rootEl.clientWidth;
    H = rootEl.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
  }

  /**
   * Resize or orientation change.
   *
   * If the view is still exactly the fitted one, refitting to the new size is
   * simply correct — there is nothing the user did that refitting could
   * disturb. Otherwise the world point under the screen centre is kept fixed,
   * and the zoom is kept at the same multiple of the newly-recalculated
   * fitted zoom, so a rotation doesn't jump the tree out from under a pan or a
   * manual zoom the way a blind refit would — the tree's origin is drawn at
   * 0.62 of the screen height, not the middle, so W and H changing shifts
   * where that origin lands on screen unless something corrects for it.
   */
  function resize() {
    if (!canvas || !model) {
      measure();
      redraw();
      return;
    }
    if (atFittedView) {
      measure();
      const fit = fitView(model, W, H);
      fittedK = fit.k;
      cancelGlide();
      markViewFitted(fit);
      redraw();
      return;
    }
    const oldW = W;
    const oldH = H;
    const centreWorld = toWorld(oldW / 2, oldH / 2, view, oldW, oldH);
    const ratio = fittedK ? view.k / fittedK : 1;
    measure();
    fittedK = fitView(model, W, H).k;
    const nextK = Math.max(minZoom, Math.min(MAX_ZOOM, ratio * fittedK));
    view = viewFor(centreWorld.x, centreWorld.y, nextK, W / 2, H / 2, W, H);
    redraw();
  }

  // ── Tracing and hover ────────────────────────────────────────────────────
  /** How long a line takes to light from God to whoever was chosen, however
   *  many generations long it is. */
  const REVEAL_MS = 2000;
  /**
   * A line lighting up one person at a time, God first — as if God, then
   * Adam, then Seth were each tapped in turn — until the chosen person lights
   * at REVEAL_MS. `extra` (a tribe's other members) lights with them at the
   * end. The frame loop grows tracedPath from this and drops it once done.
   */
  let reveal: { line: string[]; extra: string[]; t0: number } | null = null;

  /** Light `chain` (person back to God, as ancestorChain gives it), plus
   *  `extra`, growing up from God unless the device asks for reduced motion. */
  function revealLine(chain: TreeRec[], extra: string[] = []) {
    const line = chain.map((r) => r.id).reverse();
    if (REDUCED_MOTION || line.length < 2) {
      reveal = null;
      tracedPath = new Set([...line, ...extra]);
      return;
    }
    reveal = { line, extra, t0: performance.now() };
    tracedPath = new Set(line.slice(0, 1));
    ensureLoopRunning();
  }

  function traceFrom(n: TreeRec) {
    if (!model) return;
    revealLine(ancestorChain(model, n));
    selectedTribe = n.tribe || null;
    pinned = n;
    tribeLit = null;
    tribeFocus = null;
    redraw();
  }

  /**
   * Light one tribe whole — every member, plus the line from `focus` (the
   * person whose stone was tapped) down through Jacob to God — and dim the
   * rest. It goes through tracedPath, the same set a traced person uses, so
   * the boughs, roots and trunk all already know how to draw it. The focus is
   * pinned so its pulse says who you came from; with none on the tree, the
   * tribe's founding son stands in for the line and nobody pulses.
   */
  function lightTribe(tribe: string, focus: TreeRec | null = null): boolean {
    if (!model) return false;
    const list = model.byTribe.get(tribe);
    if (!list?.length) return false;
    // byTribe is sorted by depth, so the son of Jacob who heads it is first.
    const line = focus && isPlaced(focus) ? focus : list[0];
    revealLine(
      ancestorChain(model, line),
      list.map((r) => r.id),
    );
    selectedTribe = tribe;
    pinned = line === focus ? focus : null;
    hovered = null;
    tribeLit = tribe;
    tribeFocus = line;
    if (pinned) startPulse();
    else stopPulseIfIdle();
    redraw();
    return true;
  }

  type Region = { x: number; y: number; w: number; h: number };

  /**
   * The part of the screen the tree is still seen in with the tribe card up.
   * Mirrors the `.tribe` rules in FamilyTreeBioSheet: the top 55% in
   * portrait, everything left of the panel in landscape. The strip under the
   * top buttons is left out either way, so a framed line never hides there.
   */
  function tribeRegion(): Region {
    const top = 56;
    if (W > H) {
      const panel = Math.min(W * 0.45, 520) + 24;
      return { x: 0, y: top, w: W - panel, h: H - top };
    }
    return { x: 0, y: top, w: W, h: H * 0.55 - top };
  }

  /**
   * Zoom and pan so someone's whole line, God to them, fills the part of the
   * screen the tribe card leaves free. Never closer than a focused person
   * would be, so a short line doesn't fill the screen with three dots.
   */
  function glideToLine(n: TreeRec | null) {
    if (!model || !n) return;
    const pts = ancestorChain(model, n).filter(isPlaced);
    if (!pts.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const r = tribeRegion();
    // Room for the dots' glow and the names drawn beside them.
    const PAD = 28;
    const fit = Math.min((r.w - 2 * PAD) / Math.max(1, maxX - minX), (r.h - 2 * PAD) / Math.max(1, maxY - minY));
    // fittedK, not minZoom: on open this runs in the same tick fittedK is
    // set, before the reactive minZoom has caught up with it.
    const k = Math.max(fittedK * MIN_ZOOM_OF_FIT, Math.min(FOCUS_ZOOM, MAX_ZOOM, fit));
    glideTo({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, k, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
  }

  function clearSelection() {
    reveal = null;
    tracedPath = null;
    selectedTribe = null;
    pinned = null;
    hovered = null;
    tribeLit = null;
    redraw();
  }

  // ── One shared animation loop for the breathing pulse and every glide ────
  // A phone shouldn't redraw the whole tree twice in the same frame, which is
  // what two independent rAF loops risk the moment a glide runs while someone
  // is pinned (the ordinary case: tracing a person starts the pulse, and
  // opening on them glides to them at the same time).
  let pulsePhase = REDUCED_MOTION ? 1 : 0;
  let pulseStart = 0;
  let glide: {
    startWorld: { x: number; y: number };
    targetWorld: { x: number; y: number };
    logStart: number;
    logEnd: number;
    screen: { x: number; y: number };
    t0: number;
    ms: number;
    /** Called once the glide actually lands — not when it's requested — so a
     *  resize mid-glide can't mistake "heading for the fit" for "already at
     *  it" and cut the animation short by refitting early. */
    onArrive?: () => void;
  } | null = null;
  let rafId: number | null = null;

  function ease(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function frameLoop(now: number) {
    let needsAnother = false;

    if (pinned && !REDUCED_MOTION) {
      pulsePhase = (Math.sin((now - pulseStart) / 480) + 1) / 2;
      needsAnother = true;
    }

    if (reveal) {
      const { line, extra, t0 } = reveal;
      const t = Math.min(1, Math.max(0, now - t0) / REVEAL_MS);
      if (t >= 1) {
        tracedPath = new Set([...line, ...extra]);
        reveal = null;
      } else {
        // God is lit at the start and the chosen person at exactly REVEAL_MS,
        // with everyone between evenly spaced across it.
        const lit = 1 + Math.floor(t * (line.length - 1));
        if (tracedPath?.size !== lit) tracedPath = new Set(line.slice(0, lit));
        needsAnother = true;
      }
    }

    if (glide) {
      const t = Math.min(1, (now - glide.t0) / glide.ms);
      const e = ease(t);
      const k = Math.exp(glide.logStart + (glide.logEnd - glide.logStart) * e);
      const wx = glide.startWorld.x + (glide.targetWorld.x - glide.startWorld.x) * e;
      const wy = glide.startWorld.y + (glide.targetWorld.y - glide.startWorld.y) * e;
      view = viewFor(wx, wy, k, glide.screen.x, glide.screen.y, W, H);
      if (t >= 1) {
        const arrived = glide.onArrive;
        glide = null;
        arrived?.();
      } else {
        needsAnother = true;
      }
    }

    redraw();
    rafId = needsAnother ? requestAnimationFrame(frameLoop) : null;
  }

  function ensureLoopRunning() {
    if (rafId == null) rafId = requestAnimationFrame(frameLoop);
  }

  function startPulse() {
    pulseStart = performance.now();
    ensureLoopRunning();
  }
  function stopPulseIfIdle() {
    if (!pinned) pulsePhase = REDUCED_MOTION ? 1 : 0;
  }

  function cancelGlide() {
    glide = null;
  }

  function glideTo(
    targetWorld: { x: number; y: number },
    targetK: number,
    screen: { x: number; y: number },
    ms = 700,
    onArrive?: () => void,
  ) {
    markViewMoved();
    if (REDUCED_MOTION) {
      view = viewFor(targetWorld.x, targetWorld.y, targetK, screen.x, screen.y, W, H);
      redraw();
      onArrive?.();
      return;
    }
    glide = {
      startWorld: toWorld(screen.x, screen.y, view, W, H),
      targetWorld,
      logStart: Math.log(view.k),
      logEnd: Math.log(targetK),
      screen,
      t0: performance.now(),
      ms,
      onArrive,
    };
    ensureLoopRunning();
  }

  function glideToWhole() {
    if (!model) return;
    // fitView already knows exactly where the tree's midpoint has to land on
    // screen — reading that back with toWorld, rather than re-deriving the
    // padded area's centre here, means this can never drift out of step with
    // fitView's own pad if that ever changes.
    const fit = fitView(model, W, H);
    const anchor = { x: W / 2, y: H / 2 };
    const midWorld = toWorld(anchor.x, anchor.y, fit, W, H);
    // atFittedView is restored only once this glide actually lands, not the
    // moment it's requested — marking it early would let a resize mid-glide
    // treat "heading for the fit" as "already there" and cut the glide short.
    glideTo(midWorld, fit.k, anchor, 700, () => {
      atFittedView = true;
    });
  }

  /**
   * Where a glide should centre the pinned person, given whether the sheet
   * is covering part of the screen right now.
   *
   * The sheet is a bottom sheet on a phone (62% tall) and a right panel at
   * 760px+, so "the part it leaves uncovered" is a different region in each
   * case: the top 38% on a phone, the left side on a wide screen. With no
   * sheet open, the whole screen is free and this is the screen point 62% of
   * the way down it — the same fraction the tree's own origin (Jacob) is
   * drawn at, so a focused person lands where the tree's own centre of
   * gravity already is, not at a dead centre that ignores the canopy/root
   * balance. Each covered case reapplies that same 0.62 fraction, but scaled
   * to whatever's left uncovered rather than to the whole screen.
   */
  function glideAnchor(): { x: number; y: number } {
    if (!sheetOpen) return { x: W / 2, y: H * 0.62 };
    if (isWideLayout()) return { x: (W - 420) / 2, y: H * 0.62 };
    return { x: W / 2, y: H * 0.38 * 0.62 };
  }

  function isWideLayout(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(min-width: 760px)').matches;
  }

  /** Opening on a person, or the header 🌳's focusId: zoom to FOCUS_ZOOM, since
   *  the previous zoom (the whole tree, or whatever the last visit left) means
   *  nothing here — this is a fresh arrival, not a move within one visit. */
  function glideToPersonFocused(n: TreeRec) {
    if (!isPlaced(n)) return;
    glideTo({ x: n.x, y: n.y }, FOCUS_ZOOM, glideAnchor());
  }

  /** Tapping an ancestor in the card, or a relative walked to inside the
   *  sheet: glide to them at whatever zoom the tree is already at, per the
   *  plan — a walk along a line the user is already looking at shouldn't
   *  also change how far in they are. */
  function glideToPersonAtCurrentZoom(n: TreeRec) {
    if (!isPlaced(n)) return;
    glideTo({ x: n.x, y: n.y }, view.k, glideAnchor());
  }

  // ── History: back closes the tree, and the sheet on top of it ──────────
  // Same pattern as ParallelView, with one addition: a fresh marker per open
  // rather than a bare `true`. history.state survives a reload, and the app
  // reloads itself on resume after a deploy (App.svelte's controllerchange
  // handler) — with a bare boolean, an old tree's leftover entry from BEFORE
  // that reload would still satisfy "state has pbFamilyTree" the next time
  // the tree opens, so Back could land on the stale entry instead of closing,
  // and × would need two presses.
  const treeMark = Date.now() + Math.random();
  let treePushed = false;
  /** A fresh marker per sheet OPEN, not per component instance — the sheet
   *  can open, close and reopen many times across one tree visit. */
  let sheetMark = 0;
  let sheetPushed = false;

  /**
   * Close more than one level at once — ✕ Close while the sheet is open, and
   * the verse exit, both need this. Two `history.back()` calls issued in the
   * same task aren't guaranteed to actually move back twice in every browser,
   * so this sums how many entries were actually pushed (pushState can throw)
   * and moves back that many in one `history.go`. If neither push landed —
   * pushState blocked entirely — there's nothing on the stack to consume, so
   * this closes directly instead of asking history to move nowhere.
   */
  function closeEntries(n: number) {
    treePushed = false;
    sheetPushed = false;
    if (n > 0) {
      history.go(-n);
    } else {
      doClose();
    }
  }

  /** ✕ Close, or Escape, while the sheet is NOT open: back one level if that
   *  level exists, otherwise close directly. */
  function closeTreeOnly() {
    closeEntries(treePushed ? 1 : 0);
  }

  /** ✕ Close while the sheet IS open, or the verse exit: consume every
   *  entry this viewer actually pushed, tree and sheet together. */
  function closeTreeAndSheet() {
    closeEntries((treePushed ? 1 : 0) + (sheetPushed ? 1 : 0));
  }

  function closeViaHistory() {
    if (sheetOpen) {
      closeTreeAndSheet();
    } else {
      closeTreeOnly();
    }
  }

  /** The sheet's own ✕/Escape/Back: close the sheet, leave the tree. */
  function closeSheetOnly() {
    if (sheetPushed) {
      sheetPushed = false;
      history.back();
    } else {
      sheetOpen = false;
    }
  }

  function onPopState() {
    const state = history.state as { pbFamilyTree?: number; pbTreeSheet?: number } | null;
    if (state?.pbTreeSheet !== sheetMark) {
      // Either there was no sheet entry to begin with, or it's gone now —
      // either way the sheet itself must not still claim to be open.
      sheetPushed = false;
      sheetOpen = false;
    }
    if (state?.pbFamilyTree !== treeMark) {
      treePushed = false;
      doClose();
    }
  }

  /**
   * Every key is stopped here while the tree is open, not just Escape.
   *
   * Without this, focus can still be sitting on the 🌳 badge underneath the
   * tree the moment it opens: IndexList's .rows runs a type-to-jump handler
   * on keydown, so Enter or Space would fire that badge again, and the app's
   * global `j` shortcut would open a journal window underneath the tree. The
   * focus move on mount, below, is the real fix — this is the backstop for
   * whatever that move misses.
   */
  function onKeydownCapture(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (sheetOpen) closeSheetOnly();
      else closeViaHistory();
    }
  }

  let openerEl: HTMLElement | null = null;

  function doClose() {
    familyTreeStore.close();
  }

  // ── The bio sheet ──────────────────────────────────────────────────────
  let sheetOpen = false;
  let sheetPersonId: string | null = null;
  /** Bumped whenever the sheet should mount a FRESH PersonContent — a tree
   *  tap, an ancestor click on the pinned card, or opening Read bio itself.
   *  NOT bumped by onOpenPerson (walking a relative from inside the bio):
   *  that path only changes sheetPersonId, so the existing instance's own
   *  `trail` — the crumb openRelation just added — survives the switch
   *  instead of being thrown away by a remount's reset. */
  let sheetInstanceKey = 0;
  /** The tree's own label for whoever the sheet is showing, so its header
   *  has a name before PersonContent's own load resolves. */
  let sheetFallbackLabel = '';
  /** Set while the sheet shows a tribe's card rather than a bio. */
  let sheetTribe: string | null = null;

  function labelFor(id: string): string {
    return model?.nodes.get(id)?.label ?? model?.rootById.get(id)?.label ?? '';
  }

  /** Switch the sheet to a fresh person — a tree tap or an ancestor click —
   *  as opposed to a relative walked to from inside the bio, which uses
   *  switchSheetNoRemount instead. */
  function switchSheetFresh(id: string) {
    sheetTribe = null;
    sheetPersonId = id;
    sheetFallbackLabel = labelFor(id);
    sheetInstanceKey++;
  }

  /** onOpenPerson from inside the sheet: change the id only, so the running
   *  PersonContent instance keeps its own back trail. */
  function switchSheetNoRemount(id: string, name: string) {
    sheetPersonId = id;
    sheetFallbackLabel = name;
  }

  /**
   * Read bio, on the pinned card. Opens the sheet for that person, pushing
   * its own history entry on top of the tree's, and re-glides the pinned
   * person into the region the sheet now leaves uncovered — Phase 1's own
   * opening glide already centred them on the WHOLE screen, and the sheet
   * covering 62% of a phone means that earlier centring is now wrong.
   */
  function openReadBio() {
    if (!pinned) return;
    switchSheetFresh(pinned.id);
    openSheet();
    if (isPlaced(pinned)) glideTo({ x: pinned.x, y: pinned.y }, view.k, glideAnchor());
  }

  /** Raise the sheet with its own history entry — or, already up, leave it
   *  be and let the caller change what it shows. */
  function openSheet() {
    if (sheetOpen) return;
    sheetOpen = true;
    sheetMark = Date.now() + Math.random();
    try {
      history.pushState({ pbFamilyTree: treeMark, pbTreeSheet: sheetMark }, '');
      sheetPushed = true;
    } catch {
      sheetPushed = false;
    }
  }

  /** The tribe's card, in the sheet. */
  function openTribeCard(tribe: string) {
    sheetTribe = tribe;
    sheetInstanceKey++;
    openSheet();
  }

  /** A tap on the stone in the bio the sheet is showing: the tree lights that
   *  tribe behind the sheet, and the sheet turns to the tribe's card in place
   *  (no second history entry — Back still just drops the sheet). */
  function handleOpenTribeFromSheet(tribe: string, personId: string) {
    const rec = model?.nodes.get(personId) ?? model?.rootById.get(personId) ?? null;
    if (!lightTribe(tribe, rec)) return;
    openTribeCard(tribe);
    glideToLine(tribeFocus);
  }

  /** onOpenPerson: walking a relative from inside the bio. Switches the
   *  sheet to them without remounting it, and if they're also on the tree,
   *  traces, pins and glides to them too — keeping the two in step. */
  function handleOpenPerson(id: string, name: string) {
    switchSheetNoRemount(id, name);
    if (!model) return;
    const rec = model.nodes.get(id) ?? model.rootById.get(id);
    if (rec) {
      traceFrom(rec);
      startPulse();
      glideToPersonAtCurrentZoom(rec);
    }
  }

  /**
   * "See on the tree" tapped from inside the sheet: the sheet is already
   * open over the tree, so this closes it onto that person rather than
   * opening a second tree over the first.
   *
   * `sheetOpen` is set to false directly here, not left to the `popstate`
   * closeSheetOnly's `history.back()` will eventually raise — that event is
   * asynchronous, and the glide below reads `sheetOpen` (via glideAnchor)
   * synchronously, right now. Left to the popstate, the glide would aim at
   * the region still covered by a sheet that's already on its way out.
   */
  function handleShowOnTreeFromSheet(id: string) {
    closeSheetOnly();
    sheetOpen = false;
    if (!model) return;
    const rec = model.nodes.get(id) ?? model.rootById.get(id);
    if (rec) {
      traceFrom(rec);
      startPulse();
      glideToPersonAtCurrentZoom(rec);
    }
  }

  /**
   * The verse exit — a verse tapped inside the bio.
   *
   * `onLeave` is read off the store BEFORE anything closes: closing the tree
   * (step 2) nulls the store's state, so reading it after that would already
   * find nothing to call in step 3. `doClose()` is also called directly here,
   * not left to the `popstate` that `history.go` will eventually raise — that
   * event is asynchronous, and `leave()` (step 3) needs the store to already
   * be closed by the time it runs. Calling `familyTreeStore.close()` twice
   * (once here, once when that popstate lands) is harmless — it's a plain
   * `set` to the same empty state either time.
   */
  function handleVerseExit() {
    const leave = get(familyTreeStore).onLeave;
    closeTreeAndSheet();
    doClose();
    leave?.();
  }

  onDestroy(() => {
    if (openerEl && document.contains(openerEl)) {
      openerEl.focus({ preventScroll: true });
    }
  });

  /**
   * Data loading, kept out of `onMount` and never awaited there.
   *
   * `onMount` has to stay synchronous (see below), so this is called from it
   * without an `await` on the call itself. The `destroyed` flag guards every
   * step after an `await`: a component that unmounts mid-load must not go on
   * to set state on a component nobody's looking at, or worse, start a glide
   * that outlives it.
   */
  let destroyed = false;

  async function init() {
    try {
      const data = await loadFamilyTree();
      if (destroyed) return;
      model = layout(data);
      loading = false;
      ctx = canvas.getContext('2d');
      if (!ctx) {
        errored = true;
        return;
      }
      // Measure and fit BEFORE the first redraw — drawing at the stale
      // default view (0,0,k:1) first would flash one wrong frame.
      measure();
      const fit = fitView(model, W, H);
      fittedK = fit.k;
      markViewFitted(fit);
      redraw();

      const focusId = $familyTreeStore.focusId;
      const target = focusId ? (model.nodes.get(focusId) ?? model.rootById.get(focusId)) : null;
      const tribe = $familyTreeStore.tribe;
      if (tribe && lightTribe(tribe, target)) {
        glideToLine(tribeFocus);
        // A beat to see the tribe light up before its card slides over it.
        setTimeout(
          () => {
            if (!destroyed && tribeLit === tribe && !sheetOpen) openTribeCard(tribe);
          },
          REDUCED_MOTION ? 0 : 650,
        );
      } else if (target && isPlaced(target)) {
        traceFrom(target);
        startPulse();
        // So the user sees where the whole tree is before zooming to them —
        // the glide starts from the fitted view rather than jumping straight in.
        glideToPersonFocused(target);
      }

      document.fonts
        ?.load('600 14px Milonga')
        .catch(() => {
          // Font failed to load — labels stay in the fallback face. Not fatal.
        })
        .then(() => {
          if (!destroyed) redraw();
        });
    } catch {
      if (!destroyed) {
        loading = false;
        errored = true;
      }
    }
  }

  // ── Gestures ─────────────────────────────────────────────────────────────
  // Modelled on ArtViewer, not the lab: the lab has no pinch-to-zoom-and-pan-
  // together (it treats a pinch as zoom-only) and no tap discrimination
  // against a drag. The listeners go on the canvas itself, not on any
  // ancestor that also holds the chrome — a card, sheet or button inside the
  // listening element would fight its own scrolling against the pan, and a
  // wheel over it would zoom the tree underneath instead of scrolling it.
  type Pt = { x: number; y: number };
  const pointers = new Map<number, Pt>();
  let dragLast: Pt | null = null;
  let pinchDist = 0;
  let pinchMid: Pt = { x: 0, y: 0 };
  let downPos: Pt = { x: 0, y: 0 };
  let moved = false;
  let multiTouched = false;
  let gestured = false;

  function toLocal(e: PointerEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function clampZoom(k: number): number {
    return Math.max(minZoom, Math.min(MAX_ZOOM, k));
  }

  function onPointerDown(e: PointerEvent) {
    // Mouse hover uses pointermove with no pointer down at all (below); a
    // mouse button press should still only ever mean the primary button.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelGlide();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toLocal(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      dragLast = null;
      multiTouched = true;
      return;
    }
    dragLast = toLocal(e);
    downPos = { x: e.clientX, y: e.clientY };
    moved = false;
    multiTouched = false;
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) {
      // No button down. ArtViewer returns immediately here — a photo viewer
      // has no use for hover — but the tree's hover card needs exactly this
      // moment: a mouse move with nothing pressed, nobody pinned.
      if (e.pointerType === 'mouse' && !pinned && model) {
        const p = toLocal(e);
        const n = pick(model, view, W, H, p.x, p.y, 14);
        if (n !== hovered) hovered = n;
      }
      return;
    }
    pointers.set(e.pointerId, toLocal(e));
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) moved = true;

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Two fingers pan and zoom together about their midpoint.
      markViewMoved();
      view = { ...view, x: view.x + (mid.x - pinchMid.x), y: view.y + (mid.y - pinchMid.y) };
      if (pinchDist > 0 && dist > 0) {
        const before = toWorld(mid.x, mid.y, view, W, H);
        view.k = clampZoom(view.k * (dist / pinchDist));
        const after = toWorld(mid.x, mid.y, view, W, H);
        view.x += (after.x - before.x) * view.k;
        view.y += (after.y - before.y) * view.k;
      }
      pinchDist = dist;
      pinchMid = mid;
      redraw();
      return;
    }

    if (dragLast) {
      const p = toLocal(e);
      markViewMoved();
      view = { ...view, x: view.x + (p.x - dragLast.x), y: view.y + (p.y - dragLast.y) };
      dragLast = p;
      redraw();
    }
  }

  /**
   * A tap: a pointerup that moved 8px or less and never had a second finger.
   * No time limit — a slow, deliberate press should still count as a tap,
   * and this is what discriminates it from a drag, not the clock.
   */
  function endGesture(hadOneFinger: boolean) {
    if (hadOneFinger && !moved && !multiTouched) {
      handleTap(downPos);
    }
    gestured = true;
  }

  function onPointerUp(e: PointerEvent) {
    const wasSingle = pointers.size === 1 && !multiTouched;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pointers.size === 1) {
      // Lifting one finger of a pinch: re-seat the drag on the survivor so
      // the tree doesn't lurch by the distance between the two fingers.
      const [only] = [...pointers.values()];
      dragLast = { ...only };
      pinchDist = 0;
    } else if (pointers.size === 0) {
      dragLast = null;
      endGesture(wasSingle);
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragLast = null;
  }

  function handleTap(screen: Pt) {
    if (!model) return;
    const radius = TOUCH ? 22 : 14;
    const n = pick(model, view, W, H, screen.x, screen.y, radius);
    if (n) {
      traceFrom(n);
      startPulse();
      // The sheet follows the tree, not the other way round — a tap on the
      // tree while the sheet is open switches the sheet to whoever was just
      // tapped, the same as tapping their line-item inside the bio does.
      if (sheetOpen) switchSheetFresh(n.id);
    } else if (!sheetOpen) {
      // Tapping empty ground does nothing while the sheet is open — with a
      // person already pinned in the sheet, clearing the tree's own
      // selection here would put the two out of step for no reason.
      clearSelection();
      stopPulseIfIdle();
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    cancelGlide();
    markViewMoved();
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const before = toWorld(cx, cy, view, W, H);
    view.k = clampZoom(view.k * Math.exp(-e.deltaY * 0.0015));
    const after = toWorld(cx, cy, view, W, H);
    view.x += (after.x - before.x) * view.k;
    view.y += (after.y - before.y) * view.k;
    redraw();
  }

  function blockGesture(e: Event) {
    e.preventDefault();
  }

  /**
   * Synchronous, like ArtViewer's own onMount.
   *
   * Every listener — canvas, window, popstate, visualViewport — is attached
   * and the cleanup function returned before any `await` runs. PersonContent
   * uses an async onMount, but that pattern doesn't fit here: if the cleanup
   * were returned from an async function, Svelte never runs it, and the
   * capture-phase keydown listener below would outlive the component and
   * keep swallowing every keystroke everywhere else in the app. Data loading
   * is kicked off at the end, into `init()`, without being awaited here.
   */
  onMount(() => {
    openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    try {
      history.pushState({ pbFamilyTree: treeMark }, '');
      treePushed = true;
    } catch {
      // × and Escape still close it; only the phone's Back is affected.
    }

    const opts: AddEventListenerOptions = { passive: false };
    canvas.addEventListener('pointerdown', onPointerDown, opts);
    canvas.addEventListener('pointermove', onPointerMove, opts);
    canvas.addEventListener('pointerup', onPointerUp, opts);
    canvas.addEventListener('pointercancel', onPointerCancel, opts);
    canvas.addEventListener('wheel', onWheel, opts);
    // iOS Safari ignores user-scalable=no, so its own pinch has to be blocked
    // explicitly or it fights the tree's own two-finger zoom.
    canvas.addEventListener('gesturestart', blockGesture, opts);
    canvas.addEventListener('gesturechange', blockGesture, opts);
    canvas.addEventListener('gestureend', blockGesture, opts);

    window.addEventListener('keydown', onKeydownCapture, true);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);

    // Without this, focus stays on whatever opened the tree — the 🌳 badge
    // underneath it, or the header button — and the capture-phase keydown
    // above is the only thing standing between that and the leaks it guards.
    closeBtnEl?.focus({ preventScroll: true });

    init();

    return () => {
      destroyed = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;

      canvas.removeEventListener('pointerdown', onPointerDown, opts);
      canvas.removeEventListener('pointermove', onPointerMove, opts);
      canvas.removeEventListener('pointerup', onPointerUp, opts);
      canvas.removeEventListener('pointercancel', onPointerCancel, opts);
      canvas.removeEventListener('wheel', onWheel, opts);
      canvas.removeEventListener('gesturestart', blockGesture, opts);
      canvas.removeEventListener('gesturechange', blockGesture, opts);
      canvas.removeEventListener('gestureend', blockGesture, opts);

      window.removeEventListener('keydown', onKeydownCapture, true);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  });

  $: hintText = TOUCH ? '· Back to return' : '· Esc to return';
</script>

<svelte:window on:popstate={onPopState} />

<div
  class="family-tree no-edge-gesture"
  use:portal
  bind:this={rootEl}
  role="dialog"
  aria-modal="true"
  aria-label="Family tree"
>
  <canvas bind:this={canvas}></canvas>

  {#if loading}
    <div class="viewer-state">Loading the tree…</div>
  {:else if errored}
    <div class="viewer-state">Couldn’t load the family tree.</div>
  {/if}

  {#if model}
    <div class="controls-top">
      <button class="tree-btn" on:click={glideToWhole}>Whole tree</button>
      <button class="tree-btn toggle" class:on={allNames} aria-pressed={allNames} on:click={toggleAllNames}>
        All names
      </button>
    </div>
    <button class="close-btn" bind:this={closeBtnEl} on:click={closeViaHistory} aria-label="Close family tree">
      ✕ Close
    </button>

    <!-- The tree card hides while the sheet is open — with a person already
         pinned in the sheet's own header, a second card naming them is
         redundant, and covering part of the tree it belongs to. -->
    {#if !sheetOpen}
      {#if tribeLit}
        <!-- The way back to the tribe's card once it has been put away. -->
        <button
          class="tree-btn tribe-chip"
          on:click={() => {
            if (!tribeLit) return;
            openTribeCard(tribeLit);
            glideToLine(tribeFocus);
          }}
        >
          About the tribe of {tribeLit}
        </button>
      {:else if pinned}
        <FamilyTreeCard
          {model}
          person={pinned}
          pinned={true}
          onTraceAncestor={(rec: TreeRec) => {
            traceFrom(rec);
            startPulse();
            glideToPersonAtCurrentZoom(rec);
          }}
          onReadBio={openReadBio}
        />
      {:else if hovered}
        <FamilyTreeCard {model} person={hovered} pinned={false} />
      {/if}
    {/if}

    <div class="bottom-stack" class:faded={gestured}>
      <div class="hint">
        Drag to pan · Tap a person to trace their line · Pinch or scroll to zoom {hintText}
      </div>
    </div>
    <div class="attrib">{model.attribution}</div>

    {#if sheetOpen && (sheetPersonId || sheetTribe)}
      <FamilyTreeBioSheet
        personId={sheetPersonId}
        tribe={sheetTribe}
        onOpenTribe={handleOpenTribeFromSheet}
        instanceKey={sheetInstanceKey}
        fallbackLabel={sheetFallbackLabel}
        onOpenPerson={handleOpenPerson}
        onShowOnTree={handleShowOnTreeFromSheet}
        onClose={handleVerseExit}
        onBackToTree={closeSheetOnly}
      />
    {/if}
  {/if}
</div>

<style>
  .family-tree {
    position: fixed;
    inset: 0;
    z-index: 10040;
    background: #000;
    overscroll-behavior: contain;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
  }

  .viewer-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #8a8a8a;
    font-size: 15px;
    pointer-events: none;
  }

  .controls-top {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    left: calc(env(safe-area-inset-left, 0px) + 12px);
    display: flex;
    gap: 8px;
  }

  .tree-btn {
    background: rgba(13, 12, 11, 0.72);
    border: 1px solid #3a342a;
    color: #cdbfa8;
    border-radius: 7px;
    padding: 7px 12px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .tree-btn:hover {
    background: rgba(28, 25, 22, 0.85);
    color: #e8dcc8;
  }
  .tree-btn.toggle.on {
    border-color: #6b5d3a;
    color: #e8dcc8;
    background: rgba(44, 40, 32, 0.85);
  }

  .tribe-chip {
    position: absolute;
    /* Where the person card sits, below ✕ Close. */
    top: calc(env(safe-area-inset-top, 0px) + 58px);
    right: calc(env(safe-area-inset-right, 0px) + 12px);
  }

  .close-btn {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    background: rgba(0, 0, 0, 0.55);
    border: none;
    border-radius: 20px;
    color: #f2f2f2;
    font-size: 13px;
    font-family: inherit;
    padding: 8px 14px;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .close-btn:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  /* Stacked above the attribution rather than side by side: on a phone the
     attribution below runs full width, and a bottom-centre hint beside it
     would collide with it rather than clear it. */
  .bottom-stack {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 34px);
    transition: opacity 0.6s ease;
  }
  .bottom-stack.faded {
    opacity: 0;
  }

  .hint {
    text-align: center;
    font-size: 11px;
    color: #6b6153;
    pointer-events: none;
  }

  .attrib {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
    font-size: 10px;
    color: #4a443c;
    max-width: 380px;
    line-height: 1.5;
    pointer-events: none;
  }

  @media (max-width: 480px) {
    .attrib {
      max-width: none;
      font-size: 9.5px;
    }
  }
</style>
