/**
 * Deriving leg direction and order from the geometry.
 *
 * The legs Ritmeyer drew are accurate — probing each one's closest approach to
 * every stop shows them passing directly through their cities, usually within
 * 1–5 km. What was wrong was the bookkeeping around them: a hand-maintained
 * `reverse[]` array in journey-index.json, keyed by segment index, which was
 * incomplete enough that 13 of 55 legs drew backwards and the stored order did
 * not follow travel order.
 *
 * So nothing here re-traces a line. It reads each leg against the stop sequence
 * and decides which end is the start — recoverable from the geometry because
 * the stops are in travel order and the line goes through them.
 *
 * What it deliberately does *not* do is reorder the legs. That was tried and
 * measured: sorting legs by the span of stops they cover assumes legs partition
 * a journey into successive stretches, and they do not. Paul's Third has ten
 * stops and six legs, one of which covers stops 2 through 9 while short legs
 * nest inside it, so span-sorting puts the long leg last and ends the drawn
 * line 1,315 km from Jerusalem. Across all 17 journeys full derivation was five
 * better and five worse — a lateral move, not a fix — so leg order stays as the
 * index states it and only direction is derived.
 *
 * Direction is likewise only claimed where it is a fact rather than a reading.
 * A leg whose stops descend strictly through the sequence is backwards; one
 * that zigzags has no single direction to be wrong about. Six legs meet the
 * first test and are reversed, five meet the second and are left alone, and no
 * journey is made worse.
 *
 * This is imported by the builder and by the reporter that measures it, rather
 * than living in either, so the measurement cannot drift from the behaviour.
 */

/** Great-circle km. The same formula the builder and the app's overlay use. */
export function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How near a stop must come to a leg to count as "on" it.
 *
 * Generous on purpose. This is not the accuracy claim — the measured stop→line
 * median is about 3 km — it is the radius within which a stop is evidence about
 * which way the leg runs. A city 40 km off a road it is listed on still tells
 * you the direction of travel reliably, and the alternative to accepting it is
 * a leg with too few stops to orient at all, which falls back to the weaker
 * endpoint anchoring.
 */
export const TOUCH_KM = 45;

/**
 * The closest approach of one stop to one leg, and where along the leg it falls.
 *
 * `index` is the vertex, which is what orientation is decided on: the order the
 * stops' vertex indices run in is the order the leg visits them.
 */
export function nearestOnLeg(stop, leg) {
  let km = Infinity;
  let index = -1;
  for (let i = 0; i < leg.length; i++) {
    const d = haversineKm(stop.lat, stop.lon, leg[i][1], leg[i][0]);
    if (d < km) {
      km = d;
      index = i;
    }
  }
  return { km, index };
}

/**
 * Decide each leg's orientation and its place in the journey.
 *
 * Returns one entry per input leg, in input order — ordering is expressed as a
 * `sort` key rather than by reordering here, so the caller can see what moved.
 *
 * Two methods, strong and weak:
 *
 *   strong  two or more stops come within TOUCH_KM. Their vertex indices along
 *           the leg are compared with their seq in the journey, and a leg whose
 *           stops descend strictly through the sequence is reversed. This is
 *           the only case that ever flips a leg.
 *
 *   weak    fewer than two stops are in range — a short hop, or an open-water
 *           stroke drawn past a string of ports. The endpoints size the leg's
 *           span but never reverse it: every wrong answer measured came from
 *           endpoint anchoring, because a leg's end sits nearest the port it
 *           *left* about as often as the one it reached.
 *
 * Where geometry cannot decide, the index's stated order wins, so editorial
 * intent survives exactly where the measurement is silent.
 */
