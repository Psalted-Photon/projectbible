/**
 * Where everyone on the tree sits.
 *
 * Ported from the lab's own build()/layout(), with no DOM — this only ever
 * touches the data and the config, so it can be reasoned about (and tested by
 * hand) without a canvas in front of it. The radial idea itself is not a
 * choice: the twelve tribes all fork at Jacob, who is the world origin, so
 * giving each one a hand-placed angle is what a shared father falls out to.
 * Every other bough forks lower down the trunk and pivots about ITS fork —
 * Ham about Noah, not about Jacob — which is why `place()` below takes an
 * explicit origin instead of assuming the world origin throughout.
 *
 * Within a bough, a subtree is given a slice of its parent's angular span in
 * proportion to how many leaves it carries. That is what keeps a deep begat
 * chain from eating the width its cousins need, and it is the part the user
 * does not author — only the twelve directions and the eleven pre-Jacob ones
 * are placed by hand, in config.ts.
 */

import type { FamilyTreeCrownLink, FamilyTreeData, FamilyTreeNode, FamilyTreeRoot } from './data';
import {
  BOUGHS,
  LABEL_CHAR_W,
  LABEL_H,
  LABEL_PAD_X,
  LABEL_PAD_Y,
  OFFSHOOT_ANGLES,
  ROOTS,
  SPREAD_DRIFT,
  STAGGER_PX,
  TREE,
  type BranchSpec,
} from './config';

/**
 * One person, canopy or root, once placed.
 *
 * The JSON fields plus everything layout() fills in. `x`/`y` are `null` until
 * placed — a person can be in the data but off the tree (nobody, currently),
 * so draw code always has to check rather than assume every record has a
 * position.
 */
export interface TreeRec extends Partial<FamilyTreeNode>, Partial<FamilyTreeRoot> {
  id: string;
  label: string;
  father: string | null;
  kids: string[];
  /** True for a pre-Jacob person; unset for a canopy node. */
  root?: boolean;
  x: number | null;
  y: number | null;
  /** This person's direction, "from straight up", clockwise. */
  angle?: number;
  /** Distance from Jacob (the world origin). */
  r?: number;
  /** Distance from this bough's own fork — its head's father, not Jacob. */
  d?: number;
  /** Set on a wife placed beside her husband, rather than under a father. */
  partnerId?: string;
  /** A small step in or out along this person's own line, in tree units, set
   *  by the spread pass on a name it could not clear sideways. */
  stagger?: number;
}

/**
 * The name as drawn on the canvas: the full label less any trailing
 * parenthetical, so "Eliab (son of Helon)" prints as "Eliab". The line to his
 * father already says whose son he is. The tap card, bio and search keep the
 * full `label` — this is only for the tree itself, where every character is
 * width a neighbour's name has to clear.
 */
export function treeLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '') || label;
}

/** A TreeRec once it actually has a position. Narrowing `x`/`y` from
 *  `number | null` to `number` here is what lets draw code use `.y` right
 *  after checking `.x` — under strict mode those are two separate nullable
 *  fields, and TypeScript won't infer one from the other without this. */
export type Placed = TreeRec & { x: number; y: number };

/** True when a person was actually placed on the tree. Use this everywhere
 *  the lab tests `x == null` / `x != null` — it narrows both x and y at once,
 *  where the lab's own `x`-only check left `y` still typed as nullable. */
export function isPlaced(n: TreeRec): n is Placed {
  return n.x != null && n.y != null;
}

