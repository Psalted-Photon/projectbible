/**
 * Tree motion lab v2.0 — tunes the Grand Entrance, the name outline, and the
 * Lights: the tree coming on as it opens, and a tribe coming on in order
 * from its stone.
 *
 * Runs the real tree: loadFamilyTree + layout for the data, render.ts's draw
 * for the frame, and motion.ts for the sequence, the bursts and the light
 * waves. Every slider writes straight into MOTION, LIGHTS or LABEL_OUTLINE,
 * so what plays here is what the app plays. Copy values prints the blocks,
 * ready to paste back into src/lib/familyTree/motion.ts and config.ts.
 *
 * The values are kept in this browser between visits (localStorage), so a
 * reload on the phone doesn't lose a half-tuned set. Reset puts back what
 * the app currently ships.
 */

import { loadFamilyTree } from './src/lib/familyTree/data';
import { layout, ancestorChain, isPlaced, type TreeModel, type TreeRec } from './src/lib/familyTree/layout';
import { CROWN_LIGHT, draw, fitView, litColourOf, pick, toWorld, viewFor, type View } from './src/lib/familyTree/render';
import { GOD_ID, LABEL_OUTLINE, MAX_ZOOM, MIN_ZOOM_OF_FIT, STONES, TREE } from './src/lib/familyTree/config';
import {
  CURVE_NAMES,
  Entrance,
  LIGHTS,
  MOTION,
  ORDER_NAMES,
  Wave,
  drawBursts,
  ease,
  makeBurst,
  rankBy,
  type Burst,
  type BurstSpec,
  type Curve,
  type Lights,
  type Motion,
  type Order,
  type WaveSpec,
} from './src/lib/familyTree/motion';

const SHIPPED_MOTION: Motion = JSON.parse(JSON.stringify(MOTION));
const SHIPPED_LIGHTS: Lights = JSON.parse(JSON.stringify(LIGHTS));
const SHIPPED_OUTLINE = { ...LABEL_OUTLINE };
const STORE_KEY = 'tree-motion-lab-values';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('tree') as HTMLCanvasElement;
const drawer = document.getElementById('drawer') as HTMLElement;
const whoSel = document.getElementById('who') as HTMLSelectElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

const TOUCH = matchMedia('(pointer: coarse)').matches;

let model: TreeModel | null = null;
let W = 0;
let H = 0;
let DPR = 1;
let view: View = { x: 0, y: 0, k: 1 };
let fittedK = 1;
let atFitted = true;

let tracedPath: Set<string> | null = null;
let selectedTribe: string | null = null;
let pinned: TreeRec | null = null;
let pulseStart = 0;
let pulsePhase = 0;
let allNames = true;
let entranceOn = true;

let seq: { entrance: Entrance; line: string[] } | null = null;
let bursts: Burst[] = [];
let glide: {
  startWorld: { x: number; y: number };
  targetWorld: { x: number; y: number };
  logStart: number;
  logEnd: number;
  screen: { x: number; y: number };
  t0: number;
  ms: number;
  onArrive?: () => void;
} | null = null;

/** The people the picker offers, plus whoever was last tapped. */
let target: TreeRec | null = null;
const picks = new Map<string, TreeRec>();

// Lights: a wave of people coming on, one by one.
let lightsOn = true;
let openOnLoad = true;
let wave: Wave | null = null;
/** The light the last frame drew, or null when nothing is animating. */
let light: Map<string, number> | null = null;
let lightFloor = TREE.dimLevel;
/** The opening's slow settle onto the whole tree. */
let openCam: { t0: number; ms: number } | null = null;
let tribePick = 'Judah';
/** Everyone the renderer asks about: every person, plus the crown lines. */
let allIds: string[] = [];

// ── Saved values ─────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ motion: MOTION, outline: LABEL_OUTLINE, lights: LIGHTS, prefs: { lightsOn, openOnLoad } }),
    );
  } catch {
    // Storage blocked: the lab still works, it just forgets on reload.
  }
}

