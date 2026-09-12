/**
 * Colours for the timeline's lands, provinces and empires.
 *
 * Every shape used to share one orange-brown, so a map of twenty lands read as
 * one smear with twenty names floating over it, and nothing said which name
 * belonged to which shape. Now each land and province gets a colour of its own,
 * and its name is lettered in the darker shade its border is drawn in, so name
 * and shape visibly belong together.
 *
 * Three promises, in order of how badly breaking them would show:
 *
 *   No two lands drawn in the same era share a colour, and provinces that touch
 *   never do.
 *   A name keeps its colour in every era, so Moab stays Moab-coloured as the
 *   slider moves rather than reshuffling on every step.
 *   Among the colours still allowed, a shape takes the one furthest from its
 *   neighbours', so the pairs that do sit side by side are easy to tell apart.
 *
 * Keeping a colour across eras means it has to be decided with every era in
 * view at once, so the assignment runs over the whole timeline before the first
 * era is drawn. It is deterministic: the same data gives the same colours in
 * every session.
 */

/**
 * The palette: an earthy fill, and a darker ink of the same hue for the border
 * and the name.
 *
 * Checked before use. The closest two fills are still 12 apart by CIEDE2000
 * (plum and aubergine), and every ink reads on the parchment at 4.85:1 or
 * better. `water` marks the blues and blue-greens a sea or a river may take,
 * so the Jordan never comes out plum.
 */
export const PALETTE = [
  { id: 'olive',      fill: '#7f7b33', ink: '#4a4714' },
  { id: 'sage',       fill: '#8fae7e', ink: '#3b5a30' },
  { id: 'moss',       fill: '#557f45', ink: '#2c4d22' },
  { id: 'pine',       fill: '#3e8174', ink: '#1d5047', water: true },
  { id: 'sea',        fill: '#5aa0b0', ink: '#245a68', water: true },
  { id: 'dusty-blue', fill: '#7a9cc2', ink: '#324f78', water: true },
  { id: 'slate',      fill: '#5f6ea3', ink: '#303d6b', water: true },
  { id: 'violet',     fill: '#a48bd0', ink: '#4f3a86' },
  { id: 'plum',       fill: '#8e5588', ink: '#592b55' },
  { id: 'mauve',      fill: '#c49ab8', ink: '#744866' },
  { id: 'brick',      fill: '#b5493a', ink: '#7a261b' },
  { id: 'madder',     fill: '#a63a5c', ink: '#6c1c38' },
  { id: 'rust',       fill: '#c8702c', ink: '#7c3e0e' },
  { id: 'terracotta', fill: '#d68f73', ink: '#8a4630' },
  { id: 'ochre',      fill: '#c9a03a', ink: '#6f5510' },
  { id: 'gold',       fill: '#e0cb52', ink: '#6d6010' },
  { id: 'umber',      fill: '#6b5a4a', ink: '#3f3327' },
  { id: 'chestnut',   fill: '#8a5a2a', ink: '#55330f' },
  { id: 'maroon',     fill: '#7b2d33', ink: '#521a20' },
  { id: 'taupe',      fill: '#948d82', ink: '#4c473f' },
  { id: 'grass',      fill: '#9cbc45', ink: '#3f5c12' },
  { id: 'aubergine',  fill: '#5e3f66', ink: '#3d2444' },
  { id: 'rose',       fill: '#cc6f7c', ink: '#7a2f3d' },
  { id: 'indigo',     fill: '#3f4a86', ink: '#262d5e' },
];

const BY_ID = new Map(PALETTE.map((c) => [c.id, c]));

/**
 * The empire an era's unnamed territory draws.
 *
 * Those layers are one realm's extent cut into pieces — Rome in AD 117 is 112
 * polygons, most of them islands — so they take one colour between them.
 * Colouring the pieces apart would turn one empire into a patchwork of
 * countries that never existed. Rome keeps its red through all five of its eras.
 */
const POLITIES = {
  persia: 'ochre',
  alexander: 'slate',
  hasmonean: 'moss',
  herod: 'plum',
  'roman-republic': 'brick',
  apostolic: 'brick',
  'rome-peak': 'brick',
  'rome-provinces': 'brick',
  'later-empire': 'brick',
};

/** The colour of the realm an era's unnamed territory belongs to. */
export function polityColour(eraId) {
  return BY_ID.get(POLITIES[eraId] ?? 'brick');
}

/** Whether a land's kind is water, so it keeps to the blues. */
export function isWaterKind(kind) {
  return /water|sea|river|lake|spring/i.test(kind || '');
}

// ------------------------------------------------------------ colour distance

/** CIE L*a*b*, for telling how far apart two colours look. */
function lab(hex) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const LAB = PALETTE.map((c) => lab(c.fill));
/** Straight-line distance in L*a*b*. Only ever used to rank, never as a threshold. */
const DISTANCE = LAB.map((a) => LAB.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));

// ----------------------------------------------------------------- assignment

/** [west, south, east, north], grown by `pad` degrees. */
function bboxOf(geometry, pad = 0) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else {
      for (const x of c) walk(x);
    }
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return [w - pad, s - pad, e + pad, n + pad];
}