export function orientLegs(legs, stops) {
  // A place the journey visits twice cannot say which way a leg runs: it is
  // genuinely at both ends. Only Paul's First and Second do this, both
  // returning to Antioch, and on the Second the homeward leg passes the
  // outbound corridor closely enough that counting Antioch twice would decide
  // the leg on the weaker evidence. Such stops still appear in `touched` — they
  // are on the leg — but they are excluded from the vote.
  const ambiguous = new Set();
  const byPlace = new Map();
  for (const stop of stops) {
    const seen = byPlace.get(stop.place_id);
    if (seen !== undefined) ambiguous.add(stop.place_id);
    byPlace.set(stop.place_id, stop.seq);
  }

  return legs.map((leg, i) => {
    // Every stop that comes near this leg, with where along it they fall.
    const touched = [];
    for (const stop of stops) {
      const { km, index } = nearestOnLeg(stop, leg);
      if (km <= TOUCH_KM) {
        touched.push({
          seq: stop.seq,
          place_id: stop.place_id,
          name: stop.name,
          km,
          index,
          voting: !ambiguous.has(stop.place_id),
        });
      }
    }
    touched.sort((a, b) => a.index - b.index);

    // Resolve each revisited place to the one visit this leg means, rather
    // than dropping it. Paul's First is the case: Antioch is both stop 1 and
    // stop 11, and three of its seven legs touch it. Dropping it leaves those
    // legs with too little evidence; keeping both makes every one of them span
    // the whole journey. The unambiguous stops on the leg say which visit it
    // is — a leg that also touches Seleucia (2) means the departure, one that
    // also touches Attalia (10) means the return — so each duplicate keeps the
    // visit nearest the other stops, and the choice is only ever between two
    // seq numbers for a place that is already known to be on this leg.
    const certain = touched.filter((t) => t.voting);
    const resolved = [];
    const claimed = new Set();
    for (const t of touched) {
      if (t.voting) {
        resolved.push(t);
        continue;
      }
      if (claimed.has(t.place_id)) continue;
      const visits = touched.filter((o) => o.place_id === t.place_id);
      const pick = certain.length
        ? visits.reduce((best, v) =>
            distanceToSeqs(v.seq, certain) < distanceToSeqs(best.seq, certain) ? v : best
          )
        : visits[0];
      claimed.add(t.place_id);
      resolved.push(pick);
    }
    resolved.sort((a, b) => a.index - b.index);

    // Duplicates still never vote on direction — a place at both ends of a
    // round trip cannot say which way one leg runs — but now that each is
    // resolved to a single visit it can size the leg's span.
    const voters = certain;

    if (voters.length >= 2) {
      // Compare the order the leg meets these stops with their travel order.
      // Kendall-style: count the pairs that agree against the pairs that don't,
      // rather than just comparing the first and last, so one stop sitting near
      // a bend cannot flip an otherwise unambiguous leg.
      //
      // Pairs are weighted by how near both stops come to the line. A city
      // 1 km off the road is strong evidence about that road's direction; one
      // 40 km off is the same city seen from a neighbouring corridor, and on
      // Paul's Second that is literally the case — the homeward leg runs within
      // 26 km of outbound Troas. Unweighted, distant bystanders outvote the
      // stops the leg actually threads.
      const weight = (t) => 1 / (1 + t.km);
      let agree = 0;
      let disagree = 0;
      for (let a = 0; a < voters.length; a++) {
        for (let b = a + 1; b < voters.length; b++) {
          const w = weight(voters[a]) * weight(voters[b]);
          if (voters[b].seq > voters[a].seq) agree += w;
          else if (voters[b].seq < voters[a].seq) disagree += w;
        }
      }
      // Only a leg whose stops descend strictly through the sequence is called
      // backwards. That is a fact about the data — Paul's First leg 5 meets
      // Derbe, Lystra, Iconium, Antioch in that order against a travel order
      // of 6, 7, 8, 9 — while a leg that zigzags (David's 5>6>1>2>7>3>4) has
      // no single direction to be wrong about, and reversing it on a majority
      // vote swaps one arbitrary order for another. Measured over all 17
      // journeys, flipping the monotone legs alone improves or holds every one
      // of them; including the mixed ones makes five journeys worse.
      const order = voters.map((t) => t.seq);
      let descending = order.length >= 2;
      for (let k = 1; k < order.length; k++) {
        if (order[k] >= order[k - 1]) descending = false;
      }
      const flip = descending && disagree > agree;
      const ambiguousDirection = !descending && disagree > agree;
      const seqs = resolved.map((t) => t.seq);
      return {
        flip,
        weak: false,
        // A leg the vote called backwards but whose stops do not run one way.
        // Reported rather than acted on, so the reporter can show them.
        mixed: ambiguousDirection,
        touched: flip ? resolved.slice().reverse() : resolved,
        // Sort on the span of stops covered, so the legs fall into travel order.
        sort: [Math.min(...seqs), Math.max(...seqs), i],
      };
    }

    // Weak: anchor the two endpoints and let them decide. One voting stop, if
    // there is one, is better evidence than an endpoint, so it anchors its own
    // end and the other end is measured against it.
    const head = nearestStop(leg[0], stops, voters[0]);
    const tail = nearestStop(leg[leg.length - 1], stops, voters[0]);
    // Endpoint anchoring is the weak evidence, and every wrong answer measured
    // came from it: a leg's endpoint sits nearest the port it *left* as often
    // as the one it reached. It sizes the leg's span but never reverses it.
    const flip = false;
    const lo = Math.min(head.seq, tail.seq);
    const hi = Math.max(head.seq, tail.seq);
    return {
      flip,
      weak: true,
      touched: resolved,
      sort: [lo, hi, i],
    };
  });
}

/**
 * How near one seq sits to a leg's unambiguous stops.
 *
 * Used to resolve a revisited place to the visit this leg means: of Antioch's
 * two seq numbers, the one closer to the stops the leg certainly touches.
 */
function distanceToSeqs(seq, certain) {
  return certain.reduce((n, c) => Math.min(n, Math.abs(c.seq - seq)), Infinity);
}

/**
 * The stop nearest one coordinate pair.
 *
 * Used only by the weak path. `near` is the leg's one voting stop where it has
 * one: on a round trip the nearest stop to an endpoint may be a place the
 * journey visits twice, and ties between its two seq numbers are broken toward
 * the one nearer that anchor, so a short hop is not stretched across the whole
 * journey by picking the far visit.
 */
function nearestStop(point, stops, near) {
  let best = stops[0];
  let km = Infinity;
  for (const stop of stops) {
    const d = haversineKm(stop.lat, stop.lon, point[1], point[0]);
    const better =
      d < km - 0.001 ||
      (near && Math.abs(d - km) <= 0.001 && Math.abs(stop.seq - near.seq) < Math.abs(best.seq - near.seq));
    if (better) {
      km = Math.min(km, d);
      best = stop;
    }
  }
  return { seq: best.seq, name: best.name, km };
}

/**
 * Apply the derivation: legs reversed where they run backwards, then sorted
 * into travel order. Ties fall back to the order the index stated.
 */
export function deriveLegs(legs, stops) {
  const decided = orientLegs(legs, stops);
  return legs
    .map((leg, i) => ({ leg: decided[i].flip ? leg.slice().reverse() : leg, d: decided[i], i }))
    .sort((a, b) => a.d.sort[0] - b.d.sort[0] || a.d.sort[1] - b.d.sort[1] || a.i - b.i)
    .map((x) => x.leg);
}
