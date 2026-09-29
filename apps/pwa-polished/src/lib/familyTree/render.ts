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

import { isPlaced, treeLabel, type Placed, type TreeModel, type TreeRec } from './layout';
import {
  BRONZE,
  GOD_ID,
  GOLD,
  LABEL_FULL_PX,
  LABEL_MIN_PX,
  LABEL_OUTLINE,
  LINEN,
  LINEN_LIT,
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
  /**
   * Each person's light while an animation drives it (motion.ts Wave): 0 is
   * their off look, 1 their lit look, above 1 a flash of extra glow. Every
   * person has an entry, plus CROWN_LIGHT for the Matthew and Luke lines.
   * Null or absent draws the plain on/off from tracedPath and selectedTribe.
   */
  light?: Map<string, number> | null;
  /** How bright a person at light 0 is, as an alpha. TREE.dimLevel is the
   *  ordinary dimmed look; 0 is not there at all. Light mode only. */
  lightFloor?: number;
}

/** The Matthew and Luke crown lines' key in RenderState.light. */
export const CROWN_LIGHT = '#crown';

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

/** Screen point of a world point, given the current view — toWorld reversed. */
export function toScreen(x: number, y: number, view: View, W: number, H: number): { x: number; y: number } {
  return {
    x: W / 2 + view.x + x * view.k,
    y: H * ORIGIN_Y_FRAC + view.y + y * view.k,
  };
}

/** Whether a world point, at the current view, lands inside the canvas at all. */
function onScreen(x: number, y: number, view: View, W: number, H: number): boolean {
  const p = toScreen(x, y, view, W, H);
  return p.x >= -20 && p.x <= W + 20 && p.y >= -20 && p.y <= H + 20;
}

function isLit(tracedPath: Set<string> | null, selectedTribe: string | null, n: TreeRec): boolean {
  if (tracedPath) return tracedPath.has(n.id);
  if (!selectedTribe) return true;
  return n.tribe === selectedTribe;
}

// ── Light ────────────────────────────────────────────────────────────────
// Every element is drawn from one number, its light L: 0 off, 1 on. Without
// an animation L is just on or off, and the formulas below give exactly the
// alphas and colours the tree has always had. With one, L runs in between.

/** A person's light: the animation's when one is running, else on/off. */
function lightOf(s: RenderState, id: string, on: boolean): number {
  return s.light ? (s.light.get(id) ?? 0) : on ? 1 : 0;
}

/** An alpha between `off` (a dimmed alpha, scaled down to the animation's
 *  floor) and `on`. */
function lerpAlpha(s: RenderState, off: number, on: number, L: number): number {
  const lo = s.light ? off * ((s.lightFloor ?? TREE.dimLevel) / TREE.dimLevel) : off;
  return lo + (on - lo) * Math.min(1, L);
}

/** Glow strength for a light: the lit glow, plus a flash above 1. */
function glowOf(L: number, lit: boolean): number {
  return (lit ? Math.min(1, L) : 0) + Math.max(0, L - 1) * 2;
}

const mixCache = new Map<string, string>();

/** Hex colour a, t of the way to b. Exactly a at 0 and b at 1. */
function mix(a: string, b: string, t: number): string {
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  const q = Math.round(t * 32);
  const key = a + b + q;
  let out = mixCache.get(key);
  if (!out) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const f = q / 32;
    const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * f);
    out = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
    mixCache.set(key, out);
  }
  return out;
}

/**
 * The colour a person's dot is when lit. The drawing and the landing burst
 * both read it, so a burst always goes off in the colour of the dot it
 * lands on.
 */
export function litColourOf(model: TreeModel, rec: TreeRec): string {
  if (rec.id === GOD_ID || rec.id === model.jesusId) return GOLD;
  if (rec.id === model.jacobId) return BRONZE;
  if (rec.root) {
    if (rec.spouseOf) return ROSE_LIT;
    return (ROOT_COLOURS[rec.branch || 'Trunk'] || ROOT_COLOURS.Trunk).lit;
  }
  return STONES[rec.tribe || '']?.lit ?? LINEN_LIT;
}