export interface TreeModel {
  /** The 665-person canopy, id → record. */
  nodes: Map<string, TreeRec>;
  byTribe: Map<string, TreeRec[]>;
  /** The 187-person root mat, id → record. */
  rootById: Map<string, TreeRec>;
  byRootBranch: Map<string, TreeRec[]>;
  /** Every placed root record except Jacob himself — he is drawn as the trunk
   *  top, not as a root dot, so he is held out here to avoid a second node.
   *  Typed Placed[], not TreeRec[]: it is built by filtering on isPlaced, so
   *  draw code reading .y right after this list needs no further guard. */
  rootNodes: Placed[];
  /** The trunk proper: God → Jacob, in trunk order. Fifteen other people carry
   *  branch 'Trunk' (wives, Abel, Lud, Elam) without being in this chain.
   *  Not filtered to Placed — the trunk stub fallback in drawTrunk runs when
   *  this has fewer than 2 entries, which can include an unplaced one. */
  spineChain: TreeRec[];
  crownM: Placed[];
  crownL: Placed[];
  toJesus: Map<string, number>;
  /** The bounding box of every placed node, Jacob included. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  jacobId: string;
  attribution: string;
}

/** Deterministic hash so jitter is stable across redraws. Jitter is 0 in the
 *  locked numbers, so this only matters if TREE.jitter is ever turned back on. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function buildNodes(data: FamilyTreeData): {
  nodes: Map<string, TreeRec>;
  byTribe: Map<string, TreeRec[]>;
} {
  const nodes = new Map<string, TreeRec>();
  for (const n of data.nodes) {
    nodes.set(n.id, { ...n, kids: [], x: null, y: null });
  }
  // Children lists, so a bough can be walked from its son of Jacob outward.
  for (const n of nodes.values()) {
    if (n.father && nodes.has(n.father)) nodes.get(n.father)!.kids.push(n.id);
  }
  const byTribe = new Map<string, TreeRec[]>();
  for (const n of nodes.values()) {
    const tribe = n.tribe ?? '';
    if (!byTribe.has(tribe)) byTribe.set(tribe, []);
    byTribe.get(tribe)!.push(n);
  }
  for (const list of byTribe.values()) list.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  return { nodes, byTribe };
}

function buildRoots(data: FamilyTreeData): {
  rootById: Map<string, TreeRec>;
  byRootBranch: Map<string, TreeRec[]>;
} {
  const rootById = new Map<string, TreeRec>();
  for (const r of data.roots) {
    rootById.set(r.id, { ...r, kids: [], root: true, x: null, y: null });
  }
  for (const n of rootById.values()) {
    // A wife is seated beside her husband, not below her father, so she is
    // kept out of the descent entirely. Leah and Rachel are Laban's
    // daughters; placing them by descent draws them out along Nahor's bough,
    // a quarter of the tree away from Jacob.
    if (n.spouseOf && rootById.has(n.spouseOf)) continue;
    if (n.father && rootById.has(n.father)) rootById.get(n.father)!.kids.push(n.id);
  }
  const byRootBranch = new Map<string, TreeRec[]>();
  for (const n of rootById.values()) {
    // A wife is drawn beside her husband, so she takes his bough's colour.
    // Leah is Laban's daughter and would otherwise be tinted as one of
    // Nahor's while standing next to Jacob on the trunk.
    if (n.spouseOf && rootById.has(n.spouseOf)) {
      n.branch = rootById.get(n.spouseOf)!.branch || 'Trunk';
    }
    const br = n.branch || 'Trunk';
    if (!byRootBranch.has(br)) byRootBranch.set(br, []);
    byRootBranch.get(br)!.push(n);
  }
  for (const list of byRootBranch.values()) list.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  return { rootById, byRootBranch };
}

interface PlaceOpts {
  from: Map<string, TreeRec>;
  dials: BranchSpec;
  /** The fork this bough pivots about — its head's father, not necessarily Jacob. */
  ox: number;
  oy: number;
  base: number;
  gap: number;
  jitScale?: number;
  /** Restricts descent to one root branch, so a Line subtree's leaf count
   *  isn't swollen by a NAMED branch hanging off it (Ishmael off Abraham). */
  branch?: string;
}

/**
 * Put one person at `angle`, `depth` generations out from the fork — the x/y
 * maths `place()` has always done, pulled out so the spread pass can move a
 * person and land him exactly where `place()` would have put him at that
 * angle.
 */
function position(n: TreeRec, angle: number, depth: number, opts: PlaceOpts): void {
  const t = opts.dials;
  const rad = (d: number) => (d * Math.PI) / 180;
  const jit = (hash(n.id) - 0.5) * TREE.jitter * (opts.jitScale || 1);
  const ox = opts.ox || 0;
  const oy = opts.oy || 0;

  // Distance from the FORK, not from the world origin. Non-linear: early
  // generations spread, deep chains compress, so a 51-generation line reads
  // as one long bough instead of 51 rings. `stagger` is the spread pass's
  // in/out step, zero for everyone it did not have to move.
  const d = opts.base + Math.pow(depth + 1, TREE.curve) * opts.gap * t.reach + jit * opts.gap * 0.5 + (n.stagger || 0);

  // Lean bends the branch away from straight as it runs, accumulating from
  // the fork because `depth` is depth within this bough.
  const bend = rad(t.lean) * Math.pow(depth / 8, 1.3);
  const a = rad(angle - 90) + bend + jit * 0.04;

  n.x = ox + Math.cos(a) * d;
  n.y = oy + Math.sin(a) * d;
  n.angle = angle;
  // Distance from Jacob. Assigned rather than recomputed when the fork IS the
  // origin: hypot(cos(a)*d, sin(a)*d) differs from d about 37% of the time,
  // and rounding the twelve for no reason is not worth the tidiness.
  n.r = ox === 0 && oy === 0 ? d : Math.hypot(n.x, n.y);
  n.d = d;
}

