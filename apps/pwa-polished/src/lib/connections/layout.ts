/**
 * Where everything sits: the line of the Bible, and the arcs over it.
 *
 * The picture is one axis carrying all 1,189 chapters in order, and an arc for
 * every cross-reference springing from where it is written to where it is
 * answered. This module answers two questions and nothing else: where on the
 * axis a verse falls, and what shape the arc between two of them takes. The
 * drawing is render.ts's job and the tuning is the lab's.
 *
 * Two ways of spacing the axis, because they answer different questions:
 *   - 'verses' gives each chapter room in proportion to its verse count, so
 *     distance along the axis is distance through the text. Psalm 119 is wide.
 *   - 'equal' gives every chapter the same width, so the 1,189 chapters read as
 *     a ruler and short books stop vanishing. Obadiah is as visible as Isaiah.
 */

import type { ConnectionsData } from './data';

export type Orientation = 'horizontal' | 'vertical';
/** Which side of the axis an arc bulges to. */
export type ArcSide = 'top' | 'bottom' | 'split';
export type ChapterWidth = 'verses' | 'equal';

/** Everything the look is tuned by. The lab writes straight into one of these. */
export interface ConnectionsConfig {
  orientation: Orientation;
  side: ArcSide;
  width: ChapterWidth;
  /**
   * How arc height grows with the distance it spans, as an exponent.
   *
   * 1 is straight-line: a link twice as long is twice as tall. Below 1 the
   * short arcs lift away from the axis and the long ones stop running off the
   * top, which is what makes a dense set readable; 0.5 is a square root.
   */
  heightCurve: number;
  /** The tallest arc, as a fraction of the space across the axis. */
  heightMax: number;
  /** The shortest arc's height, so a one-chapter link is still a visible bump. */
  heightMin: number;
  /** Where along an arc the two book colors change over, 0.5 being the middle. */
  crossfadeAt: number;
  /** How much of the arc the changeover takes. 0 is a hard edge, 1 a long blend. */
  crossfadeWidth: number;
  /** Line width at no votes, and at the most-voted link. */
  thicknessMin: number;
  thicknessMax: number;
  /** Opacity at no votes, and at the most-voted link. */
  alphaMin: number;
  alphaMax: number;
  /** How votes map onto thickness and brightness: an exponent, as heightCurve. */
  voteCurve: number;
  /** Links with fewer votes than this are not drawn at all. */
  voteFloor: number;
  /**
   * Stop after this many arcs, strongest first. 0 means draw them all.
   *
   * Drawing all 344,799 costs about 100ms a frame before rasterizing, so the
   * full set is a thing to look at rather than to pan around in. A cap of
   * 20,000 or a vote floor of 25 both come in near 20ms.
   */
  maxArcs: number;
  /** What a dimmed arc keeps when something else is lit. 0 hides it entirely. */
  dimFloor: number;
  /** The margin around the picture, in pixels before zoom. */
  padding: number;
  /** How much of the short side the axis sits in from the edge, 0.5 centred. */
  axisAt: number;
  /**
   * Room kept past the rule for the chapter bars and the book names, in pixels.
   *
   * The bars are a bar graph of verse counts and the names are written sideways
   * under them, so this is the longest bar plus a name's length — about 140
   * with names and 76 without. render.ts's `axisDepth` gives the right number.
   */
  axisDepth: number;
}

/** What the app ships, and what the lab's Reset puts back. */
export const CONFIG: ConnectionsConfig = {
  orientation: 'horizontal',
  side: 'top',
  width: 'verses',
  heightCurve: 0.62,
  heightMax: 0.92,
  heightMin: 0.02,
  crossfadeAt: 0.5,
  crossfadeWidth: 0.55,
  thicknessMin: 0.4,
  thicknessMax: 2.4,
  alphaMin: 0.07,
  alphaMax: 0.72,
  voteCurve: 0.5,
  voteFloor: 0,
  maxArcs: 0,
  dimFloor: 0.06,
  padding: 18,
  axisAt: 1,
  axisDepth: 140,
};

/** The box the picture is drawn into, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * The axis: how a verse position becomes a distance along it.
 *
 * Built once per layout rather than per arc. `offsets` holds the start of every
 * chapter as a fraction of the whole axis, 0 to 1, with one extra entry at the
 * end so a chapter's width is the difference between neighbours.
 */
export interface Axis {
  /** 1,190 entries: the fractional start of each chapter, then 1. */
  offsets: Float64Array;
  /** The first verse of each chapter, straight off the pack. */
  chapterStarts: Int32Array;
  /** How many verses each chapter holds. */
  chapterVerses: Int32Array;
  /** The first chapter index of each book, and one past the last. */
  bookFirstChapter: Int32Array;
  totalVerses: number;
}

/** The axis for a given spacing. */
export function buildAxis(data: ConnectionsData, width: ChapterWidth): Axis {
  const { chapterStarts, totalVerses, books } = data;
  const count = chapterStarts.length;

  const chapterVerses = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    chapterVerses[i] = (i + 1 < count ? chapterStarts[i + 1] : totalVerses) - chapterStarts[i];
  }

  const offsets = new Float64Array(count + 1);
  if (width === 'equal') {
    for (let i = 0; i <= count; i++) offsets[i] = i / count;
  } else {
    for (let i = 0; i < count; i++) offsets[i] = chapterStarts[i] / totalVerses;
    offsets[count] = 1;
  }

  const bookFirstChapter = new Int32Array(books.length + 1);
  books.forEach((b, i) => {
    bookFirstChapter[i] = b.firstChapter;
  });
  bookFirstChapter[books.length] = count;

  return { offsets, chapterStarts, chapterVerses, bookFirstChapter, totalVerses };
}

