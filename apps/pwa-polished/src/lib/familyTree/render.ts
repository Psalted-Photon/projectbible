/**
 * Drawing the tree onto a canvas.
 *
 * Ported line for line from the lab's draw functions — colours, sizes, alphas
 * and fonts are unchanged, because the user has signed off this look at every
 * zoom. What changed is mechanical: the lab's module-level globals (ctx, W,
 * H, view, OPTS, selectedTribe, ...) become one `RenderState` argument, since
 * this runs inside a component rather than as a whole page's script. Every
 * `OPTS` check is gone — the dials are gone, so every "Show" toggle the lab
 * had is simply always on — except `allNames`, the one new option, which the
 * user asked to keep as a toggle.
 */

import { isPlaced, type Placed, type TreeModel, type TreeRec } from './layout';
import {
  GOD_ID,
  GOLD,
  LABEL_FULL_PX,
  LABEL_MIN_PX,
  LINEN,
  ROOT_COLOURS,
  ROSE,
  ROSE_LIT,
  STONES,
  TREE,
} from './config';

/** The view transform: pan in screen px, plus zoom. */
export interface View {
  x: number;
  y: number;
  k: number;
}

/** Everything a frame needs that isn't the model itself. */
export interface RenderState {
  ctx: CanvasRenderingContext2D;
  /** CSS pixels — the canvas element itself is W*DPR by H*DPR, and `draw`
   *  applies that scale itself so nothing else has to think in device px. */
  W: number;
  H: number;
  DPR: number;
  view: View;
  model: TreeModel;
  tracedPath: Set<string> | null;
  selectedTribe: string | null;
  pinnedId: string | null;
  /** 0..1, the pinned node's breathing phase. Fixed at 1 under reduced motion. */
  pulsePhase: number;
  /** The one addition beyond the lab: name every dot, not just the bough heads. */
  allNames: boolean;
}

/**
 * The tree's origin — the trunk top, i.e. Jacob — is always drawn at this
 * fraction of the canvas, not at its centre, so there is room above it for
 * the canopy and below it for the roots to run out toward.
 */
const ORIGIN_Y_FRAC = 0.62;

/**
 * World point (px, py) at screen point (cx, cy), at zoom k, in a canvas of
 * size W×H. Every glide, the fit, and every "jump to this person" click go
 * through this one formula, so they can never disagree about where the
 * origin sits.
 */
export function viewFor(px: number, py: number, k: number, cx: number, cy: number, W: number, H: number): View {
  return {
    x: cx - W / 2 - px * k,
    y: cy - H * ORIGIN_Y_FRAC - py * k,
    k,
  };
}

/** World point under a screen point, given the current view. */
export function toWorld(cx: number, cy: number, view: View, W: number, H: number): { x: number; y: number } {
  return {
    x: (cx - W / 2 - view.x) / view.k,
    y: (cy - H * ORIGIN_Y_FRAC - view.y) / view.k,
  };
}

/**
 * Frame the whole tree — roots, trunk and canopy — in a W×H box.
 *
 * `pad` is asymmetric on all three distinct edges: more room at the top,
 * where the canopy's own labels stick up above the highest node, than on the
 * sides; and the bottom needs enough to clear the hint line stacked above the
 * attribution text, which the sides don't have to make room for at all.
 */
export function fitView(
  model: TreeModel,
  W: number,
  H: number,
  pad: { top: number; bottom: number; side: number } = { top: 64, bottom: 60, side: 34 },
): View {
  const { minX, maxX, minY, maxY } = model.bounds;
  const k = Math.min((W - pad.side * 2) / (maxX - minX || 1), (H - pad.top - pad.bottom) / (maxY - minY || 1));
  const clampedK = Math.max(0.02, Math.min(9, k));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  // Centre the box's midpoint on the padded area's midpoint. The padded
  // area's own centre is offset from the canvas centre by half the
  // top/bottom pad difference.
  const areaCy = (pad.top + (H - pad.bottom)) / 2;
  return viewFor(midX, midY, clampedK, W / 2, areaCy, W, H);
}