// ── Names ────────────────────────────────────────────────────────────────
// Every name is queued while the dots are drawn and painted in one pass at
// the end of the frame, dim names first and lit ones over them. Drawn per
// bough, a later bough's dots landed on an earlier bough's names.

interface Label {
  text: string;
  x: number;
  y: number;
  font: string;
  colour: string;
  alpha: number;
  lit: boolean;
}

let labels: Label[] = [];

function queueLabel(text: string, x: number, y: number, font: string, colour: string, alpha: number, lit: boolean): void {
  labels.push({ text, x, y, font, colour, alpha, lit });
}

/** Stroke then fill, so each name carries a thin dark edge (LABEL_OUTLINE). */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  if (LABEL_OUTLINE.width > 0) ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function drawLabels(s: RenderState): void {
  const { ctx } = s;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = LABEL_OUTLINE.width;
  ctx.strokeStyle = LABEL_OUTLINE.colour;
  let font = '';
  for (const lit of [false, true]) {
    for (const l of labels) {
      if (l.lit !== lit) continue;
      // Setting ctx.font re-parses it, so only when it actually changes.
      if (l.font !== font) ctx.font = font = l.font;
      ctx.globalAlpha = l.alpha;
      ctx.fillStyle = l.colour;
      outlinedText(ctx, l.text, l.x, l.y);
    }
  }
  ctx.restore();
  labels = [];
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

  labels = [];
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
  drawLabels(s);

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
    const L = lightOf(s, n.id, onOf(n));
    ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel, dimming ? 0.9 : 0.85, L);
    const parent = n.father ? model.rootById.get(n.father) : undefined;
    if (!parent || !isPlaced(parent)) continue;
    ctx.strokeStyle = mix(col.c, dimming ? col.lit : col.c, L);
    // Roots thicken as they go down, the opposite of a bough tapering up.
    ctx.lineWidth = Math.max(0.25, TREE.thickness * 1.3 * (1 - Math.min(0.6, (n.depth ?? 0) / 30)));
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
    const L = lightOf(s, n.id, onOf(n));
    ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel, 1, L);
    // God is the base the whole tree stands on, so he is the largest thing
    // down here and the only gold one.
    const isGod = n.id === GOD_ID;
    let size = TREE.nodeSize * (isGod ? 2.4 : n.kids.length ? 1.05 : 0.75);
    size *= 1 + Math.max(0, L - 1) * 0.5;
    const isPinned = pinnedId === n.id;
    // A slow pulse on radius and glow, so it is obvious which of 852 dots
    // the card belongs to. 0.22 is the swing either side of the resting size.
    if (isPinned) size *= 1 + pulsePhase * 0.22;
    const glowCol = litColourOf(model, n);
    const glow = glowOf(L, !dimming);
    if (glow > 0 && TREE.glow > 0) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = (isPinned ? 9 + pulsePhase * 10 : 9) * TREE.glow * glow;
    } else if (isPinned) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = pulsePhase * 10 * TREE.glow;
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
    ctx.fillStyle = isGod ? GOLD : mix(col.c, dimming ? col.lit : col.c, L);
    ctx.fill();
    ctx.shadowBlur = 0;
    // A wife is drawn in rose. Without it she is a bare first name floating
    // beside a man, with no way to tell a wife from a daughter.
    if (n.spouseOf) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
      ctx.fillStyle = mix(ROSE, dimming ? ROSE : ROSE_LIT, L);
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
  for (const n of model.rootNodes) {
    const L = lightOf(s, n.id, onOf(n));
    const isGod = n.id === GOD_ID;
    // Each label in its own bough's colour, so a name can be followed back
    // to the line it belongs to without tracing the branch by eye.
    const lc = ROOT_COLOURS[n.branch || 'Trunk'] || ROOT_COLOURS.Trunk;
    queueLabel(
      treeLabel(n.label),
      n.x,
      n.y + (isGod ? 26 : 13),
      isGod ? '600 16px Milonga, serif' : '10.5px Milonga, serif',
      isGod ? GOLD : mix(lc.c, lc.lit, L),
      lerpAlpha(s, TREE.dimLevel + 0.1, isGod ? 1 : 0.82, L),
      L >= 0.5,
    );
  }
  ctx.restore();
}