/**
 * Place a subtree, recursively, giving each child a slice of the parent's
 * angular span in proportion to the leaves it carries.
 */
function place(
  id: string,
  angle: number,
  span: number,
  depth: number,
  opts: PlaceOpts,
  leaves: Map<string, number>,
): void {
  const n = opts.from.get(id);
  if (!n) return;
  position(n, angle, depth, opts);

  // A child that belongs to a different named branch is placed by that
  // branch's own pass — Ishmael hangs off Abraham but is aimed by the
  // Ishmael dials — so he is skipped here rather than placed twice.
  const kids = opts.branch
    ? n.kids.filter((k) => ((opts.from.get(k) || ({} as TreeRec)).branch || 'Trunk') === opts.branch)
    : n.kids;
  if (!kids.length) return;

  const countLeaves = (kid: string): number => {
    const key = opts.branch ? `${opts.branch}|${kid}` : kid;
    const held = leaves.get(key);
    if (held !== undefined) return held;
    const kn = opts.from.get(kid);
    if (!kn) return 1;
    let c = 0;
    for (const k of kn.kids) {
      if (opts.branch && ((opts.from.get(k) || ({} as TreeRec)).branch || 'Trunk') !== opts.branch) continue;
      c += countLeaves(k);
    }
    if (c === 0) c = 1;
    leaves.set(key, c);
    return c;
  };

  const total = kids.reduce((s, k) => s + countLeaves(k), 0);
  let cur = angle - span / 2;
  for (const k of kids) {
    const share = (countLeaves(k) / total) * span;
    // The one behaviour change from the lab: a child with a fixed offshoot
    // angle (Abel, Elam) is placed there instead of at the middle of its
    // share. `cur` still advances by the full share either way, so this
    // child's siblings keep the position they would otherwise have had.
    const childAngle = OFFSHOOT_ANGLES[k] ?? cur + share / 2;
    place(k, childAngle, share * 0.92, depth + 1, opts, leaves);
    cur += share;
  }
}

/** The PlaceOpts every canopy bough is placed with: forked at Jacob. */
function canopyOpts(nodes: Map<string, TreeRec>, dials: BranchSpec): PlaceOpts {
  return { from: nodes, dials, ox: 0, oy: 0, base: TREE.trunkLen, gap: TREE.ringGap };
}

type Pt = { x: number; y: number };

/** One parent→child line as render.ts draws it — a quadratic curve bowed by
 *  (−dy, dx) × 0.08 — flattened into 6 straight pieces, with its bounding box
 *  so most pairs can be ruled out without testing a single piece. */
