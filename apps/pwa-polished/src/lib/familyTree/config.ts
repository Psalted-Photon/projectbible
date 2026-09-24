/**
 * The family tree's locked numbers.
 *
 * Everything here came out of the standalone lab (public/familytree.html,
 * roadmap #25) once the user had the twelve boughs and the eleven pre-Jacob
 * branches sitting where they wanted them. The lab's own dials are gone —
 * these are the values they were left on, copied out of its readout panel —
 * and nothing here should change without going back through the lab, because
 * changing one bough's numbers can move where its neighbours need to sit too.
 */

/** One bough or branch's hand-placed direction: {angle, spread, reach, lean}. */
export interface BranchSpec {
  angle: number;
  spread: number;
  reach: number;
  lean: number;
}

// ── Colour ───────────────────────────────────────────────────────────────
// Breastpiece stones, Exodus 28:17-20, in birth order. Polished and engraved
// like seals, not faceted. Jasper speckles so it does not collide with ruby,
// the greens are spread aqua to yellow-green, agate and onyx are striped.

export interface StoneSpec {
  stone: string;
  c: string;
  lit: string;
  striped?: boolean;
  speckled?: boolean;
}

export const STONES: Record<string, StoneSpec> = {
  Reuben: { stone: 'ruby', c: '#9e2b32', lit: '#e0555e' },
  Simeon: { stone: 'topaz', c: '#b07d1a', lit: '#f0b73c' },
  Levi: { stone: 'beryl', c: '#2e8b6f', lit: '#4fd6ad' },
  Judah: { stone: 'turquoise', c: '#2b8ca8', lit: '#54cdee' },
  Dan: { stone: 'sapphire', c: '#2f4ba8', lit: '#5f7fe8' },
  Naphtali: { stone: 'emerald', c: '#1f7a3d', lit: '#3ec46a' },
  Gad: { stone: 'jacinth', c: '#a8531f', lit: '#ec8340' },
  Asher: { stone: 'agate', c: '#8a6b4a', lit: '#c9a077', striped: true },
  Issachar: { stone: 'amethyst', c: '#6b3fa0', lit: '#a271e0' },
  Zebulun: { stone: 'chrysolite', c: '#7d9420', lit: '#bcd94a' },
  Joseph: { stone: 'onyx', c: '#57534e', lit: '#9b948c', striped: true },
  Benjamin: { stone: 'jasper', c: '#a03f5e', lit: '#e06d92', speckled: true },
  // Dinah has no entry on purpose. The breastpiece carries twelve stones for
  // twelve sons; inventing a pearl for her put a thirteenth on Exodus 28. She
  // falls through to LINEN in drawBough and keeps her node and her tap.
};

export const GOLD = '#c9a227';
export const LINEN = '#6b6153';
/** Wives. A rose node says "married in" at a glance, which the labels do not. */
export const ROSE = '#a35a6e';
export const ROSE_LIT = '#e08aa0';
/** The foot of the trunk. God has no father, so he is the one pre-Jacob node
 *  with nothing below him, and he is drawn as the largest and the gold one. */
export const GOD_ID = 'god_1324';

/** The pre-Jacob boughs are not tribes, so they carry no breastpiece stone and
 *  are told apart by shades of bark instead. The trunk stays brightest,
 *  because it is the line the whole tree hangs from. */
export const ROOT_COLOURS: Record<string, { c: string; lit: string }> = {
  Trunk: { c: '#8a6f2a', lit: GOLD },
  Cain: { c: '#6e4a3a', lit: '#b8795c' },
  Ham: { c: '#6b5a33', lit: '#b5964f' },
  Japheth: { c: '#4f5f42', lit: '#89a86f' },
  Aram: { c: '#4a5a5c', lit: '#7fa0a3' },
  Joktan: { c: '#5d5733', lit: '#9d9459' },
  Nahor: { c: '#5a4a5e', lit: '#95809b' },
  Haran: { c: '#4e4558', lit: '#877a94' },
  Ishmael: { c: '#6a5240', lit: '#b08a63' },
  Midian: { c: '#63503a', lit: '#a68a63' },
  Jokshan: { c: '#585040', lit: '#948868' },
  Esau: { c: '#73472f', lit: '#c07b52' },
};

// ── Geometry: the twelve boughs ─────────────────────────────────────────
// Judah (278) and Levi (188) are 70% of everyone traced and sit next to each
// other in birth order — the pair the user spent the most dial time on.