/** One trunk segment, with the same slight bow the branches use, so the
 *  trunk sits in the same hand as everything growing off it. */
function trunkSegment(ctx: CanvasRenderingContext2D, from: Placed, to: Placed): void {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, to.x, to.y);
}

function drawTrunk(s: RenderState, dimming: boolean): void {
  const { ctx, model, tracedPath, pinnedId, pulsePhase } = s;
  ctx.save();
  ctx.globalAlpha = s.light ? lerpAlpha(s, TREE.dimLevel + 0.1, 0.9, 0) : dimming ? TREE.dimLevel + 0.1 : 0.9;
  ctx.strokeStyle = BRONZE;
  ctx.lineWidth = TREE.thickness * 3.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The whole trunk, God through to Jacob, as one unbroken stroke.
  // spineChain runs Jacob -> God, so it is walked backwards to grow upward.
  const run = model.spineChain.filter(isPlaced);
  if (run.length > 1) {
    ctx.beginPath();
    ctx.moveTo(run[run.length - 1].x, run[run.length - 1].y);
    for (let i = run.length - 2; i >= 0; i--) trunkSegment(ctx, run[i + 1], run[i]);
    ctx.stroke();
    // While an animation runs, each stretch is lit by the person it climbs
    // to, laid over the dim trunk with square ends so the joins don't double.
    if (s.light) {
      const lo = ctx.globalAlpha;
      ctx.lineCap = 'butt';
      for (let i = run.length - 2; i >= 0; i--) {
        const want = lerpAlpha(s, TREE.dimLevel + 0.1, dimming ? 1 : 0.9, lightOf(s, run[i].id, false));
        if (want <= lo + 0.005) continue;
        ctx.globalAlpha = lo >= 1 ? 1 : 1 - (1 - want) / (1 - lo);
        ctx.beginPath();
        ctx.moveTo(run[i + 1].x, run[i + 1].y);
        trunkSegment(ctx, run[i + 1], run[i]);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
    }
    // The stretch a traced line runs along, again at full strength, so the
    // climb visibly runs up the trunk rather than jumping from God to Jacob.
    else if (dimming && tracedPath) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      let open = false;
      for (let i = run.length - 2; i >= 0; i--) {
        const from = run[i + 1];
        const to = run[i];
        if (!tracedPath.has(from.id) || !tracedPath.has(to.id)) {
          open = false;
          continue;
        }
        if (!open) ctx.moveTo(from.x, from.y);
        trunkSegment(ctx, from, to);
        open = true;
      }
      ctx.stroke();
    }
  } else {
    // No roots loaded — keep the short stub so the canopy is not left
    // floating. (Roots always ship with the tree, so this is a defensive
    // fallback rather than a reachable state.)
    ctx.beginPath();
    ctx.moveTo(0, TREE.trunkLen * 0.25);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }
  // Jacob, the trunk top. Full strength whenever the line being traced runs
  // through him, not left at the trunk's dim level with everything else.
  const L = lightOf(s, model.jacobId, !dimming || !!tracedPath?.has(model.jacobId));
  ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel + 0.1, 1, L);
  let size = TREE.nodeSize * 2.4 * (1 + Math.max(0, L - 1) * 0.5);
  const isPinned = pinnedId === model.jacobId;
  // The same pulse and glow a pinned root dot gets (drawRoots).
  if (isPinned) size *= 1 + pulsePhase * 0.22;
  const glow = glowOf(L, !dimming);
  if (glow > 0 && TREE.glow > 0) {
    ctx.shadowColor = BRONZE;
    ctx.shadowBlur = (isPinned ? 9 + pulsePhase * 10 : 9) * TREE.glow * glow;
  } else if (isPinned) {
    ctx.shadowColor = BRONZE;
    ctx.shadowBlur = pulsePhase * 10 * TREE.glow;
  }
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = BRONZE;
  ctx.fill();
  ctx.shadowBlur = 0;
  queueLabel('Jacob', 0, 22, '600 14px Milonga, serif', '#e8dcc8', lerpAlpha(s, TREE.dimLevel + 0.1, 1, L), L >= 0.5);
  ctx.restore();
}

