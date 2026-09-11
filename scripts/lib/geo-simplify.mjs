/**
 * Geometry simplification for the atlas pack.
 *
 * The AWMC source is survey-grade: coastlines carry fourteen decimal places of
 * float noise, which is roughly a nanometre of "precision" on a map whose whole
 * point is showing empires. Rounding and thinning the same shapes costs nothing
 * anyone can see at atlas zoom and takes the pack from hundreds of megabytes to
 * something a phone will actually download.
 *
 * Nothing here invents geometry. Every point kept is a point a surveyor put
 * there; simplification only drops points that lie within `tolerance` of the
 * line their neighbours already describe.
 */

/** Perpendicular distance from p to the segment ab, in degrees. */
function segmentDistance(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      [x, y] = b;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Douglas-Peucker, iterative rather than recursive — a few of the AWMC
 * coastlines are long enough to blow the call stack if you recurse per point.
 */
function douglasPeucker(points, sqTolerance) {
  if (points.length < 3) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let index = 0;

    for (let i = first + 1; i < last; i++) {
      const dist = segmentDistance(points[i], points[first], points[last]);
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }

    if (maxDist > sqTolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Drop consecutive duplicates left behind by rounding. */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

function roundRing(ring, decimals) {
  const f = 10 ** decimals;
  return ring.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

/** Shoelace area in square degrees — used only to drop specks, never to reshape. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum / 2);
}

function simplifyRing(ring, opts, isClosed) {
  let pts = dedupe(roundRing(ring, opts.decimals));
  if (pts.length > 2) pts = douglasPeucker(pts, opts.tolerance ** 2);

  if (isClosed) {
    // A ring needs at least a triangle, and must come back to its start.
    if (pts.length < 3) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
    if (pts.length < 4) return null;
  } else if (pts.length < 2) {
    return null;
  }

  return pts;
}

function simplifyPolygon(rings, opts) {
  const out = [];
  for (let i = 0; i < rings.length; i++) {
    // Outer ring decides whether the whole polygon survives; holes are dropped
    // individually when they shrink below the speck threshold.
    if (opts.minArea && ringArea(rings[i]) < opts.minArea) {
      if (i === 0) return null;
      continue;
    }
    const ring = simplifyRing(rings[i], opts, true);
    if (!ring) {
      if (i === 0) return null;
      continue;
    }
    out.push(ring);
  }
  return out.length ? out : null;
}

/** Simplify one GeoJSON geometry, returning null when nothing survives. */
export function simplifyGeometry(geom, opts) {
  if (!geom) return null;

  switch (geom.type) {
    case 'Point':
      return { type: 'Point', coordinates: roundRing([geom.coordinates], opts.decimals)[0] };

    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: roundRing(geom.coordinates, opts.decimals) };

    case 'LineString': {
      const line = simplifyRing(geom.coordinates, opts, false);
      return line ? { type: 'LineString', coordinates: line } : null;
    }

    case 'MultiLineString': {
      const lines = geom.coordinates
        .map((l) => simplifyRing(l, opts, false))
        .filter(Boolean);
      return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
    }

    case 'Polygon': {
      const poly = simplifyPolygon(geom.coordinates, opts);
      return poly ? { type: 'Polygon', coordinates: poly } : null;
    }

    case 'MultiPolygon': {
      const polys = geom.coordinates
        .map((p) => simplifyPolygon(p, opts))
        .filter(Boolean);
      return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    }

    case 'GeometryCollection': {
      const geoms = (geom.geometries || [])
        .map((g) => simplifyGeometry(g, opts))
        .filter(Boolean);
      return geoms.length ? { type: 'GeometryCollection', geometries: geoms } : null;
    }

    default:
      return geom;
  }
}

/**
 * Simplify a FeatureCollection, keeping only the listed properties.
 *
 * The AWMC files carry ESRI export leftovers on every feature — OBJECTID,
 * Shape_Leng, PERIMETER — which say nothing and cost real bytes at this scale.
 */
export function simplifyCollection(fc, opts) {
  const keepProps = opts.keepProps ?? [];
  const features = [];

  for (const feature of fc.features || []) {
    const geom = simplifyGeometry(feature.geometry, opts);
    if (!geom) continue;

    const props = {};
    for (const key of keepProps) {
      const value = feature.properties?.[key];
      if (value !== undefined && value !== null && value !== '') props[key] = value;
    }

    features.push({ type: 'Feature', properties: props, geometry: geom });
  }

  return { type: 'FeatureCollection', features };
}

export function countPoints(fc) {
  let n = 0;
  const walk = (c) => {
    if (typeof c[0] === 'number') n++;
    else for (const part of c) walk(part);
  };
  for (const f of fc.features || []) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return n;
}
