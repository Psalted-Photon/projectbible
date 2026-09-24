// Draws one breastplate stone into a canvas: idle spin, drag to turn, optional
// phone tilt, and a small pop when the stone changes. The canvas is
// transparent, so whatever sits behind it is the backdrop — the stones were
// tuned against the dark navy stage in public/gem-lab.html.
//
// Each view owns a WebGL context and browsers cap those at around sixteen, so
// a list of many stones should use the flat swatch (Stone.sw) and save the 3D
// view for the one being looked at.

import * as THREE from 'three';
import type { Stone } from './stones';
import { VERT, GEM_FRAG, CAB_FRAG } from './shaders';
import { geometryFor } from './geometry';

export interface GemViewOptions {
  /** Drag to turn. Off for a purely decorative stone. */
  interactive?: boolean;
  /** Follow the phone's tilt where the browser allows it without asking. */
  tilt?: boolean;
}

export interface GemView {
  setStone(s: Stone): void;
  /** iOS only hands out tilt after a tap; call this from one. */
  requestTilt(): Promise<boolean>;
  destroy(): void;
}

function materialFor(s: Stone) {
  if (s.kind === 'gem') {
    return new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: GEM_FRAG, uniforms: {
        uColor: { value: new THREE.Vector3(...s.color) }, uIor: { value: s.ior }, uDisp: { value: s.disp },
        uDepth: { value: s.depth }, uFacets: { value: s.facets }, uCamObj: { value: new THREE.Vector3() },
        uRot: { value: new THREE.Matrix3() }, uExposure: { value: 1.0 },
      },
    });
  }
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CAB_FRAG, uniforms: {
      uType: { value: s.type }, uA: { value: new THREE.Vector3(...s.A) }, uB: { value: new THREE.Vector3(...s.B) },
      uC: { value: new THREE.Vector3(...s.C) }, uTrans: { value: s.trans }, uExposure: { value: 1.0 },
    },
  });
}

/** Returns null when the device can't start WebGL; show the swatch instead. */
export function createGemView(canvas: HTMLCanvasElement, stone: Stone, opts: GemViewOptions = {}): GemView | null {
  const { interactive = true, tilt = true } = opts;

  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const tiltG = new THREE.Group(), spinG = new THREE.Group();
  tiltG.add(spinG); scene.add(tiltG);

  let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  let popT = 1;
  function setStone(s: Stone) {
    if (mesh) { spinG.remove(mesh); mesh.material.dispose(); }
    mesh = new THREE.Mesh(geometryFor(s), materialFor(s));
    if (s.kind === 'cab') mesh.position.y = -0.12;
    spinG.add(mesh);
    popT = 0;
  }

  // Fit the stone to whichever side of the canvas is shorter.
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(16));
    const d = Math.max(2.5 / (2 * t), 2.6 / (2 * t * camera.aspect));
    camera.position.set(0, 0, d); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas); resize();

  // Drag
  let dragging = false, lx = 0, ly = 0, lt = 0, spinVel = 0.35, dragTilt = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true; lx = e.clientX; ly = e.clientY; lt = performance.now();
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now(), dt = Math.max(1, now - lt) / 1000;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    spinG.rotation.y += dx * 0.009;
    spinVel = THREE.MathUtils.clamp(dx * 0.009 / dt, -8, 8);
    dragTilt = THREE.MathUtils.clamp(dragTilt + dy * 0.006, -0.6, 0.9);
    lx = e.clientX; ly = e.clientY; lt = now;
  };
  const onUp = () => { dragging = false; };
  if (interactive) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  // Tilt: the resting angle drifts slowly toward however the phone is held,
  // so only movement away from that registers.
  let gx = 0, gz = 0, tgx = 0, tgz = 0, gyroOn = false;
  let base: { b: number; g: number } | null = null;
  const onOri = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    if (!base) base = { b: e.beta, g: e.gamma };
    base.b += (e.beta - base.b) * 0.004; base.g += (e.gamma - base.g) * 0.004;
    tgx = THREE.MathUtils.clamp((e.beta - base.b) * Math.PI / 180, -0.6, 0.6);
    tgz = THREE.MathUtils.clamp(-(e.gamma - base.g) * Math.PI / 180, -0.6, 0.6);
    gyroOn = true;
  };
  type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
  const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as IOSOrientation | undefined;
  let listening = false;
  const listen = () => { if (!listening) { window.addEventListener('deviceorientation', onOri); listening = true; } };
  if (tilt && DOE && typeof DOE.requestPermission !== 'function') listen();

  async function requestTilt() {
    if (!DOE) return false;
    if (typeof DOE.requestPermission !== 'function') { listen(); return true; }
    try {
      if (await DOE.requestPermission() !== 'granted') return false;
      listen(); return true;
    } catch { return false; }
  }

  // Loop. Stops while the canvas is off screen, so a stone in a closed sheet
  // or scrolled-away card costs nothing.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inv = new THREE.Matrix4();
  let raf = 0, last = 0;
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const idle = reduce ? 0 : (gyroOn ? 0.12 : 0.35);
    if (!dragging) { spinVel += (idle - spinVel) * Math.min(1, dt * 2.5); spinG.rotation.y += spinVel * dt; }
    gx += (tgx - gx) * Math.min(1, dt * 8); gz += (tgz - gz) * Math.min(1, dt * 8);
    tiltG.rotation.x = 0.55 + dragTilt + gx;
    tiltG.rotation.z = gz;
    popT = Math.min(1, popT + dt * 3);
    const e = 1 - Math.pow(1 - popT, 3);
    spinG.scale.setScalar(0.85 + 0.15 * e);
    if (mesh) {
      mesh.updateMatrixWorld(true);
      const u = mesh.material.uniforms;
      if (u.uRot) {
        u.uRot.value.setFromMatrix4(mesh.matrixWorld);
        inv.copy(mesh.matrixWorld).invert();
        u.uCamObj.value.copy(camera.position).applyMatrix4(inv);
      }
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) start(); else stop();
  });
  io.observe(canvas);

  setStone(stone);
  start();

  return {
    setStone,
    requestTilt,
    destroy() {
      stop();
      io.disconnect();
      ro.disconnect();
      if (listening) window.removeEventListener('deviceorientation', onOri);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      mesh?.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