/** Whether a world point, at the current view, lands inside the canvas at all. */
function onScreen(x: number, y: number, view: View, W: number, H: number): boolean {
  const sx = W / 2 + view.x + x * view.k;
  const sy = H * ORIGIN_Y_FRAC + view.y + y * view.k;
  return sx >= -20 && sx <= W + 20 && sy >= -20 && sy <= H + 20;
}

function isLit(tracedPath: Set<string> | null, selectedTribe: string | null, n: TreeRec): boolean {
  if (tracedPath) return tracedPath.has(n.id);
  if (!selectedTribe) return true;
  return n.tribe === selectedTribe;
}

// ── The whole frame ────────────────────────────────────────────────────────

export function draw(s: RenderState): void {
  const { ctx, W, H, view } = s;
  // The canvas backing store is W*DPR by H*DPR (see the viewer's `measure`),
  // so drawing in the CSS-pixel W/H used everywhere else needs this scale
  // applied first — exactly what the lab's own draw() does with its module-
  // level DPR.
  ctx.setTransform(s.DPR, 0, 0, s.DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Ground. The lab's drawWind — faint moving lines over this — is left out
  // by request; the ground gradient alone stands in for it.
  const g = ctx.createRadialGradient(W / 2, H * ORIGIN_Y_FRAC, 0, W / 2, H * ORIGIN_Y_FRAC, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#16130f');
  g.addColorStop(1, '#0a0908');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2 + view.x, H * ORIGIN_Y_FRAC + view.y);
  ctx.scale(view.k, view.k);

  const dimming = !!(s.selectedTribe || s.tracedPath);

  drawRoots(s, dimming);
  drawTrunk(s, dimming);

  // Dim boughs first so lit ones sit over them.
  for (const pass of [0, 1]) {
    for (const [tribe, list] of s.model.byTribe) {
      const lit = !dimming || (s.tracedPath ? list.some((n) => isLit(s.tracedPath, s.selectedTribe, n)) : tribe === s.selectedTribe);
      if ((pass === 0) === lit) continue;
      drawBough(s, tribe, list, lit, dimming);
    }
  }

  drawCrown(s, dimming);

  ctx.restore();

  drawGrain(s);
}

/** Deterministic hash, the same one layout.ts uses for jitter — reused here
 *  purely to seed the grain speckle so it doesn't shimmer between frames. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function drawGrain(s: RenderState): void {
  const { ctx, W, H } = s;
  // Cheap paper grain: a sparse speckle, drawn once over the whole frame.
  ctx.save();
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = '#d8c9a8';
  for (let i = 0; i < 1400; i++) {
    const x = (hash('gx' + i) * W) | 0;
    const y = (hash('gy' + i) * H) | 0;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawRoots(s: RenderState, dimming: boolean): void {
  const { ctx, model, tracedPath, pinnedId, pulsePhase } = s;
  if (!model.rootNodes.length) return;
  ctx.save();
  ctx.lineCap = 'round';

  // A traced line lights the root nodes on it. Selecting a bough with no
  // trace says nothing about who down here belongs to it, so the whole root
  // mat dims together rather than half of it staying bright for no reason.
  const onOf = (n: TreeRec) => (tracedPath ? tracedPath.has(n.id) : !dimming);

  // The trunk's own segments are left to drawTrunk, which strokes the whole
  // God-to-Jacob run as one thick line. Drawing them here as well would put a
  // thin twig alongside it, bowing the other way at every joint.
  const onSpine = new Set(model.spineChain.map((n) => n.id));

  // Branches first, so the dots sit on top of the lines.
  for (const n of model.rootNodes) {
    if (onSpine.has(n.id) && n.father && onSpine.has(n.father)) continue;
    const col = ROOT_COLOURS[n.branch || 'Trunk'] || ROOT_COLOURS.Trunk;
    const on = onOf(n);
    ctx.globalAlpha = dimming ? (on ? 0.9 : TREE.dimLevel) : 0.85;
    const parent = n.father ? model.rootById.get(n.father) : undefined;
    if (!parent || !isPlaced(parent)) continue;
    ctx.strokeStyle = on && dimming ? col.lit : col.c;
    // Roots thicken as they go down, the opposite of a bough tapering up.
    ctx.lineWidth = Math.max(0.2, TREE.thickness * 1.3 * (1 - Math.min(0.6, (n.depth ?? 0) / 30)));
    ctx.beginPath();
    ctx.moveTo(parent.x, parent.y);
    const mx = (parent.x + n.x) / 2;
    const my = (parent.y + n.y) / 2;
    const dx = n.x - parent.x;
    const dy = n.y - parent.y;
    ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, n.x, n.y);
    ctx.stroke();
  }

  // Nodes.
  for (const n of model.rootNodes) {
    const col = ROOT_COLOURS[n.branch || 'Trunk'] || ROOT_COLOURS.Trunk;
    const on = onOf(n);
    ctx.globalAlpha = dimming && !on ? TREE.dimLevel : 1;
    // God is the base the whole tree stands on, so he is the largest thing
    // down here and the only gold one.
    const isGod = n.id === GOD_ID;
    let size = TREE.nodeSize * (isGod ? 2.4 : n.kids.length ? 1.05 : 0.75);
    const isPinned = pinnedId === n.id;
    // A slow pulse on radius and glow, so it is obvious which of 852 dots
    // the card belongs to. 0.22 is the swing either side of the resting size.
    if (isPinned) size *= 1 + pulsePhase * 0.22;
    if (on && !dimming && TREE.glow > 0) {
      ctx.shadowColor = col.lit;
      ctx.shadowBlur = (isPinned ? 9 + pulsePhase * 10 : 9) * TREE.glow;
    } else if (isPinned) {
      ctx.shadowColor = col.lit;
      ctx.shadowBlur = pulsePhase * 10 * TREE.glow;
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
    ctx.fillStyle = isGod ? GOLD : on && dimming ? col.lit : col.c;
    ctx.fill();
    ctx.shadowBlur = 0;
    // A wife is drawn in rose. Without it she is a bare first name floating
    // beside a man, with no way to tell a wife from a daughter.
    if (n.spouseOf) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
      ctx.fillStyle = on && !dimming ? ROSE_LIT : ROSE;
      ctx.fill();
    }

    // A ring marks the women, so they are findable without reading every
    // label. Distinct from the rose above: six women here are nobody's wife.
    if (n.female && size > 1.2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(0.4, size * 0.22);
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + Math.max(1, size * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Labels. Every pre-Jacob node is named — that is the point of the roots
  // being filled in at all — so this one is unconditional, unlike the
  // canopy's bough labels below which the `allNames` toggle gates.
  ctx.textAlign = 'center';
  for (const n of model.rootNodes) {
    const on = onOf(n);
    const isGod = n.id === GOD_ID;
    ctx.globalAlpha = dimming && !on ? TREE.dimLevel + 0.1 : isGod ? 1 : 0.82;
    // Each label in its own bough's colour, so a name can be followed back
    // to the line it belongs to without tracing the branch by eye.
    const lc = ROOT_COLOURS[n.branch || 'Trunk'] || ROOT_COLOURS.Trunk;
    ctx.fillStyle = isGod ? GOLD : on ? lc.lit : lc.c;
    ctx.font = isGod ? '600 16px Milonga, serif' : '10.5px Milonga, serif';
    ctx.fillText(n.label, n.x, n.y + (isGod ? 26 : 13));
  }
  ctx.restore();
}

function drawTrunk(s: RenderState, dimming: boolean): void {
  const { ctx, model } = s;
  ctx.save();
  ctx.globalAlpha = dimming ? TREE.dimLevel + 0.1 : 0.9;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = TREE.thickness * 3.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The whole trunk, God through to Jacob, as one unbroken stroke.
  // spineChain runs Jacob -> God, so it is walked backwards to grow upward.
  const run = model.spineChain.filter(isPlaced);
  if (run.length > 1) {
    ctx.beginPath();
    ctx.moveTo(run[run.length - 1].x, run[run.length - 1].y);
    for (let i = run.length - 2; i >= 0; i--) {
      const from = run[i + 1];
      const to = run[i];
      // The same slight bow the branches use, so the trunk sits in the same
      // hand as everything growing off it.
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, to.x, to.y);
    }
    ctx.stroke();
  } else {
    // No roots loaded — keep the short stub so the canopy is not left
    // floating. (Roots always ship with the tree, so this is a defensive
    // fallback rather than a reachable state.)
    ctx.beginPath();
    ctx.moveTo(0, TREE.trunkLen * 0.25);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, TREE.nodeSize * 2.4, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.fillStyle = '#e8dcc8';
  ctx.font = '600 14px Milonga, serif';
  ctx.textAlign = 'center';
  ctx.fillText('Jacob', 0, 22);
  ctx.restore();
}

function drawBough(s: RenderState, tribe: string, list: TreeRec[], lit: boolean, dimming: boolean): void {
  const { ctx, model, tracedPath, pinnedId, pulsePhase, allNames, view, W, H } = s;
  const st = STONES[tribe] || { stone: '', c: LINEN, lit: '#8f8674' };
  const col = lit ? st.lit : st.c;
  ctx.save();
  ctx.globalAlpha = dimming && !lit ? TREE.dimLevel : 1;

  // Branches
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  for (const n of list) {
    if (!isPlaced(n)) continue;
    const parentRec = n.father ? model.nodes.get(n.father) : undefined;
    const from: { x: number; y: number } = parentRec && isPlaced(parentRec) ? parentRec : { x: 0, y: 0 };
    if (tracedPath && dimming) {
      ctx.globalAlpha = tracedPath.has(n.id) ? 1 : TREE.dimLevel;
    }
    // Thinner as it climbs, so the silhouette tapers like a tree.
    ctx.lineWidth = Math.max(0.35, TREE.thickness * (1 - Math.min(0.75, (n.depth ?? 0) / 14)));
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    // A slight curve reads as growth rather than as a spoke diagram.
    const mx = (from.x + n.x) / 2;
    const my = (from.y + n.y) / 2;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, n.x, n.y);
    ctx.stroke();
  }

  // Nodes
  for (const n of list) {
    if (!isPlaced(n)) continue;
    const on = !tracedPath || tracedPath.has(n.id);
    ctx.globalAlpha = dimming && !lit ? TREE.dimLevel : on ? 1 : TREE.dimLevel;
    let size = TREE.nodeSize * ((n.depth ?? 0) === 0 ? 2.1 : n.kids.length ? 1.15 : 0.8);
    const isPinned = pinnedId === n.id;
    // A slow pulse on radius and glow, so it is obvious which of 852 dots
    // the card belongs to.
    if (isPinned) size *= 1 + pulsePhase * 0.22;

    if (lit && on && TREE.glow > 0) {
      ctx.shadowColor = st.lit;
      ctx.shadowBlur = (isPinned ? 11 + pulsePhase * 12 : 11) * TREE.glow;
    } else if (isPinned) {
      ctx.shadowColor = st.lit;
      ctx.shadowBlur = pulsePhase * 12 * TREE.glow;
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Stripes and speckles keep colours apart for anyone who cannot separate
    // them by hue — and every node can be labelled, so colour is never alone.
    if (st.striped && size > 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(n.x - size, n.y);
      ctx.lineTo(n.x + size, n.y);
      ctx.stroke();
    }
    if (st.speckled && size > 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(n.x - size * 0.4, n.y - size * 0.3, 0.9, 0.9);
      ctx.fillRect(n.x + size * 0.2, n.y + size * 0.25, 0.9, 0.9);
    }
  }

  // The son of Jacob names the bough — unchanged from the lab, at every zoom.
  const head = list[0];
  if (head && isPlaced(head)) {
    ctx.globalAlpha = dimming && !lit ? TREE.dimLevel + 0.15 : 1;
    // The tribe name in its own stone's colour, so the label and the bough
    // it heads read as one thing. Dimmed boughs keep the duller stone rather
    // than a flat grey, which also keeps the twelve distinguishable while
    // dimmed.
    ctx.fillStyle = lit ? st.lit : st.c;
    ctx.font = '600 13px Milonga, serif';
    ctx.textAlign = 'center';
    ctx.fillText(tribe, head.x, head.y - 11);
    // Dinah has no STONES entry (she's a bough of one, not a tribe — see
    // config.ts), so st.stone falls through to the LINEN fallback's empty
    // string here. Guarded explicitly rather than relying on fillText('')
    // drawing nothing, since that's true by accident of the fallback's
    // shape, not by anything that says so.
    if (lit && st.stone) {
      ctx.font = '9.5px -apple-system, sans-serif';
      ctx.fillStyle = st.lit;
      ctx.globalAlpha = 0.75;
      ctx.fillText(st.stone, head.x, head.y - 23);
    }
  }

  // The one addition beyond the lab: every OTHER dot in the bough, named too,
  // once "All names" is on. The head is skipped — he already has his label
  // above — and so is anyone the lab already draws unconditionally, so this
  // never doubles a name that was already on screen.
  if (allNames) {
    ctx.font = '10.5px Milonga, serif';
    ctx.textAlign = 'center';
    for (let i = 1; i < list.length; i++) {
      const n = list[i];
      if (!isPlaced(n)) continue;
      // Off-screen nodes are skipped so 665 extra names stay cheap while the
      // breathing pulse redraws every frame.
      if (!onScreen(n.x, n.y, view, W, H)) continue;
      // Readable only: skip below LABEL_MIN_PX, fade in up to LABEL_FULL_PX,
      // exactly as the lab's own root and tribe labels are always full-size —
      // this is the new part, so it is the one label with a size floor.
      const screenPx = 10.5 * view.k;
      if (screenPx < LABEL_MIN_PX) continue;
      const fade = Math.min(1, (screenPx - LABEL_MIN_PX) / (LABEL_FULL_PX - LABEL_MIN_PX));
      const on = !tracedPath || tracedPath.has(n.id);
      const base = dimming && !lit ? TREE.dimLevel : on ? 0.82 : TREE.dimLevel;
      ctx.globalAlpha = base * fade;
      ctx.fillStyle = lit ? st.lit : st.c;
      ctx.fillText(n.label, n.x, n.y + 13);
    }
  }
  ctx.restore();
}

function drawCrown(s: RenderState, dimming: boolean): void {
  const { ctx, model } = s;
  const lines: { pts: Placed[]; col: string; name: string }[] = [
    { pts: model.crownM, col: '#d9c7a0', name: 'Matthew' },
    { pts: model.crownL, col: '#9fb8c9', name: 'Luke' },
  ];
  ctx.save();
  for (const l of lines) {
    if (l.pts.length < 2) continue;
    ctx.globalAlpha = dimming ? TREE.dimLevel + 0.12 : 0.6;
    ctx.strokeStyle = l.col;
    ctx.lineWidth = TREE.thickness * 1.1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    l.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const end = l.pts[l.pts.length - 1];
    ctx.fillStyle = l.col;
    ctx.font = '10.5px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(l.name, end.x, end.y - 9);
  }
  ctx.restore();
}

// ── Picking ──────────────────────────────────────────────────────────────

/**
 * The nearest person to a screen point, within `radiusPx` screen pixels.
 *
 * Takes only the view and the model, not a whole RenderState — picking never
 * touches the canvas context, and a caller doing this on every pointermove
 * for a hover shouldn't have to manufacture one just to satisfy the type.
 *
 * The roots are always drawn (there is no "Show roots" toggle any more), so
 * they are always pickable, Jacob included — he is drawn as the trunk top
 * rather than as a root dot, but he is still a real person to tap.
 */
export function pick(model: TreeModel, view: View, W: number, H: number, cx: number, cy: number, radiusPx: number): TreeRec | null {
  const p = toWorld(cx, cy, view, W, H);
  let best: TreeRec | null = null;
  let bestD = radiusPx / view.k;
  for (const n of model.nodes.values()) {
    if (!isPlaced(n)) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  // Jacob is held out of rootNodes (he's drawn by drawTrunk, not as an
  // ordinary root dot), so he has to be added back in by hand here, exactly
  // as the lab does — otherwise he's the one person on the tree nobody can
  // tap.
  const jacob = model.rootById.get(model.jacobId);
  const pickable: Placed[] = jacob && isPlaced(jacob) ? [...model.rootNodes, jacob] : model.rootNodes;
  for (const n of pickable) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}
