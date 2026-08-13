/**
 * radialMenu.ts
 *
 * Geometry and contents for the reader's radial selection menu — the ring that
 * opens around a tapped word.
 *
 * The shape is a donut with two slices cut out, at 3 o'clock and 9 o'clock. What
 * is left is an arc across the top and another across the bottom, and the two
 * gaps line up with the word's own line of text so the whole line reads straight
 * through the menu. That is also why the ring can slide sideways as far as it
 * likes: near the edge of the screen the word simply ends up in the left or right
 * gap instead of dead centre, and is still fully readable.
 *
 * This lives outside the component because BibleReader has to know the ring's
 * size *before* anything renders — it places the menu synchronously and may have
 * to nudge-scroll the reader to make room. Both sides importing one module is
 * what keeps the placement and the drawing agreed on where the buttons are.
 */

const RAD = Math.PI / 180;

/** Badge button diameter, and the smallest gap allowed between two of them. */
export const BADGE = 54;
const MIN_GAP = 6;

/**
 * How far off horizontal a button must stay, in degrees. This is what carves the
 * two gaps: buttons live in [PHI, 180-PHI] and [180+PHI, 360-PHI], leaving the
 * horizontal channel through the middle clear for the line of text.
 */
const PHI = 30;
const ARC_SPAN = 180 - 2 * PHI;

/** Breathing room between the text line and the nearest button edge. */
const LINE_PAD = 6;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Radius of the circle the button centres sit on.
 *
 * Two constraints, whichever is larger: the buttons must not collide along their
 * arc, and the innermost pair must clear the line of text. At eight buttons or
 * fewer the line always wins, which is what makes the ring a fixed size for a
 * given text size no matter which buttons happen to be showing — it grows only
 * when the reader's font size does.
 */
export function ringRadius(lineHeight: number, count: number): number {
  const top = Math.ceil(count / 2);
  const bottom = count - top;

  let r = (lineHeight / 2 + LINE_PAD + BADGE / 2) / Math.sin(PHI * RAD);
  for (const n of [top, bottom]) {
    if (n < 2) continue;
    r = Math.max(r, (BADGE + MIN_GAP) / ((ARC_SPAN / (n - 1)) * RAD));
  }
  return r;
}

/** Half the menu's full extent, including the button bodies. */
export function outerRadius(lineHeight: number, count: number): number {
  return ringRadius(lineHeight, count) + BADGE / 2;
}

/**
 * Where each seat sits, in degrees clockwise from 3 o'clock — so 270 is the top
 * of the ring and 90 the bottom, matching screen coordinates where y grows down.
 *
 * Returned in sweep order: the top arc from its right tip round to its left tip,
 * then the bottom arc from left tip back to right. That is one continuous
 * counter-clockwise path, which is both the reading order and the order the
 * buttons animate in. It also puts the first seat and the last seat either side
 * of the right-hand gap, which is where the Word/Verse pair goes.
 */
export function seatAngles(count: number): number[] {
  const top = Math.ceil(count / 2);
  const bottom = count - top;

  const spread = (n: number, from: number, to: number): number[] => {
    if (n <= 0) return [];
    if (n === 1) return [from];
    return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  };

  return [...spread(top, 330, 210), ...spread(bottom, 150, 30)];
}

/** Seat angle → offset from the ring's centre, in px. */
export function seatOffset(angleDeg: number, radius: number): { dx: number; dy: number } {
  return {
    dx: radius * Math.cos(angleDeg * RAD),
    dy: radius * Math.sin(angleDeg * RAD),
  };
}

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

export interface RadialItem {
  /** 'mode' is the Word/Verse pair, styled apart from the actions. */
  kind: 'mode' | 'action';
  /** Dispatched as-is: 'word'/'verse' for modes, the action name otherwise. */
  id: string;
  label: string;
  /** Key into the component's icon map. Modes have none — they show their label. */
  icon?: string;
  /** Badge splash colour. Modes have none. */
  accent?: string;
}

export interface RadialItemOpts {
  mode: 'word' | 'verse';
  wordCount: number;
  isPlace: boolean;
  isPerson: boolean;
  moreInfo: boolean;
  extendArmed: boolean;
}

/**
 * The buttons, in sweep order, ready to be paired with seatAngles().
 *
 * Word leads and Verse trails so the two of them land on the seats flanking the
 * right-hand gap. Search and Save are deliberately absent — Search is a nav-bar
 * button already, and Save was never implemented. The classic toast still has
 * both.
 *
 * Accents avoid stacking blues on top of each other: Notes owns the sticky
 * note's own baby blue, so Highlight takes the yellow it vacated, Define takes
 * the rose that dropping Search freed up, and Map moves off cyan to orange.
 */
export function radialItems(o: RadialItemOpts): RadialItem[] {
  // Same rule as the classic toast: single-term lookups only make sense for one
  // word, and verse mode is a single term by definition.
  const singleWord = o.mode === 'verse' || o.wordCount <= 1;

  const actions: RadialItem[] = [];

  if (singleWord) {
    // One button in three states. A biblical character outranks an ISBE entry.
    actions.push(
      o.isPerson
        ? { kind: 'action', id: 'dissect', label: 'Bio', icon: 'person', accent: '#2dd4bf' }
        : o.moreInfo
          ? { kind: 'action', id: 'dissect', label: 'Info', icon: 'info', accent: '#4a90e2' }
          : { kind: 'action', id: 'dissect', label: 'Define', icon: 'define', accent: '#fb7185' },
    );
  }
  if (o.isPlace) {
    actions.push({ kind: 'action', id: 'map', label: 'Map', icon: 'map', accent: '#f2893e' });
  }
  actions.push({ kind: 'action', id: 'highlight', label: 'Mark', icon: 'highlight', accent: '#fde047' });
  actions.push({ kind: 'action', id: 'notes', label: 'Notes', icon: 'notes', accent: '#d1e3f5' });
  if (singleWord) {
    actions.push({ kind: 'action', id: 'repeats', label: 'Repeats', icon: 'repeats', accent: '#a78bfa' });
  }
  if (o.mode === 'word') {
    actions.push({
      kind: 'action',
      id: 'extend',
      label: o.extendArmed ? 'Tap…' : 'Extend',
      icon: 'extend',
      // Extend is a state, not a destination — grey until it is armed.
      accent: o.extendArmed ? '#667eea' : '#9ca3af',
    });
  }

  return [
    { kind: 'mode', id: 'word', label: 'Word' },
    ...actions,
    { kind: 'mode', id: 'verse', label: 'Verse' },
  ];
}

/** Item count without building the list — for callers that only need the size. */
export function radialItemCount(o: RadialItemOpts): number {
  return radialItems(o).length;
}