export const BOUGHS: Record<string, BranchSpec> = {
  Levi: { angle: -72, spread: 46, reach: 4.78, lean: -4 },
  Benjamin: { angle: 125, spread: 42, reach: 8.0, lean: 10 },
  Joseph: { angle: 101, spread: 21, reach: 8.0, lean: -10 },
  Judah: { angle: -17, spread: 73, reach: 6.33, lean: -2 },
  Reuben: { angle: -127, spread: 41, reach: 8.0, lean: -37 },
  Asher: { angle: 62, spread: 24, reach: 8.0, lean: -10 },
  Gad: { angle: 45, spread: 26, reach: 8.0, lean: 28 },
  Dan: { angle: 21, spread: 1, reach: 8.0, lean: 33 },
  Dinah: { angle: 98, spread: 1, reach: 2.92, lean: -147 },
  Zebulun: { angle: 89, spread: 7, reach: 8.0, lean: -31 },
  Naphtali: { angle: 29, spread: 12, reach: 8.0, lean: 5 },
  Simeon: { angle: -106, spread: 24, reach: 8.0, lean: -13 },
  Issachar: { angle: 80, spread: 12, reach: 8.0, lean: -5 },
};

// ── Geometry: before Jacob ───────────────────────────────────────────────
// 'Trunk' is Adam → Jacob, angled absolutely from straight up. Every other
// row is an offset from the trunk's own angle where it forks, so a bough
// swings about its own fork and the trunk's sway carries its boughs with it.

export const ROOTS: Record<string, BranchSpec> = {
  Trunk: { angle: 179, spread: 303, reach: 3.5, lean: 0 },
  Cain: { angle: 85, spread: 26, reach: 2.37, lean: 21 },
  Ham: { angle: 108, spread: 83, reach: 3.99, lean: 23 },
  Japheth: { angle: -90, spread: 78, reach: 3.95, lean: -8 },
  Aram: { angle: -108, spread: 41, reach: 2.69, lean: -6 },
  Joktan: { angle: 112, spread: 103, reach: 2.1, lean: 7 },
  Nahor: { angle: -56, spread: 50, reach: 2.94, lean: -9 },
  Haran: { angle: 112, spread: 32, reach: 2.23, lean: -5 },
  Ishmael: { angle: 137, spread: 69, reach: 2.77, lean: 9 },
  Midian: { angle: 103, spread: 26, reach: 1.54, lean: 5 },
  Jokshan: { angle: -134, spread: 28, reach: 1.5, lean: -3 },
  Esau: { angle: -63, spread: 81, reach: 2.2, lean: -10 },
};

/** Whole-tree constants — generation gap, curve, and the rest of what used to
 *  be GLOBAL_SPECS' `def` values. */
export interface TreeSpec {
  ringGap: number;
  curve: number;
  trunkLen: number;
  rootGap: number;
  rootArc: number;
  coupleGap: number;
  jitter: number;
  nodeSize: number;
  thickness: number;
  dimLevel: number;
  glow: number;
}

export const TREE: TreeSpec = {
  ringGap: 68,
  curve: 0.49,
  trunkLen: 78,
  rootGap: 103,
  rootArc: 0,
  coupleGap: 29,
  jitter: 0,
  nodeSize: 6.2,
  thickness: 0.7,
  dimLevel: 0.23,
  glow: 0.55,
};

/**
 * The two trunk offshoots given a fixed angle instead of the automatic
 * `cur + share / 2` a lone child would otherwise land on.
 *
 * Both fork at a point on the trunk where they are their father's ONLY
 * offshoot placed this way (Abel is Adam's one trunk offshoot; Elam is the
 * middle of Shem's three sons, but the other two are on the trunk itself),
 * so the automatic placement puts them dead centre of the fan at 179° — for
 * Abel that points straight down past God, making him the tree's lowest
 * point; for Elam it lands him on the trunk between Cainan and Mahalaleel.
 *
 * The two angles were chosen together: each now sits at least 224 units from
 * every other person, but the obvious pair — Abel at 50°, Elam at 130° —
 * puts them only 51 units apart, because both move into the same gap. Don't
 * change one without re-checking the other against the built tree.
 */
export const OFFSHOOT_ANGLES: Record<string, number> = {
  abel_13: 50,
  elam_1049: -130,
};

// ── Zoom ─────────────────────────────────────────────────────────────────

/** The minimum zoom is this fraction of whatever fits the whole tree. */
export const MIN_ZOOM_OF_FIT = 0.5;
export const MAX_ZOOM = 9;
/** Where a glide lands when the tree opens focused on one person. */
export const FOCUS_ZOOM = 1.2;

// ── All-names labels ───────────────────────────────────────────────────
// A bough name (drawn only when "All names" is on) is skipped below this
// on-screen size and fully opaque above it, fading in between the two — the
// same readable-only rule the lab's own names have always followed at the
// tribe and root level.
export const LABEL_MIN_PX = 6;
export const LABEL_FULL_PX = 8;
