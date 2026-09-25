// The twelve stones of the high priest's breastplate, in Exodus 28:17–20
// order (four rows of three). Several identifications are uncertain; `as`
// says what each one is drawn as. Kept free of three.js so the data can be
// read anywhere without pulling in the renderer.

export type Vec3 = [number, number, number];

/** A faceted, transparent stone. */
export interface CutStone {
  kind: 'gem';
  cut: 'brilliant' | 'oval' | 'cushion' | 'emerald';
  /** Transmittance tint, linear. */
  color: Vec3;
  ior: number;
  /** Spread between red and blue refraction; drives the fire. */
  disp: number;
  /** How strongly the tint builds up through the stone. */
  depth: number;
  facets: number;
}

/** 0 carnelian, 1 lapis, 2 agate, 3 onyx, 4 jasper. */
export type CabPattern = 0 | 1 | 2 | 3 | 4;

/** Proportions and seeded lumpiness of a tumbled stone. */
export interface PebbleShape {
  /** Width, height, depth. */
  s: Vec3;
  /** How far the surface wanders in and out. */
  lump: number;
  /** 1 round underneath … lower sits flatter. */
  flat: number;
  seed: number;
}

/** A polished, tumbled, mostly opaque stone. */
export interface CabStone {
  kind: 'cab';
  type: CabPattern;
  A: Vec3;
  B: Vec3;
  C: Vec3;
  /** 0 opaque … 1 glowing through. */
  trans: number;
  shape: PebbleShape;
}

export type Stone = {
  id: string;
  heb: string;
  /** Transliteration. */
  tr: string;
  kjv: string;
  as: string;
  /** Flat swatch colour for small, non-3D uses. */
  sw: string;
} & (CutStone | CabStone);

export const STONES: Stone[] = [
  { id: 'odem', heb: 'אֹדֶם', tr: 'Odem', kjv: 'Sardius', as: 'polished carnelian, a translucent red-orange chalcedony', sw: '#c2461c',
    kind: 'cab', type: 0, A: [0.40, 0.035, 0.005], B: [0.95, 0.30, 0.03], C: [0.95, 0.62, 0.38], trans: 1.0,
    shape: { s: [1.0, 0.72, 0.82], lump: 0.06, flat: 0.9, seed: 11 } },
  { id: 'pitdah', heb: 'פִּטְדָה', tr: 'Pitdah', kjv: 'Topaz', as: 'golden topaz, oval cut', sw: '#e0a93b',
    kind: 'gem', cut: 'oval', color: [0.97, 0.72, 0.22], ior: 1.62, disp: 0.016, depth: 1.8, facets: 8 },
  { id: 'bareket', heb: 'בָּרֶקֶת', tr: 'Bareket', kjv: 'Carbuncle', as: 'red garnet, round brilliant', sw: '#8e1a24',
    kind: 'gem', cut: 'brilliant', color: [0.86, 0.07, 0.11], ior: 1.76, disp: 0.024, depth: 2.2, facets: 8 },
  { id: 'nophek', heb: 'נֹפֶךְ', tr: 'Nophek', kjv: 'Emerald', as: 'emerald, step cut', sw: '#1f8a4c',
    kind: 'gem', cut: 'emerald', color: [0.16, 0.82, 0.36], ior: 1.58, disp: 0.014, depth: 2.0, facets: 8 },
  { id: 'sappir', heb: 'סַפִּיר', tr: 'Sappir', kjv: 'Sapphire', as: 'lapis lazuli with pyrite flecks, the likely ancient ‘sapphire’', sw: '#1d3a8f',
    kind: 'cab', type: 1, A: [0.01, 0.02, 0.30], B: [0.03, 0.08, 0.75], C: [0.60, 0.63, 0.68], trans: 0.0,
    shape: { s: [1.12, 0.55, 0.74], lump: 0.07, flat: 0.85, seed: 23 } },
  { id: 'yahalom', heb: 'יַהֲלֹם', tr: 'Yahalom', kjv: 'Diamond', as: 'colorless diamond, round brilliant', sw: '#dfe6ee',
    kind: 'gem', cut: 'brilliant', color: [0.985, 0.985, 1.0], ior: 2.42, disp: 0.06, depth: 1.0, facets: 16 },
  { id: 'leshem', heb: 'לֶשֶׁם', tr: 'Leshem', kjv: 'Ligure', as: 'orange jacinth (zircon), cushion cut', sw: '#d9661d',
    kind: 'gem', cut: 'cushion', color: [0.98, 0.50, 0.12], ior: 1.93, disp: 0.039, depth: 1.9, facets: 8 },
  { id: 'shevo', heb: 'שְׁבוֹ', tr: 'Shevo', kjv: 'Agate', as: 'polished banded agate', sw: '#a5683a',
    kind: 'cab', type: 2, A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0], trans: 0.35,
    shape: { s: [1.0, 0.62, 0.84], lump: 0.06, flat: 0.88, seed: 37 } },
  { id: 'achlamah', heb: 'אַחְלָמָה', tr: 'Achlamah', kjv: 'Amethyst', as: 'amethyst, oval cut', sw: '#7a3fb0',
    kind: 'gem', cut: 'oval', color: [0.62, 0.26, 0.88], ior: 1.54, disp: 0.013, depth: 2.1, facets: 8 },
  { id: 'tarshish', heb: 'תַּרְשִׁישׁ', tr: 'Tarshish', kjv: 'Beryl', as: 'aquamarine beryl, step cut', sw: '#6fb7c9',
    kind: 'gem', cut: 'emerald', color: [0.58, 0.86, 0.95], ior: 1.58, disp: 0.014, depth: 1.6, facets: 8 },
  { id: 'shoham', heb: 'שֹׁהַם', tr: 'Shoham', kjv: 'Onyx', as: 'black-and-white banded onyx', sw: '#1b1b1f',
    kind: 'cab', type: 3, A: [0.006, 0.006, 0.008], B: [0.30, 0.33, 0.38], C: [0.78, 0.80, 0.84], trans: 0.0,
    shape: { s: [1.05, 0.5, 0.74], lump: 0.025, flat: 0.9, seed: 41 } },
  { id: 'yashfeh', heb: 'יָשְׁפֵה', tr: 'Yashfeh', kjv: 'Jasper', as: 'polished red and polychrome jasper', sw: '#a8321c',
    kind: 'cab', type: 4, A: [0.60, 0.36, 0.07], B: [0.52, 0.50, 0.44], C: [0.45, 0.10, 0.03], trans: 0.15,
    shape: { s: [1.08, 0.66, 0.8], lump: 0.08, flat: 0.85, seed: 53 } },
];

// Which tribe goes with which stone. This is birth order, the prototype's
// pairing and only one of several traditions (Exodus 28:10 has the names
// engraved by birth order on the shoulder stones; the breastplate order
// itself is never spelled out). Swap this map to change the tradition, and
// change STONES in lib/familyTree/config.ts with it so the tree agrees.
export const TRIBE_STONE: Record<string, string> = {
  Reuben: 'odem',
  Simeon: 'pitdah',
  Levi: 'bareket',
  Judah: 'nophek',
  Dan: 'sappir',
  Naphtali: 'yahalom',
  Gad: 'leshem',
  Asher: 'shevo',
  Issachar: 'achlamah',
  Zebulun: 'tarshish',
  Joseph: 'shoham',
  Benjamin: 'yashfeh',
};

export function stoneById(id: string): Stone | undefined {
  return STONES.find(s => s.id === id);
}

export function stoneForTribe(tribe: string): Stone | undefined {
  const id = TRIBE_STONE[tribe];
  return id ? stoneById(id) : undefined;
}
