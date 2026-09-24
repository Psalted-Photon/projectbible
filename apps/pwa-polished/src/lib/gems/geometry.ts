// Stone shapes, unchanged from public/gem-lab.html. A faceted cut is a stack
// of rings joined into flat triangles with one normal each, so every facet
// catches light on its own. Shapes are built once and shared between gems.

import * as THREE from 'three';
import type { Stone } from './stones';

const TAU = Math.PI * 2;
type P3 = [number, number, number];
type RingPt = { p: P3; a: number };
type Shape = (a: number) => [number, number];

const SHAPES: Record<'round' | 'oval' | 'cushion', Shape> = {
  round: a => [Math.cos(a), Math.sin(a)],
  oval: a => [Math.cos(a), Math.sin(a) * 0.72],
  cushion: a => {
    const c = Math.cos(a), s = Math.sin(a), p = 3.2;
    return [Math.sign(c) * Math.pow(Math.abs(c), 2 / p), Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * 0.9];
  },
};
const OCT: [number, number][] = (() => {
  const W = 1, H = 0.7, c = 0.22;
  return [[W - c, H], [-(W - c), H], [-W, H - c], [-W, -(H - c)], [-(W - c), -H], [W - c, -H], [W, -(H - c)], [W, H - c]];
})();

const angleOf = (p: P3) => { const a = Math.atan2(p[2], p[0]); return a < 0 ? a + TAU : a; };
const prep = (pts: P3[]): RingPt[] => pts.map(p => ({ p, a: angleOf(p) })).sort((u, v) => u.a - v.a);

function ring(shape: Shape, n: number, off: number, r: number, y: number) {
  const out: P3[] = [];
  for (let i = 0; i < n; i++) { const [x, z] = shape(off + i * TAU / n); out.push([x * r, y, z * r]); }
  return prep(out);
}
const octRing = (r: number, y: number) => prep(OCT.map(([x, z]): P3 => [x * r, y, z * r]));

function connect(A: RingPt[], B: RingPt[], tris: P3[][]) {
  const nA = A.length, nB = B.length;
  const ang = (R: RingPt[], i: number) => R[i % R.length].a + TAU * Math.floor(i / R.length);
  let i = 0, j = 0;
  while (i < nA || j < nB) {
    if (j >= nB || (i < nA && ang(A, i + 1) <= ang(B, j + 1))) { tris.push([A[i % nA].p, A[(i + 1) % nA].p, B[j % nB].p]); i++; }
    else { tris.push([A[i % nA].p, B[(j + 1) % nB].p, B[j % nB].p]); j++; }
  }
}
function fan(center: P3, A: RingPt[], tris: P3[][]) {
  for (let i = 0; i < A.length; i++) tris.push([center, A[i].p, A[(i + 1) % A.length].p]);
}

function buildFaceted(rings: RingPt[][], top: P3, bottom: P3) {
  const tris: P3[][] = [];
  fan(top, rings[0], tris);
  for (let k = 0; k < rings.length - 1; k++) connect(rings[k], rings[k + 1], tris);
  fan(bottom, rings[rings.length - 1], tris);
  const pos: number[] = [], nor: number[] = [];
  for (const [a, b0, c0] of tris) {
    let b = b0, c = c0;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]); if (len < 1e-9) continue;
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
    n = [n[0] / len, n[1] / len, n[2] / len];
    pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function brilliantLike(shape: keyof typeof SHAPES) {
  const s = SHAPES[shape];
  return buildFaceted([
    ring(s, 8, 0, 0.56, 0.34),
    ring(s, 8, TAU / 16, 0.80, 0.20),
    ring(s, 16, TAU / 32, 0.93, 0.10),
    ring(s, 16, 0, 1.00, 0.025),
    ring(s, 16, 0, 1.00, -0.025),
    ring(s, 16, TAU / 32, 0.76, -0.22),
    ring(s, 8, TAU / 16, 0.40, -0.52),
  ], [0, 0.34, 0], [0, -0.86, 0]);
}
function stepCut() {
  return buildFaceted([
    octRing(0.60, 0.30), octRing(0.78, 0.22), octRing(0.92, 0.12),
    octRing(1.00, 0.03), octRing(1.00, -0.03),
    octRing(0.82, -0.20), octRing(0.58, -0.38), octRing(0.32, -0.54), octRing(0.10, -0.64),
  ], [0, 0.30, 0], [0, -0.66, 0]);
}
function cabochon() {
  const top = new THREE.SphereGeometry(1, 128, 48, 0, TAU, 0, Math.PI / 2);
  top.scale(1.0, 0.48, 0.74);
  return top;
}

// Never disposed: there are only five shapes and every gem on screen reuses them.
const cache: Record<string, THREE.BufferGeometry> = {};

export function geometryFor(s: Stone): THREE.BufferGeometry {
  const key = s.kind === 'cab' ? 'cab' : s.cut;
  if (!cache[key]) {
    cache[key] = key === 'cab' ? cabochon()
      : key === 'emerald' ? stepCut()
      : brilliantLike(key === 'brilliant' ? 'round' : key as 'oval' | 'cushion');
  }
  return cache[key];
}