function applyValues(
  motion: Partial<Motion> | undefined,
  outline: Partial<typeof LABEL_OUTLINE> | undefined,
  lights?: Partial<Lights>,
) {
  if (motion) {
    const { godBurst, landBurst, ...rest } = motion;
    Object.assign(MOTION, rest);
    if (godBurst) Object.assign(MOTION.godBurst, godBurst);
    if (landBurst) Object.assign(MOTION.landBurst, landBurst);
  }
  if (outline) Object.assign(LABEL_OUTLINE, outline);
  if (lights) {
    for (const k of ['open', 'tribe'] as const) {
      if (lights[k]) Object.assign(LIGHTS[k], lights[k]);
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    applyValues(v?.motion, v?.outline, v?.lights);
    if (typeof v?.prefs?.lightsOn === 'boolean') lightsOn = v.prefs.lightsOn;
    if (typeof v?.prefs?.openOnLoad === 'boolean') openOnLoad = v.prefs.openOnLoad;
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function resetValues() {
  applyValues(JSON.parse(JSON.stringify(SHIPPED_MOTION)), SHIPPED_OUTLINE, JSON.parse(JSON.stringify(SHIPPED_LIGHTS)));
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  buildDrawer();
}

// ── Canvas ───────────────────────────────────────────────────────────────

function measure() {
  DPR = window.devicePixelRatio || 1;
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  if (!model) return;
  const fit = fitView(model, W, H);
  fittedK = fit.k;
  if (atFitted) view = fit;
}

function anchor() {
  return { x: W / 2, y: H * 0.62 };
}

function render(now: number) {
  if (!model) return;
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
    light,
    lightFloor,
  });
  bursts = drawBursts(ctx, bursts, view, W, H, DPR, now);
}

// ── Lights ───────────────────────────────────────────────────────────────

/** A person's light in the plain on/off drawing of the current state. */
function onNow(id: string): number {
  if (!selectedTribe && !tracedPath) return 1;
  if (id === CROWN_LIGHT) return 0;
  if (tracedPath) return tracedPath.has(id) ? 1 : 0;
  return model?.nodes.get(id)?.tribe === selectedTribe ? 1 : 0;
}

/** From `prev` to whatever the state now says, one person at a time. */
function startWave(prev: Map<string, number>, rise: WaveSpec | null, fall: WaveSpec | null, focus: TreeRec | null, floor: number) {
  if (!model) return;
  const m = model;
  wave = new Wave({
    ids: allIds,
    from: (id) => prev.get(id) ?? 0,
    to: onNow,
    rise,
    fall,
    rank: (spec, ids) => rankBy(spec.order, ids, m, focus),
    now: performance.now(),
  });
  lightFloor = floor;
}

function stopLights() {
  wave = null;
  light = null;
  openCam = null;
}

/** Back to the whole tree, everyone lit, nothing moving. */
function clearAll() {
  stopLights();
  seq = null;
  glide = null;
  tracedPath = null;
  selectedTribe = null;
  pinned = null;
}

/** The tree coming on as it opens, from God outward. */
function playOpening() {
  if (!model) return;
  clearAll();
  const fit = fitView(model, W, H);
  view = fit;
  atFitted = true;
  if (!lightsOn) return;
  const o = LIGHTS.open;
  const god = model.rootById.get(GOD_ID) ?? null;
  startWave(new Map(), o, null, god, o.floor);
  const ms = o.spreadMs + o.fadeMs;
  if (o.zoomFrom !== 1 && ms > 0) {
    openCam = { t0: performance.now(), ms };
    atFitted = false;
  }
  if (o.godBurst) fireAt(god, MOTION.godBurst);
}

/** A tribe from its stone: the whole tree goes dim, then its line from God
 *  and every member come on, in order. */
function lightTribe(tribe: string) {
  if (!model) return;
  const list = model.byTribe.get(tribe);
  if (!list?.length) return;
  const head = list[0];
  seq = null;
  openCam = null;
  tracedPath = new Set([...ancestorChain(model, head).map((r) => r.id), ...list.map((r) => r.id)]);
  selectedTribe = tribe;
  pinned = null;
  if (lightsOn) startWave(new Map(), LIGHTS.tribe, null, head, TREE.dimLevel);
  else stopLights();
  if (!atFitted) glideToWhole();
}

// ── The sequence, exactly as FamilyTreeViewer runs it ────────────────────

function run(n: TreeRec | null) {
  if (!model || !n) return;
  const chain = ancestorChain(model, n);
  const line = chain.map((r) => r.id).reverse();
  const now = performance.now();
  glide = null;
  seq = null;
  // Everyone else goes dim at once; the climb lights the line.
  stopLights();
  selectedTribe = n.tribe || null;
  pinned = n;
  pulseStart = now;

  if (!entranceOn || line.length < 2) {
    tracedPath = new Set(line);
    if (isPlaced(n)) {
      glideTo({ x: n.x, y: n.y }, MOTION.endZoom, anchor());
      const colour = litColourOf(model, n);
      bursts.push(
        n.id === GOD_ID && entranceOn
          ? makeBurst(n.x, n.y, colour, MOTION.godBurst, now)
          : makeBurst(n.x, n.y, colour, MOTION.landBurst, now, MOTION.plainBurstScale),
      );
    }
    return;
  }

  const entrance = new Entrance({
    line,
    pts: chain
      .filter(isPlaced)
      .reverse()
      .map((r) => ({ x: r.x, y: r.y })),
    from: view,
    fit: fitView(model, W, H),
    W,
    H,
    anchor: isPlaced(n) ? anchor() : null,
    kEnd: MOTION.endZoom,
    skipOut: atFitted,
    startColour: litColourOf(model, chain[chain.length - 1]),
    landColour: litColourOf(model, n),
    now,
  });
  atFitted = false;
  seq = { entrance, line };
  tracedPath = new Set(line.slice(0, 1));
}

function releaseCamera() {
  glide = null;
  openCam = null;
  seq?.entrance.release();
  atFitted = false;
}

function glideTo(targetWorld: { x: number; y: number }, targetK: number, screen: { x: number; y: number }, onArrive?: () => void) {
  atFitted = false;
  glide = {
    startWorld: toWorld(screen.x, screen.y, view, W, H),
    targetWorld,
    logStart: Math.log(view.k),
    logEnd: Math.log(targetK),
    screen,
    t0: performance.now(),
    ms: 700,
    onArrive,
  };
}

function glideToWhole() {
  if (!model) return;
  seq?.entrance.release();
  const fit = fitView(model, W, H);
  const a = { x: W / 2, y: H / 2 };
  glideTo(toWorld(a.x, a.y, fit, W, H), fit.k, a, () => {
    view = fit;
    atFitted = true;
  });
}

/** Somewhere far out in the canopy at a close zoom, then play — the case
 *  that used to snap back. */
function startZoomedIn() {
  if (!model) return;
  const far = [...model.nodes.values()].filter(isPlaced).filter((n) => Math.hypot(n.x, n.y) > 500);
  const spot = far[Math.floor(Math.random() * far.length)];
  if (!spot || !isPlaced(spot)) return;
  clearAll();
  view = viewFor(spot.x, spot.y, 3, W / 2, H / 2, W, H);
  atFitted = false;
  setTimeout(() => run(target), 450);
}

// ── Frame loop, always running: this is a lab ──────────────────────────

let fpsFrames = 0;
let fpsT0 = performance.now();

function frame(now: number) {
  pulsePhase = pinned ? (Math.sin((now - pulseStart) / 480) + 1) / 2 : 0;

  if (seq) {
    const f = seq.entrance.step(now);
    if (f.view) view = f.view;
    if (f.bursts.length) bursts.push(...f.bursts);
    if (f.done) {
      tracedPath = new Set(seq.line);
      seq = null;
    } else if (tracedPath?.size !== f.lit) {
      tracedPath = new Set(seq.line.slice(0, f.lit));
    }
  }

  if (wave) {
    if (wave.done(now)) {
      wave = null;
      light = null;
    } else {
      light = wave.sample(now);
    }
  }

  if (openCam && model) {
    const t = Math.min(1, (now - openCam.t0) / openCam.ms);
    const fit = fitView(model, W, H);
    const c = toWorld(W / 2, H / 2, fit, W, H);
    const zf = LIGHTS.open.zoomFrom;
    view = viewFor(c.x, c.y, fit.k * (zf + (1 - zf) * ease(LIGHTS.open.cameraCurve, t)), W / 2, H / 2, W, H);
    if (t >= 1) {
      view = fit;
      openCam = null;
      atFitted = true;
    }
  }

  if (glide) {
    const t = Math.min(1, (now - glide.t0) / glide.ms);
    const e = 1 - Math.pow(1 - t, 3);
    const k = Math.exp(glide.logStart + (glide.logEnd - glide.logStart) * e);
    const wx = glide.startWorld.x + (glide.targetWorld.x - glide.startWorld.x) * e;
    const wy = glide.startWorld.y + (glide.targetWorld.y - glide.startWorld.y) * e;
    view = viewFor(wx, wy, k, glide.screen.x, glide.screen.y, W, H);
    if (t >= 1) {
      const arrived = glide.onArrive;
      glide = null;
      arrived?.();
    }
  }

  render(now);

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsT0))} fps`;
    fpsFrames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(frame);
}

// ── Gestures: drag to pan, pinch or wheel to zoom, tap to land on someone ──

type Pt = { x: number; y: number };
const pointers = new Map<number, Pt>();
let dragLast: Pt | null = null;
let pinchDist = 0;
let pinchMid: Pt = { x: 0, y: 0 };
let downPos: Pt = { x: 0, y: 0 };
let moved = false;
let multi = false;

function local(e: PointerEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clampK(k: number) {
  return Math.max(fittedK * MIN_ZOOM_OF_FIT, Math.min(MAX_ZOOM, k));
}

function zoomAbout(p: Pt, k: number) {
  const before = toWorld(p.x, p.y, view, W, H);
  view = { ...view, k: clampK(k) };
  const after = toWorld(p.x, p.y, view, W, H);
  view.x += (after.x - before.x) * view.k;
  view.y += (after.y - before.y) * view.k;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    dragLast = null;
    multi = true;
    return;
  }
  dragLast = local(e);
  downPos = { x: e.clientX, y: e.clientY };
  moved = false;
  multi = false;
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, local(e));
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8 && !moved) {
    moved = true;
    releaseCamera();
  }
  if (pointers.size >= 2) {
    releaseCamera();
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    view = { ...view, x: view.x + (mid.x - pinchMid.x), y: view.y + (mid.y - pinchMid.y) };
    if (pinchDist > 0 && dist > 0) zoomAbout(mid, view.k * (dist / pinchDist));
    pinchDist = dist;
    pinchMid = mid;
    return;
  }
  if (dragLast && moved) {
    const p = local(e);
    view = { ...view, x: view.x + (p.x - dragLast.x), y: view.y + (p.y - dragLast.y) };
    dragLast = p;
  } else if (dragLast) {
    dragLast = local(e);
  }
});

function pointerEnd(e: PointerEvent) {
  const single = pointers.size === 1 && !multi;
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {
    dragLast = { ...[...pointers.values()][0] };
    pinchDist = 0;
  } else if (pointers.size === 0) {
    dragLast = null;
    if (single && !moved && e.type === 'pointerup' && model) {
      const p = local(e);
      const n = pick(model, view, W, H, p.x, p.y, TOUCH ? 22 : 14);
      if (n) {
        setTarget(n);
        run(n);
      } else {
        clearAll();
      }
    }
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    releaseCamera();
    const r = canvas.getBoundingClientRect();
    zoomAbout({ x: e.clientX - r.left, y: e.clientY - r.top }, view.k * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
  canvas.addEventListener(g, (e) => e.preventDefault(), { passive: false });
}

// ── Who to land on ───────────────────────────────────────────────────────

function setTarget(n: TreeRec) {
  target = n;
  if (!picks.has(n.id)) {
    picks.set(n.id, n);
    const o = document.createElement('option');
    o.value = n.id;
    o.textContent = `${n.label} (tapped)`;
    whoSel.appendChild(o);
  }
  whoSel.value = n.id;
}

function buildPicker(m: TreeModel) {
  const deepest = (list: TreeRec[] | undefined) =>
    (list || []).filter(isPlaced).reduce<TreeRec | null>((best, n) => (!best || (n.depth ?? 0) > (best.depth ?? 0) ? n : best), null);
  const offer: [string, TreeRec | null | undefined][] = [
    ['Jacob', m.rootById.get(m.jacobId)],
    ['Jesus', m.nodes.get(m.jesusId)],
    ['Levi leaf', deepest(m.byTribe.get('Levi'))],
    ['Root person', deepest(m.byRootBranch.get('Esau'))],
    ['God', m.rootById.get(GOD_ID)],
  ];
  whoSel.innerHTML = '';
  for (const [what, rec] of offer) {
    if (!rec) continue;
    picks.set(rec.id, rec);
    const o = document.createElement('option');
    o.value = rec.id;
    o.textContent = rec.id === m.jacobId || rec.id === m.jesusId || rec.id === GOD_ID ? what : `${what}: ${rec.label}`;
    whoSel.appendChild(o);
  }
  target = picks.get(whoSel.value) ?? null;
}

whoSel.addEventListener('change', () => {
  target = picks.get(whoSel.value) ?? null;
  run(target);
});
document.getElementById('replay')!.addEventListener('click', () => run(target));
document.getElementById('open')!.addEventListener('click', playOpening);
document.getElementById('zoomed')!.addEventListener('click', startZoomedIn);
document.getElementById('whole')!.addEventListener('click', glideToWhole);

// ── The drawer ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  parent?.appendChild(e);
  return e;
}

function heading(text: string, action?: { label: string; onClick: () => void }) {
  const h = el('h2', { textContent: text }, drawer);
  if (action) {
    const b = el('button', { textContent: action.label }, h);
    b.addEventListener('click', action.onClick);
  }
}

function slider(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number) {
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: label }, row);
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) }, row);
  input.value = String(get());
  const out = el('output', { textContent: fmtNum(get()) }, row);
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = fmtNum(get());
    save();
  });
}

function checks(items: [string, () => boolean, (v: boolean) => void][]) {
  const wrap = el('div', { className: 'checks' }, drawer);
  for (const [label, get, set] of items) {
    const l = el('label', {}, wrap);
    const c = el('input', { type: 'checkbox', checked: get() }, l);
    l.append(label);
    c.addEventListener('change', () => {
      set(c.checked);
      save();
    });
  }
}

/** Approximations of the named curves, used when switching to custom so the
 *  handles start somewhere sensible. */
const CURVE_AS_BEZIER: Record<string, [number, number, number, number]> = {
  cubic: [0.65, 0, 0.35, 1],
  sine: [0.37, 0, 0.63, 1],
  quint: [0.83, 0, 0.17, 1],
  expo: [0.87, 0, 0.13, 1],
  linear: [0.25, 0.25, 0.75, 0.75],
};

function curveControl(label: string, get: () => Curve, set: (c: Curve) => void) {
  const wrap = el('div', { className: 'curve' }, drawer);
  el('label', { textContent: label }, wrap);
  const right = el('div', {}, wrap);
  const sel = el('select', {}, right);
  for (const n of [...CURVE_NAMES, 'custom']) {
    el('option', { value: n, textContent: n === 'cubic' ? 'cubic in-out' : n === 'custom' ? 'custom bezier' : n }, sel);
  }
  const cv = el('canvas', {}, right);
  const c2 = cv.getContext('2d')!;
  const S = 150;
  const Y0 = -0.25;
  const Y1 = 1.25;
  const px = (x: number) => 10 + x * (S - 20);
  const py = (y: number) => S - 10 - ((y - Y0) / (Y1 - Y0)) * (S - 20);

  function paint() {
    const d = window.devicePixelRatio || 1;
    cv.width = S * d;
    cv.height = S * d;
    c2.setTransform(d, 0, 0, d, 0, 0);
    c2.clearRect(0, 0, S, S);
    c2.strokeStyle = '#2a2520';
    c2.strokeRect(px(0), py(1), px(1) - px(0), py(0) - py(1));
    const cur = get();
    c2.strokeStyle = '#b07a3c';
    c2.lineWidth = 2;
    c2.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const y = ease(cur, t);
      if (i === 0) c2.moveTo(px(t), py(y));
      else c2.lineTo(px(t), py(y));
    }
    c2.stroke();
    if (Array.isArray(cur)) {
      const [x1, y1, x2, y2] = cur;
      c2.strokeStyle = '#6b6153';
      c2.lineWidth = 1;
      c2.beginPath();
      c2.moveTo(px(0), py(0));
      c2.lineTo(px(x1), py(y1));
      c2.moveTo(px(1), py(1));
      c2.lineTo(px(x2), py(y2));
      c2.stroke();
      c2.fillStyle = '#e8dcc8';
      for (const [hx, hy] of [
        [x1, y1],
        [x2, y2],
      ]) {
        c2.beginPath();
        c2.arc(px(hx), py(hy), 6, 0, Math.PI * 2);
        c2.fill();
      }
    }
  }

  const cur = get();
  sel.value = Array.isArray(cur) ? 'custom' : cur;
  sel.addEventListener('change', () => {
    const prev = get();
    if (sel.value === 'custom') {
      const [a, b, c, d] = Array.isArray(prev) ? prev : CURVE_AS_BEZIER[prev];
      set([a, b, c, d]);
    }
    else set(sel.value as Curve);
    paint();
    save();
  });

  // Drag a handle.
  let dragging: 0 | 1 | null = null;
  const fromEvent = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * S;
    const y = ((e.clientY - r.top) / r.height) * S;
    return {
      x: Math.max(0, Math.min(1, (x - 10) / (S - 20))),
      y: Math.max(Y0, Math.min(Y1, Y0 + ((S - 10 - y) / (S - 20)) * (Y1 - Y0))),
    };
  };
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => {
    const b = get();
    if (!Array.isArray(b)) return;
    const p = fromEvent(e);
    const d1 = Math.hypot(p.x - b[0], p.y - b[1]);
    const d2 = Math.hypot(p.x - b[2], p.y - b[3]);
    dragging = d1 <= d2 ? 0 : 1;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    const b = get();
    if (dragging === null || !Array.isArray(b)) return;
    const p = fromEvent(e);
    const next: [number, number, number, number] = [...b];
    const round = (v: number) => Math.round(v * 100) / 100;
    next[dragging * 2] = round(p.x);
    next[dragging * 2 + 1] = round(p.y);
    set(next);
    paint();
  });
  const end = () => {
    if (dragging !== null) save();
    dragging = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  paint();
}

function burstControls(title: string, spec: BurstSpec, fire: () => void) {
  heading(title, { label: 'Fire', onClick: fire });
  checks([
    ['Glow flare', () => spec.flare, (v) => (spec.flare = v)],
    ['Shockwave ring', () => spec.ring, (v) => (spec.ring = v)],
    ['Sparks', () => spec.sparks, (v) => (spec.sparks = v)],
    ['Light rays', () => spec.rays, (v) => (spec.rays = v)],
  ]);
  slider('Size (px)', () => spec.size, (v) => (spec.size = v), 10, 300, 1);
  slider('Duration (ms)', () => spec.ms, (v) => (spec.ms = v), 150, 4000, 50);
  slider('Sparks', () => spec.count, (v) => (spec.count = v), 0, 200, 1);
  slider('Spread (°)', () => spec.spread, (v) => (spec.spread = v), 20, 360, 5);
  slider('Gravity', () => spec.gravity, (v) => (spec.gravity = v), -300, 800, 10);
  slider('Spark size', () => spec.particleSize, (v) => (spec.particleSize = v), 0.3, 8, 0.1);
  slider('Fade', () => spec.fade, (v) => (spec.fade = v), 0.3, 5, 0.1);
  slider('Glow', () => spec.glow, (v) => (spec.glow = v), 0, 2.5, 0.05);
}

function fireAt(rec: TreeRec | null | undefined, spec: BurstSpec, colour?: string) {
  if (!model || !rec || !isPlaced(rec)) return;
  bursts.push(makeBurst(rec.x, rec.y, colour ?? litColourOf(model, rec), spec, performance.now()));
}

function choice<T extends string>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) {
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: label }, row);
  const sel = el('select', {}, row);
  for (const [value, text] of options) el('option', { value, textContent: text }, sel);
  sel.value = get();
  sel.addEventListener('change', () => {
    set(sel.value as T);
    save();
  });
}

/** The sliders every light wave has. */
function waveControls(spec: WaveSpec) {
  choice('Order', Object.entries(ORDER_NAMES) as [Order, string][], () => spec.order, (v) => (spec.order = v));
  slider('Spread (ms)', () => spec.spreadMs, (v) => (spec.spreadMs = v), 0, 6000, 25);
  slider('Each fade', () => spec.fadeMs, (v) => (spec.fadeMs = v), 0, 2000, 10);
  curveControl('Spacing', () => spec.orderCurve, (c) => (spec.orderCurve = c));
  slider('Scatter', () => spec.jitter, (v) => (spec.jitter = v), 0, 1, 0.01);
  slider('Flash', () => spec.flash, (v) => (spec.flash = v), 0, 2, 0.05);
  slider('Flicker', () => spec.flicker, (v) => (spec.flicker = v), 0, 1, 0.01);
  slider('Flicker speed', () => spec.flickerHz, (v) => (spec.flickerHz = v), 1, 40, 0.5);
}

/** Everything lit and still, then `then` — so each Play starts the same way. */
function fromWholeTree(then: () => void) {
  clearAll();
  then();
}

function buildDrawer() {
  if (!model) return;
  const m = model;
  drawer.innerHTML = '';

  el('p', { className: 'title', textContent: 'Tree motion lab v2.0' }, drawer);

  heading('Preview');
  checks([
    ['Grand entrance', () => entranceOn, (v) => (entranceOn = v)],
    ['All names', () => allNames, (v) => (allNames = v)],
    [
      'Animate lights',
      () => lightsOn,
      (v) => {
        lightsOn = v;
        if (!v) stopLights();
      },
    ],
    ['Open on load', () => openOnLoad, (v) => (openOnLoad = v)],
  ]);
  el('p', { className: 'note', textContent: 'Tap a name on the tree to land on them, or pick one above. Values are saved in this browser. Turn off Animate lights to compare with the plain all-on / all-off.' }, drawer);

  heading('Opening the tree', { label: 'Play', onClick: playOpening });
  el('p', { className: 'note', textContent: 'Everyone comes on one by one, God first. “By generation” lights each generation together; “one at a time” goes person by person.' }, drawer);
  waveControls(LIGHTS.open);
  slider('Start bright', () => LIGHTS.open.floor, (v) => (LIGHTS.open.floor = v), 0, 0.5, 0.01);
  slider('Zoom from', () => LIGHTS.open.zoomFrom, (v) => (LIGHTS.open.zoomFrom = v), 0.4, 1.6, 0.01);
  curveControl('Camera', () => LIGHTS.open.cameraCurve, (c) => (LIGHTS.open.cameraCurve = c));
  checks([['God’s burst at the start', () => LIGHTS.open.godBurst, (v) => (LIGHTS.open.godBurst = v)]]);

  heading('Tribe from its stone', { label: 'Play', onClick: () => fromWholeTree(() => lightTribe(tribePick)) });
  el('p', { className: 'note', textContent: 'The whole tree goes dim, then the tribe’s line from God and every member come on in order. Picking a tribe below plays it too.' }, drawer);
  choice(
    'Tribe',
    Object.entries(STONES).map(([t, st]) => [t, `${t} · ${st.stone}`] as [string, string]),
    () => tribePick,
    (v) => {
      tribePick = v;
      fromWholeTree(() => lightTribe(v));
    },
  );
  waveControls(LIGHTS.tribe);

  heading('Timing');
  slider('Glide out', () => MOTION.outMs, (v) => (MOTION.outMs = v), 0, 2500, 25);
  slider('Hold', () => MOTION.holdMs, (v) => (MOTION.holdMs = v), 0, 2500, 25);
  slider('Climb', () => MOTION.climbMs, (v) => (MOTION.climbMs = v), 300, 8000, 50);
  slider('End zoom', () => MOTION.endZoom, (v) => (MOTION.endZoom = v), 0.3, 4, 0.02);
  slider('Plain burst', () => MOTION.plainBurstScale, (v) => (MOTION.plainBurstScale = v), 0.1, 1.5, 0.05);

  heading('Curves');
  curveControl('Glide out', () => MOTION.outCurve, (c) => (MOTION.outCurve = c));
  curveControl('Camera climb', () => MOTION.cameraCurve, (c) => (MOTION.cameraCurve = c));
  curveControl('Line lighting', () => MOTION.lineCurve, (c) => (MOTION.lineCurve = c));

  burstControls('God’s burst', MOTION.godBurst, () => fireAt(m.rootById.get(GOD_ID), MOTION.godBurst));
  burstControls('Landing burst', MOTION.landBurst, () => fireAt(target, MOTION.landBurst));

  heading('Name outline');
  slider('Width', () => LABEL_OUTLINE.width, (v) => (LABEL_OUTLINE.width = v), 0, 6, 0.1);
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: 'Color' }, row);
  const colour = el('input', { type: 'color', value: LABEL_OUTLINE.colour }, row);
  const colourOut = el('output', { textContent: LABEL_OUTLINE.colour }, row);
  colour.addEventListener('input', () => {
    LABEL_OUTLINE.colour = colour.value;
    colourOut.textContent = colour.value;
    save();
  });

  heading('Copy values', { label: 'Copy', onClick: copyValues });
  const ta = el('textarea', { readOnly: true, id: 'readout' }, drawer);
  ta.value = readout();

  heading('Start again', { label: 'Reset to shipped', onClick: resetValues });
  el('p', { className: 'note', textContent: 'Puts back the values the app ships with now.' }, drawer);
}

// ── Copy values ──────────────────────────────────────────────────────────

/** Keep the readout in step with every control. Attached once, since the
 *  drawer is rebuilt on Reset. */
function refreshReadout() {
  const ta = document.getElementById('readout') as HTMLTextAreaElement | null;
  if (ta) ta.value = readout();
}
drawer.addEventListener('input', refreshReadout);
drawer.addEventListener('change', refreshReadout);
drawer.addEventListener('pointerup', refreshReadout);

function fmtNum(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function fmt(v: unknown, indent: string): string {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => fmt(x, indent)).join(', ')}]`;
  if (v && typeof v === 'object') {
    const inner = indent + '  ';
    const lines = Object.entries(v).map(([k, x]) => `${inner}${k}: ${fmt(x, inner)},`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return String(v);
}

function readout(): string {
  return (
    `// src/lib/familyTree/motion.ts\nexport const MOTION: Motion = ${fmt(MOTION, '')};\n\n` +
    `// src/lib/familyTree/motion.ts\nexport const LIGHTS: Lights = ${fmt(LIGHTS, '')};\n\n` +
    `// src/lib/familyTree/config.ts\nexport const LABEL_OUTLINE = { width: ${fmtNum(LABEL_OUTLINE.width)}, colour: '${LABEL_OUTLINE.colour}' };\n`
  );
}

async function copyValues() {
  const text = readout();
  const ta = document.getElementById('readout') as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  try {
    await navigator.clipboard.writeText(text);
    flash('Copied');
  } catch {
    ta?.select();
    const ok = document.execCommand?.('copy');
    flash(ok ? 'Copied' : 'Select the text and copy it');
  }
}

function flash(msg: string) {
  fpsEl.textContent = msg;
  fpsT0 = performance.now() + 1200;
}

// ── Start ────────────────────────────────────────────────────────────────

load();
new ResizeObserver(() => measure()).observe(stage);

loadFamilyTree()
  .then((data) => {
    model = layout(data);
    allIds = [...model.nodes.keys(), ...model.rootById.keys(), CROWN_LIGHT];
    measure();
    view = fitView(model, W, H);
    atFitted = true;
    buildPicker(model);
    buildDrawer();
    if (openOnLoad) playOpening();
    requestAnimationFrame(frame);
    document.fonts?.load('600 14px Milonga').catch(() => {});
  })
  .catch(() => {
    drawer.innerHTML = '<p class="note">Couldn’t load the family tree.</p>';
  });