/**
 * A verse position as a fraction along the axis, 0 to 1.
 *
 * Under 'verses' spacing this is just the position over the total. Under
 * 'equal' it is the chapter's own slot plus how far into that chapter the verse
 * sits, so a verse still lands in the right place inside its chapter.
 */
export function fractionOf(axis: Axis, position: number): number {
  const chapter = chapterIndexAt(axis, position);
  const start = axis.chapterStarts[chapter];
  const verses = axis.chapterVerses[chapter] || 1;
  const within = Math.min(Math.max((position - start) / verses, 0), 1);
  const a = axis.offsets[chapter];
  const b = axis.offsets[chapter + 1];
  return a + (b - a) * within;
}

/** Which chapter a verse position falls in, by binary search. */
export function chapterIndexAt(axis: Axis, position: number): number {
  const starts = axis.chapterStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= position) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The drawing frame: the axis line, and which way is "up" from it.
 *
 * `along` is the axis's own length in pixels and `across` the room an arc has
 * to rise into. Horizontal and vertical differ only in how those two map onto
 * x and y, so every shape below is computed once in along/across and turned
 * into a point at the end.
 */
export interface Frame {
  orientation: Orientation;
  /** Where the axis starts, in pixels. */
  originAlong: number;
  originAcross: number;
  along: number;
  across: number;
}

export function frameFor(view: Viewport, config: ConnectionsConfig): Frame {
  const pad = config.padding;
  const horizontal = config.orientation === 'horizontal';
  const along = Math.max(1, (horizontal ? view.width : view.height) - pad * 2);
  // The chapter bars and the book names hang off the far side of the rule, so
  // the arcs have the short side less that much to rise into. Without this the
  // rule sits on the canvas edge at axisAt 1 and the names fall off it.
  const furniture = config.axisDepth;
  const shortSide = Math.max(1, (horizontal ? view.height : view.width) - pad * 2 - furniture);
  // Split draws to both sides, so each side gets half the room.
  const across = config.side === 'split' ? shortSide / 2 : shortSide;
  const axisOffset = config.side === 'split' ? shortSide / 2 : shortSide * config.axisAt;
  return {
    orientation: config.orientation,
    originAlong: pad,
    originAcross: pad + axisOffset,
    along,
    across,
  };
}

/** An along/across pair as a canvas point. */
export function pointAt(frame: Frame, along: number, across: number): { x: number; y: number } {
  const a = frame.originAlong + along;
  // "Across" counts away from the axis, which is upward on screen for the top
  // side, so it subtracts.
  const c = frame.originAcross - across;
  return frame.orientation === 'horizontal' ? { x: a, y: c } : { x: c, y: a };
}

/**
 * The shape of one arc: where it starts and ends on the axis, and how high it
 * reaches.
 *
 * A quadratic curve, whose control point sits above the midpoint at twice the
 * height — a quadratic reaches half its control height, so doubling makes
 * `height` the height actually drawn.
 */
export interface ArcShape {
  /** Both feet, in pixels along the axis. */
  fromAlong: number;
  toAlong: number;
  /** How far the curve rises off the axis, in pixels. */
  height: number;
  /** +1 bulges away from the axis on the near side, -1 the other way. */
  direction: 1 | -1;
}

/**
 * Where an arc goes.
 *
 * Under 'split' spacing a link that points forward through the Bible rises on
 * one side and one that points back falls on the other, which is how OpenBible
 * draws it: the shape of a passage's reach is visible before any of it is read.
 */
export function arcShape(
  axis: Axis,
  frame: Frame,
  config: ConnectionsConfig,
  from: number,
  to: number,
): ArcShape {
  const fromAlong = fractionOf(axis, from) * frame.along;
  const toAlong = fractionOf(axis, to) * frame.along;

  // Distance is measured along the axis as drawn, so under 'equal' spacing a
  // link across many short chapters is correctly tall.
  const span = Math.abs(toAlong - fromAlong) / frame.along;
  const curved = Math.pow(Math.min(Math.max(span, 0), 1), config.heightCurve);
  const height = frame.across * (config.heightMin + (config.heightMax - config.heightMin) * curved);

  let direction: 1 | -1 = 1;
  if (config.side === 'bottom') direction = -1;
  else if (config.side === 'split') direction = to >= from ? 1 : -1;

  return { fromAlong, toAlong, height, direction };
}

/**
 * How strongly a link is drawn, from its votes: 0 at the floor, 1 at the
 * most-voted link in the set.
 *
 * Downvoted links (negative votes) land at 0 rather than off the scale.
 */
export function strengthOf(config: ConnectionsConfig, votes: number, maxVotes: number): number {
  if (maxVotes <= 0) return 0;
  const floor = Math.max(config.voteFloor, 0);
  const range = Math.max(maxVotes - floor, 1);
  const t = Math.min(Math.max((votes - floor) / range, 0), 1);
  return Math.pow(t, config.voteCurve);
}