interface Curve {
  a: string;
  b: string;
  pts: Pt[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Stands in for Jacob as the far end of a son of Jacob's line. Jacob is a
 *  root record, not a canopy one, so no canopy id can collide with this. */
const JACOB_END = '#jacob';

function curveOf(a: string, b: string, from: Pt, to: Pt): Curve {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = (from.x + to.x) / 2 - dy * 0.08;
  const cy = (from.y + to.y) / 2 + dx * 0.08;
  const pts: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const u = 1 - t;
    pts.push({ x: u * u * from.x + 2 * u * t * cx + t * t * to.x, y: u * u * from.y + 2 * u * t * cy + t * t * to.y });
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { a, b, pts, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Every canopy line — each person to his father, each son of Jacob to 0,0 —
 *  or only the lines ending on the people in `only`. */
function canopyCurves(nodes: Map<string, TreeRec>, only?: Set<string>): Curve[] {
  const out: Curve[] = [];
  for (const n of nodes.values()) {
    if (only && !only.has(n.id)) continue;
    if (!isPlaced(n)) continue;
    const f = n.father ? nodes.get(n.father) : undefined;
    if (f && isPlaced(f)) out.push(curveOf(f.id, n.id, f, n));
    else if (!f) out.push(curveOf(JACOB_END, n.id, { x: 0, y: 0 }, n));
  }
  return out;
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/** Two lines that share a person meet at him by design, so they never count. */
function curvesCross(c: Curve, e: Curve): boolean {
  if (c.a === e.a || c.a === e.b || c.b === e.a || c.b === e.b) return false;
  if (c.maxX < e.minX || e.maxX < c.minX || c.maxY < e.minY || e.maxY < c.minY) return false;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      if (segmentsCross(c.pts[i], c.pts[i + 1], e.pts[j], e.pts[j + 1])) return true;
    }
  }
  return false;
}

/**
 * Pull apart only the names that would print on top of each other.
 *
 * `place()` gives every child 92% of his share, so a deep line's fan narrows
 * generation after generation — Joseph, Mary's husband, forty generations
 * down, has 0.08° for five sons — and the fixed-size labels pile up. Opening
 * a tribe's spread does not help: it widens the base far more than the tips.
 * So this runs after the boughs are placed and touches only the rings where
 * two neighbouring names actually collide; everyone else stays exactly where
 * `place()` put them.
 *
 * Three rules keep the lines from crossing:
 * - A ring's order is frozen at the angles `place()` gave it. Brothers may
 *   move apart but never pass each other, and a line that never changes
 *   places with its neighbour cannot cross it.
 * - A child may drift only so far from his father's angle. Past acos(rIn/r)
 *   the father→child line dips back inside the father's own ring and cuts
 *   across whatever is there; SPREAD_DRIFT keeps to a safe fraction of that.
 * - Nobody leaves the tribe's footprint — the span its members already
 *   occupy — rather than its spread wedge. Judah's and Levi's wedges overlap
 *   by about 4°, and letting Er use Judah's full wedge crossed Levi's line.
 *
 * A moved person carries his whole line with him; moving him alone left his
 * sons' lines crossing his brothers'. Any name still overlapping afterwards
 * steps in or out along its own line instead (STAGGER_PX). Last, the tribe's
 * lines are checked against every canopy line, and if anything crosses, the
 * whole tribe goes back as `place()` left it. The check waits for the whole
 * tribe: halfway through the walk lines can briefly cross, and undoing on
 * those threw away good work.
 */
function spreadOffenders(nodes: Map<string, TreeRec>, byTribe: Map<string, TreeRec[]>): void {
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  const labelLen = (n: TreeRec) => treeLabel(n.label).length;

  for (const [tribe, list] of byTribe) {
    const t = BOUGHS[tribe];
    const head = list[0];
    if (!t || !head || !isPlaced(head)) continue;
    const opts = canopyOpts(nodes, t);

    // Depth as place() counted it: from the head, down `kids`.
    const depthOf = new Map<string, number>([[head.id, 0]]);
    const walk = [head.id];
    while (walk.length) {
      const id = walk.pop()!;
      for (const k of nodes.get(id)?.kids ?? []) {
        if (depthOf.has(k) || !nodes.has(k)) continue;
        depthOf.set(k, depthOf.get(id)! + 1);
        walk.push(k);
      }
    }
    const members = list.filter((n) => isPlaced(n) && depthOf.has(n.id));

    // Snapshot, for the safety net, and the footprint nobody may leave.
    const snap = new Map<string, Pick<TreeRec, 'angle' | 'x' | 'y' | 'r' | 'd' | 'stagger'>>();
    let footMin = Infinity;
    let footMax = -Infinity;
    for (const n of members) {
      snap.set(n.id, { angle: n.angle, x: n.x, y: n.y, r: n.r, d: n.d, stagger: n.stagger });
      const a = n.angle ?? 0;
      if (a < footMin) footMin = a;
      if (a > footMax) footMax = a;
    }
    const orig = (n: TreeRec) => snap.get(n.id)!.angle ?? 0;

    // Turn a person and everyone below him by the same amount.
    const shiftLine = (n: TreeRec, delta: number): void => {
      position(n, (n.angle ?? 0) + delta, depthOf.get(n.id) ?? 0, opts);
      for (const k of n.kids) {
        const kid = nodes.get(k);
        if (kid && depthOf.has(k)) shiftLine(kid, delta);
      }
    };

    // Walk the generations outward, one ring at a time.
    const rings = new Map<number, TreeRec[]>();
    for (const n of members) {
      const dep = depthOf.get(n.id)!;
      if (!rings.has(dep)) rings.set(dep, []);
      rings.get(dep)!.push(n);
    }
    const ringR = (dep: number) => TREE.trunkLen + Math.pow(dep + 1, TREE.curve) * TREE.ringGap * t.reach;
    const maxDepth = Math.max(...rings.keys());

    for (let dep = 0; dep <= maxDepth; dep++) {
      const ring = rings.get(dep);
      if (!ring || ring.length < 2) continue;
      ring.sort((a, b) => orig(a) - orig(b));

      const r = ringR(dep);
      const rIn = dep === 0 ? 0 : ringR(dep - 1);
      const bend = t.lean * Math.pow(dep / 8, 1.3);
      const drift = SPREAD_DRIFT * deg(Math.acos(Math.min(1, rIn / r)));

      // The gap each neighbouring pair needs, in degrees, judged by the
      // pair's own direction: two names on a steep stretch of the ring sit
      // one above the other and need far less angle than on a flat stretch.
      const ang = ring.map((n) => n.angle ?? 0);
      const needs = (): number[] => {
        const out: number[] = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const th = rad((ang[i] + ang[i + 1]) / 2 + bend);
          const c = Math.abs(Math.cos(th));
          const s = Math.abs(Math.sin(th));
          const w = ((labelLen(ring[i]) + labelLen(ring[i + 1])) / 2) * LABEL_CHAR_W + LABEL_PAD_X;
          const across = c < 0.001 ? Infinity : w / c;
          const down = s < 0.001 ? Infinity : (LABEL_H + LABEL_PAD_Y) / s;
          out.push(deg(Math.min(across, down) / r));
        }
        return out;
      };
      let need = needs();

      // A ring where nobody collides is left exactly as it is.
      if (need.every((g, i) => ang[i + 1] - ang[i] >= g)) continue;

      // How far each person may go: inside the footprint, and within the
      // drift limit of his father as the father now sits. Never narrower
      // than where he already is.
      const lo: number[] = [];
      const hi: number[] = [];
      ring.forEach((n, i) => {
        let l = footMin;
        let h = footMax;
        const f = n.father ? nodes.get(n.father) : undefined;
        if (dep > 0 && f?.angle != null) {
          l = Math.max(l, f.angle - drift);
          h = Math.min(h, f.angle + drift);
        }
        lo.push(Math.min(l, ang[i]));
        hi.push(Math.max(h, ang[i]));
      });

      // Relax: each pair that is short is pushed apart by half the
      // shortfall each, until a pass changes nothing.
      for (let pass = 0; pass < 5000; pass++) {
        if (pass > 0 && pass % 50 === 0) need = needs();
        let changed = false;
        for (let i = 0; i < ring.length - 1; i++) {
          const short = need[i] - (ang[i + 1] - ang[i]);
          if (short <= 1e-9) continue;
          const left = Math.max(lo[i], ang[i] - short / 2);
          const right = Math.min(hi[i + 1], ang[i + 1] + short / 2);
          if (Math.abs(left - ang[i]) > 1e-9 || Math.abs(right - ang[i + 1]) > 1e-9) changed = true;
          ang[i] = left;
          ang[i + 1] = right;
        }
        if (!changed) break;
      }

      // Each moved person takes his line with him.
      ring.forEach((n, i) => {
        const delta = ang[i] - (n.angle ?? 0);
        if (Math.abs(delta) > 1e-9) shiftLine(n, delta);
      });
    }

    // Leftovers: names still overlapping one in their own ring step
    // alternately in and out along their line, restarting after anyone who
    // is clear. Only the name moves — his line and his sons stay put.
    const half = STAGGER_PX / 2;
    for (const ring of rings.values()) {
      if (ring.length < 2) continue;
      const placed = ring.filter(isPlaced).sort((a, b) => (a.angle ?? 0) - (b.angle ?? 0));
      const boxes = placed.map((n) => {
        const hw = (labelLen(n) * LABEL_CHAR_W) / 2;
        return { x0: n.x - hw, x1: n.x + hw, y0: n.y + 3, y1: n.y + 16 };
      });
      const offends = boxes.map((b, i) =>
        boxes.some((o, j) => j !== i && b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1),
      );
      let run = 0;
      placed.forEach((n, i) => {
        if (!offends[i]) {
          run = 0;
          return;
        }
        n.stagger = run % 2 === 0 ? -half : half;
        run++;
        position(n, n.angle ?? 0, depthOf.get(n.id) ?? 0, opts);
      });
    }

    // Safety net: if any of this tribe's lines now crosses any canopy line,
    // the whole tribe goes back as place() left it.
    const mine = canopyCurves(nodes, new Set(members.map((n) => n.id)));
    const all = canopyCurves(nodes);
    if (mine.some((c) => all.some((e) => curvesCross(c, e)))) {
      for (const n of members) Object.assign(n, snap.get(n.id));
    }
  }
}

/**
 * Place every node: the twelve boughs off Jacob, then the trunk and the
 * pre-Jacob boughs off it, then the crown lines from whatever is already up.
 */
export function layout(data: FamilyTreeData): TreeModel {
  const { nodes, byTribe } = buildNodes(data);
  const { rootById, byRootBranch } = buildRoots(data);
  // One cache for the whole layout pass, exactly as the lab keeps one `leaves`
  // Map for its whole layout() — `branch|id` keys are what let the canopy and
  // the trunk-offshoot fan share it safely (see `place`'s own countLeaves).
  const leaves = new Map<string, number>();

  function countLeavesFrom(from: Map<string, TreeRec>, branchFilter?: string) {
    return function count(id: string): number {
      const key = branchFilter ? `${branchFilter}|${id}` : id;
      const held = leaves.get(key);
      if (held !== undefined) return held;
      const n = from.get(id);
      if (!n) return 1;
      let c = 0;
      for (const k of n.kids) {
        if (branchFilter && ((from.get(k) || ({} as TreeRec)).branch || 'Trunk') !== branchFilter) continue;
        c += count(k);
      }
      if (c === 0) c = 1;
      leaves.set(key, c);
      return c;
    };
  }

  for (const [tribe, list] of byTribe) {
    const t = BOUGHS[tribe];
    const head = list[0];
    if (!t || !head) continue;
    place(head.id, t.angle, t.spread, 0, canopyOpts(nodes, t), leaves);
  }
  spreadOffenders(nodes, byTribe);

  // ── The trunk and the pre-Jacob boughs ────────────────────────────────
  let rootNodes: Placed[] = [];
  let spineChain: TreeRec[] = [];

  if (rootById.size && ROOTS.Trunk) {
    const jacob = rootById.get(data.jacob);
    if (jacob) {
      const rad = (d: number) => (d * Math.PI) / 180;

      // The trunk, Jacob first, ending at Adam. Every other pre-Jacob node
      // hangs off one of these.
      const spine: TreeRec[] = [];
      const seenSpine = new Set<string>();
      for (let cur: TreeRec | undefined = jacob; cur && !seenSpine.has(cur.id); cur = cur.father ? rootById.get(cur.father) : undefined) {
        seenSpine.add(cur.id);
        spine.push(cur);
        if (!cur.father) break;
      }

      // Jacob is the trunk top, at the origin, so the canopy sits on him.
      jacob.x = 0;
      jacob.y = 0;
      jacob.r = 0;
      jacob.angle = ROOTS.Trunk.angle;

      spine.forEach((n, i) => {
        if (i === 0) return;
        const jit = (hash(n.id) - 0.5) * TREE.jitter * 6;
        const r = TREE.trunkLen * 0.25 + Math.pow(i, TREE.curve) * TREE.rootGap * ROOTS.Trunk.reach + jit * TREE.rootGap * 0.5;
        // rootArc sways the trunk as it runs instead of it going dead
        // straight; the lean dial bends it further the further down it goes.
        const sway = (Math.sin((i / Math.max(1, spine.length - 1)) * Math.PI) * TREE.rootArc * 0.25);
        const bend = rad(ROOTS.Trunk.lean) * Math.pow(i / 8, 1.3);
        const a = rad(ROOTS.Trunk.angle + sway - 90) + bend + jit * 0.04;
        n.x = Math.cos(a) * r;
        n.y = Math.sin(a) * r;
        n.r = r;
        n.angle = ROOTS.Trunk.angle + sway;
      });

      // Kept for the draw pass, which strokes the whole run as one thick
      // line rather than as twenty-three separate tapering twigs.
      spineChain = spine;

      // Everyone else on the trunk dials is a sibling or cousin too small to
      // have earned its own row — a lone daughter, a son with no
      // descendants. Each forks from the trunk node it hangs off, fanned
      // either side rather than stacked.
      const onSpine = new Set(spine.map((n) => n.id));
      const countTrunkLeaves = countLeavesFrom(rootById, 'Trunk');
      for (const s of spine) {
        const offshoots = s.kids.filter((k) => {
          const kid = rootById.get(k);
          return kid && !onSpine.has(k) && (kid.branch || 'Trunk') === 'Trunk';
        });
        if (!offshoots.length) continue;
        const d = ROOTS.Trunk;
        // Spread the fan across the same span the spine's own dial asks for,
        // measured either side of the direction the spine is heading.
        const fan = Math.max(d.spread, offshoots.length * 4);
        const total = offshoots.reduce((a, k) => a + countTrunkLeaves(k), 0);
        let cur = (s.angle ?? d.angle) - fan / 2;
        for (const k of offshoots) {
          const share = (countTrunkLeaves(k) / total) * fan;
          const childAngle = OFFSHOOT_ANGLES[k] ?? cur + share / 2;
          // Offshoots sit shorter than the trunk so the trunk stays readable
          // as the through-line of the whole tree.
          place(
            k,
            childAngle,
            share * 0.9,
            0,
            {
              from: rootById,
              dials: { ...d, reach: d.reach * 0.8 },
              ox: s.x ?? 0,
              oy: s.y ?? 0,
              base: 0,
              gap: TREE.rootGap,
              jitScale: 6,
              branch: 'Trunk',
            },
            leaves,
          );
          cur += share;
        }
      }

      // Each named bough, placed from where it leaves the trunk. Swinging
      // Ham moves Ham and everyone under him, and nobody else.
      for (const [branch, list] of byRootBranch) {
        if (branch === 'Trunk' || !ROOTS[branch] || !list.length) continue;
        // The head is the shallowest node that is actually IN the descent. A
        // wife is seated beside her husband and so has no children here, and
        // she can tie with him on depth and sort first — Milcah did, which
        // made her the head of Nahor's bough and left all seventeen of them
        // unplaced, because placing her places nobody.
        const head = list.find((n) => !n.spouseOf) || list[0];
        const parent = head.father ? rootById.get(head.father) : undefined;
        const d = ROOTS[branch];
        place(
          head.id,
          (parent ? (parent.angle ?? ROOTS.Trunk.angle) : ROOTS.Trunk.angle) + d.angle,
          d.spread,
          0,
          {
            from: rootById,
            dials: d,
            // The fork: this bough pivots about its head's father, where it
            // actually leaves the trunk. Swinging Ham sweeps him around Noah.
            ox: parent && isPlaced(parent) ? parent.x : 0,
            oy: parent && isPlaced(parent) ? parent.y : 0,
            // Zero, because depth 0 already steps one generation out from
            // the fork — the head lands one ring from its father, correctly.
            base: 0,
            gap: TREE.rootGap,
            jitScale: 6,
            branch,
          },
          leaves,
        );
      }

      // Wives sit BESIDE their husband, not below him. Offset in plain
      // pixels, perpendicular to the husband's own growth direction — his
      // father to him — alternating sides so Jacob's four do not stack.
      const spouseCount = new Map<string, number>();
      for (const n of rootById.values()) {
        if (!n.spouseOf) continue;
        const h = rootById.get(n.spouseOf);
        if (!h || !isPlaced(h)) continue;
        const i = spouseCount.get(n.spouseOf) || 0;
        spouseCount.set(n.spouseOf, i + 1);
        const side = i % 2 === 0 ? 1 : -1;
        const step = Math.floor(i / 2) + 1;

        // The husband's growth direction: his father to him. Adam has no
        // father in this data, so straight up (the trunk's own resting
        // direction) is the fallback.
        const father = h.father ? rootById.get(h.father) : undefined;
        let dx: number;
        let dy: number;
        if (father && isPlaced(father)) {
          dx = h.x - father.x;
          dy = h.y - father.y;
        } else {
          dx = 0;
          dy = -1;
        }
        const dlen = Math.hypot(dx, dy) || 1;
        dx /= dlen;
        dy /= dlen;
        // Perpendicular to that direction, so the wife sits across the
        // branch rather than further along it.
        const px = -dy;
        const py = dx;

        const d2 = TREE.coupleGap * step;
        n.x = h.x + px * d2 * side;
        n.y = h.y + py * d2 * side;
        n.r = Math.hypot(n.x, n.y);
        n.angle = h.angle;
        n.partnerId = h.id;
      }
    }
    // Jacob is placed — the boughs leaving him need his radius — but he is
    // drawn as the trunk top, not as a root dot, so he is excluded here.
    rootNodes = [...rootById.values()].filter((n): n is Placed => isPlaced(n) && n.id !== data.jacob);
  }

  // Crown lines are drawn from whatever nodes are already placed.
  const pick = (list: FamilyTreeCrownLink[] | undefined): Placed[] =>
    (list || []).map((c) => nodes.get(c.id)).filter((n): n is Placed => !!n && isPlaced(n));
  const crownM = pick(data.crown?.matthew);
  const crownL = pick(data.crown?.luke);

  // Bounding box of every placed node, Jacob included — he sits at 0,0,
  // which isPlaced still counts correctly (unlike a truthiness check on `x`,
  // which would treat 0 as unplaced).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const jacobRec = rootById.get(data.jacob);
  const allPlaced: Placed[] = [...nodes.values(), ...rootNodes, ...(jacobRec ? [jacobRec] : [])].filter(isPlaced);
  for (const n of allPlaced) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  const toJesus = buildCrownDistances(data);

  return {
    nodes,
    byTribe,
    rootById,
    byRootBranch,
    rootNodes,
    spineChain,
    crownM,
    crownL,
    toJesus,
    bounds: { minX, maxX, minY, maxY },
    jacobId: data.jacob,
    attribution: data.attribution,
  };
}

/**
 * Walk this person's whole line, end to end: `n` itself out to God, where the
 * line reaches that far back.
 *
 * A canopy node climbs `father` to its son of Jacob and then carries on down
 * the roots to God. A root node does the same from wherever it sits. A wife
 * has no father in this window, so her line continues through her husband —
 * tracing Leah lights Jacob's descent to Adam rather than stopping on her.
 */
export function ancestorChain(model: TreeModel, n: TreeRec): TreeRec[] {
  const chain: TreeRec[] = [];
  const seen = new Set<string>();
  let cur: string | null | undefined = n.id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const rec: TreeRec | undefined = model.nodes.get(cur) || model.rootById.get(cur);
    if (!rec) break;
    chain.push(rec);
    cur = rec.father || rec.spouseOf;
  }
  return chain;
}

/**
 * Generations from God, and generations to Jesus.
 *
 * The ends of this tree are God at the foot of the trunk and Jesus at the
 * crown — Jacob is the middle, not an end, so counting from him would say
 * nothing to a reader. Where a person sits on both lines — everyone on the
 * Matthew or Luke chain — both numbers apply.
 */
export function generationOf(model: TreeModel, id: string): number | null {
  const rec = model.rootById.get(id) || model.nodes.get(id);
  if (!rec) return null;
  if (rec.root) return rec.depth ?? 0;
  // A canopy node's own depth counts from its son of Jacob, so the pre-Jacob
  // side of the journey is Jacob's depth plus the one step onto the bough.
  const jacob = model.rootById.get(model.jacobId);
  return jacob ? (jacob.depth ?? 0) + 1 + (rec.depth ?? 0) : null;
}

/**
 * Built once from the two crown chains: a node is only "N to Jesus" if it is
 * actually on a line that reaches him.
 */
export function buildCrownDistances(data: FamilyTreeData): Map<string, number> {
  const toJesus = new Map<string, number>();
  for (const line of [data.crown?.matthew, data.crown?.luke]) {
    if (!line || !line.length) continue;
    line.forEach((c, i) => {
      const d = line.length - 1 - i;
      // Matthew is 43 long and Luke 53, so the same man sits at two
      // distances. The shorter is kept, since it is the count that is true
      // of some line.
      const held = toJesus.get(c.id);
      if (held === undefined || held > d) toJesus.set(c.id, d);
    });
  }
  return toJesus;
}