function drawBough(s: RenderState, tribe: string, list: TreeRec[], lit: boolean, dimming: boolean): void {
  const { ctx, model, tracedPath, pinnedId, pulsePhase, allNames, view, W, H } = s;
  const st = STONES[tribe] || { stone: '', c: LINEN, lit: LINEN_LIT };
  // A dim twig in a lit bough keeps the lit stone; one in a dim bough, the dull.
  const offCol = lit ? st.lit : st.c;
  // Whether each person is lit: a traced line decides, otherwise the bough.
  const onOf = (n: TreeRec) => !dimming || (lit && (!tracedPath || tracedPath.has(n.id)));
  ctx.save();

  // Branches
  ctx.lineCap = 'round';
  for (const n of list) {
    if (!isPlaced(n)) continue;
    const parentRec = n.father ? model.nodes.get(n.father) : undefined;
    const from: { x: number; y: number } = parentRec && isPlaced(parentRec) ? parentRec : { x: 0, y: 0 };
    const L = lightOf(s, n.id, onOf(n));
    ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel, 1, L);
    ctx.strokeStyle = mix(offCol, st.lit, L);
    // Thinner as it climbs, so the silhouette tapers like a tree.
    ctx.lineWidth = Math.max(0.42, TREE.thickness * (1 - Math.min(0.75, (n.depth ?? 0) / 14)));
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
    const L = lightOf(s, n.id, onOf(n));
    ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel, 1, L);
    let size = TREE.nodeSize * ((n.depth ?? 0) === 0 ? 2.1 : n.kids.length ? 1.15 : 0.8);
    size *= 1 + Math.max(0, L - 1) * 0.5;
    const isPinned = pinnedId === n.id;
    // A slow pulse on radius and glow, so it is obvious which of 852 dots
    // the card belongs to.
    if (isPinned) size *= 1 + pulsePhase * 0.22;
    // Jesus is gold, like God, whatever Judah's emerald says.
    const isJesus = n.id === model.jesusId;
    const glowCol = litColourOf(model, n);

    const glow = glowOf(L, true);
    if (glow > 0 && TREE.glow > 0) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = (isPinned ? 11 + pulsePhase * 12 : 11) * TREE.glow * glow;
    } else if (isPinned) {
      ctx.shadowColor = glowCol;
      ctx.shadowBlur = pulsePhase * 12 * TREE.glow;
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
    ctx.fillStyle = isJesus ? GOLD : mix(offCol, st.lit, L);
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
    const L = lightOf(s, head.id, !dimming || lit);
    const labelLit = L >= 0.5;
    // The tribe name in its own stone's colour, so the label and the bough
    // it heads read as one thing. Dimmed boughs keep the duller stone rather
    // than a flat grey, which also keeps the twelve distinguishable while
    // dimmed.
    queueLabel(
      tribe,
      head.x,
      head.y - 11,
      '600 13px Milonga, serif',
      mix(st.c, st.lit, L),
      lerpAlpha(s, TREE.dimLevel + 0.15, 1, L),
      labelLit,
    );
    // Dinah has no STONES entry (she's a bough of one, not a tribe — see
    // config.ts), so st.stone falls through to the LINEN fallback's empty
    // string here. Guarded explicitly rather than relying on fillText('')
    // drawing nothing, since that's true by accident of the fallback's
    // shape, not by anything that says so.
    if (L > 0 && st.stone) {
      queueLabel(st.stone, head.x, head.y - 23, '9.5px -apple-system, sans-serif', st.lit, 0.75 * Math.min(1, L), labelLit);
    }
  }

  // Jesus is named always, like God, whether or not All names is on — both
  // crown lines end on him.
  const jesus = model.jesusId ? list.find((n) => n.id === model.jesusId) : undefined;
  if (jesus && isPlaced(jesus)) {
    const L = lightOf(s, jesus.id, onOf(jesus));
    queueLabel(
      treeLabel(jesus.label),
      jesus.x,
      jesus.y + 20,
      '600 16px Milonga, serif',
      GOLD,
      lerpAlpha(s, TREE.dimLevel + 0.1, 1, L),
      L >= 0.5,
    );
  }

  // The one addition beyond the lab: every OTHER dot in the bough, named too,
  // once "All names" is on. The head is skipped — he already has his label
  // above — and so is anyone the lab already draws unconditionally, so this
  // never doubles a name that was already on screen.
  if (allNames) {
    for (let i = 1; i < list.length; i++) {
      const n = list[i];
      if (!isPlaced(n)) continue;
      if (n === jesus) continue;
      // Off-screen nodes are skipped so 665 extra names stay cheap while the
      // breathing pulse redraws every frame.
      if (!onScreen(n.x, n.y, view, W, H)) continue;
      // Readable only: skip below LABEL_MIN_PX, fade in up to LABEL_FULL_PX,
      // exactly as the lab's own root and tribe labels are always full-size —
      // this is the new part, so it is the one label with a size floor.
      const screenPx = 10.5 * view.k;
      if (screenPx < LABEL_MIN_PX) continue;
      const fade = Math.min(1, (screenPx - LABEL_MIN_PX) / (LABEL_FULL_PX - LABEL_MIN_PX));
      const L = lightOf(s, n.id, onOf(n));
      queueLabel(
        treeLabel(n.label),
        n.x,
        n.y + 13,
        '10.5px Milonga, serif',
        mix(offCol, st.lit, L),
        lerpAlpha(s, TREE.dimLevel, 0.82, L) * fade,
        L >= 0.5,
      );
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
  const L = lightOf(s, CROWN_LIGHT, !dimming);
  ctx.save();
  for (const l of lines) {
    if (l.pts.length < 2) continue;
    ctx.globalAlpha = lerpAlpha(s, TREE.dimLevel + 0.12, 0.6, L);
    ctx.strokeStyle = l.col;
    ctx.lineWidth = TREE.thickness * 1.1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    l.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Both lines end on Jesus, so naming each at its end printed "Matthew" and
  // "Luke" on top of each other. Each name sits instead on the last stretch
  // its line does not share with the other, a few people back from where the
  // two lines rejoin, laid along the line and just above it — the people's
  // own names hang below their dots.
  const [m, l] = lines;
  const mIds = new Set(m.pts.map((p) => p.id));
  const lIds = new Set(l.pts.map((p) => p.id));
  // The names stay at 0.9 dimmed or not; only an animation's floor fades them.
  const nameAlpha = lerpAlpha(s, 0.9, 0.9, L);
  crownName(ctx, m.pts.filter((p) => !lIds.has(p.id)), m.col, m.name, nameAlpha);
  crownName(ctx, l.pts.filter((p) => !mIds.has(p.id)), l.col, l.name, nameAlpha);
  ctx.restore();
}

function crownName(ctx: CanvasRenderingContext2D, own: Placed[], col: string, name: string, alpha: number): void {
  if (own.length < 2) return;
  const i = Math.max(0, own.length - 4);
  const a = own[i];
  const b = own[Math.min(own.length - 1, i + 1)];
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  // Read left to right whichever way the line happens to run.
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  const len = Math.hypot(dx, dy) || 1;
  // The side of the line facing up the screen.
  const nx = dy / len;
  const ny = -dx / len;
  ctx.save();
  ctx.translate((a.x + b.x) / 2 + nx * 7, (a.y + b.y) / 2 + ny * 7);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  ctx.font = '10.5px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = LABEL_OUTLINE.width;
  ctx.strokeStyle = LABEL_OUTLINE.colour;
  outlinedText(ctx, name, 0, 0);
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