const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Give every name on the timeline its colour.
 *
 * @param {Array<{ id: string, hasPolity: boolean,
 *   lands: Array<{ name: string, kind?: string, geometry: any }>,
 *   provinces: Array<{ name: string, geometry: any }> }>} eras
 * @returns {Map<string, { id: string, fill: string, ink: string }>}
 *
 * A name is one node however many eras it turns up in, and its constraints are
 * the union of all of them. Two lands in the same era must differ outright;
 * two provinces must differ when their extents meet. Shapes that meet in any
 * era are neighbours, and a colour is scored by how far it sits from the
 * neighbours already coloured.
 *
 * The order is the usual one for colouring a map: always the most constrained
 * shape next, so the hard cases pick while there is still room to pick.
 */
export function assignColours(eras) {
  /** @type {Map<string, { name: string, water: boolean, conflicts: Set<string>, neighbours: Set<string>, banned: Set<number>, colour: number }>} */
  const nodes = new Map();
  const node = (name) => {
    if (!nodes.has(name)) {
      nodes.set(name, { name, water: false, conflicts: new Set(), neighbours: new Set(), banned: new Set(), colour: -1 });
    }
    return nodes.get(name);
  };
  const link = (a, b, hard) => {
    if (a === b) return;
    nodes.get(a).neighbours.add(b);
    nodes.get(b).neighbours.add(a);
    if (hard) {
      nodes.get(a).conflicts.add(b);
      nodes.get(b).conflicts.add(a);
    }
  };

  for (const era of eras) {
    // A land drawn over an empire's fill would vanish into it in the same colour.
    const polity = era.hasPolity ? PALETTE.indexOf(polityColour(era.id)) : -1;

    const lands = era.lands.map((l) => ({ name: l.name, box: bboxOf(l.geometry, 0.25) }));
    for (const l of era.lands) {
      const n = node(l.name);
      if (isWaterKind(l.kind)) n.water = true;
      if (polity >= 0) n.banned.add(polity);
    }
    for (let i = 0; i < lands.length; i++) {
      for (let j = i + 1; j < lands.length; j++) {
        // Every pair of lands in an era is a conflict; only overlapping ones
        // are also neighbours worth pushing apart in hue.
        nodes.get(lands[i].name).conflicts.add(lands[j].name);
        nodes.get(lands[j].name).conflicts.add(lands[i].name);
        if (overlaps(lands[i].box, lands[j].box)) link(lands[i].name, lands[j].name, false);
      }
    }

    const provinces = era.provinces.map((p) => ({ name: p.name, box: bboxOf(p.geometry, 0.1) }));
    for (const p of provinces) node(p.name);
    for (let i = 0; i < provinces.length; i++) {
      for (let j = i + 1; j < provinces.length; j++) {
        if (overlaps(provinces[i].box, provinces[j].box)) link(provinces[i].name, provinces[j].name, true);
      }
    }
  }

  const used = new Array(PALETTE.length).fill(0);
  const saturation = (n) => {
    const seen = new Set();
    for (const c of n.conflicts) {
      const k = nodes.get(c).colour;
      if (k >= 0) seen.add(k);
    }
    return seen.size;
  };

  const all = [...nodes.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let step = 0; step < all.length; step++) {
    let next = null;
    let nextSat = -1;
    for (const n of all) {
      if (n.colour >= 0) continue;
      const sat = saturation(n);
      if (sat > nextSat || (sat === nextSat && n.conflicts.size > next.conflicts.size)) {
        next = n;
        nextSat = sat;
      }
    }

    const taken = new Set(next.banned);
    for (const c of next.conflicts) {
      const k = nodes.get(c).colour;
      if (k >= 0) taken.add(k);
    }

    const pool = (keep) => PALETTE.map((_, i) => i).filter(keep);
    // Water keeps to the blues, and dry land leaves them for water while it has
    // anything else — otherwise Moab takes the last blue and the Red Sea comes
    // out purple. Each fallback only widens the choice when the last was empty.
    const choices =
      [
        pool((i) => !taken.has(i) && !!PALETTE[i].water === next.water),
        pool((i) => !taken.has(i)),
        pool(() => true),
      ].find((p) => p.length) ?? [];

    let best = choices[0];
    let bestScore = -Infinity;
    for (const i of choices) {
      let nearest = Infinity;
      for (const m of next.neighbours) {
        const k = nodes.get(m).colour;
        if (k >= 0) nearest = Math.min(nearest, DISTANCE[i][k]);
      }
      // Furthest from the nearest neighbour wins; with no neighbour coloured
      // yet, the least-used colour does, so the palette gets spread around.
      const score = (nearest === Infinity ? 1000 : nearest) - used[i] * 0.5;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    next.colour = best;
    used[best]++;
  }

  const out = new Map();
  for (const n of nodes.values()) out.set(n.name, PALETTE[n.colour]);
  return out;
}

/** A colour for a name the assignment never saw, stable across sessions. */
export function fallbackColour(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
