/**
 * Where everything sits on the axis.
 *
 * Kept out of the component for the same reason the map's maths is: the
 * component is about chrome and gestures, and none of this needs a DOM to be
 * reasoned about.
 *
 * The one thing this module must not assume is that the eras tile the span.
 * They do not. Four irregularities in the data, all real:
 *   - Exile (-605) starts before Judah Alone ends (-586), so two bands overlap
 *   - 430 years separate Patriarchal's end from Exodus's start
 *   - Gospel ends and Early Church starts in the same year, 33
 *   - years are signed and there is no year 0
 * So each era is laid out as its own band in its own lane, and a gap is simply
 * a stretch of axis with no band over it.
 */

import type { TimelineEra, TimelineEvent } from './data';
import { getBookColor, CATEGORY_COLORS } from '../bibleData';

/** How tall one year is at zoom 1, in CSS pixels. */
export const PX_PER_YEAR = 0.28;

/** Breathing room above the first year and below the last. */
const PAD_YEARS = 60;

export interface TimelineScale {
  minYear: number;
  maxYear: number;
  /** Total height of the axis content at zoom 1. */
  height: number;
  /** Year → y, in content pixels before zoom. */
  y: (year: number) => number;
  /** y → year, for reading a position back. */
  yearAt: (y: number) => number;
}

export function makeScale(minYear: number, maxYear: number): TimelineScale {
  const lo = minYear - PAD_YEARS;
  const hi = maxYear + PAD_YEARS;
  const height = Math.max(1, (hi - lo) * PX_PER_YEAR);
  return {
    minYear: lo,
    maxYear: hi,
    height,
    y: (year: number) => (year - lo) * PX_PER_YEAR,
    yearAt: (y: number) => lo + y / PX_PER_YEAR,
  };
}

/**
 * Which book stands for an era, for colour.
 *
 * Colours come off the app's own book ramp rather than a new palette, so the
 * timeline reads as part of the same app. An era is coloured by a book that
 * sits inside it; where the data gives no verses at all (four of the twelve
 * have none tagged) the book here is still the honest one for the period.
 */
const ERA_BOOK: Record<string, string> = {
  'Primeval': 'Genesis',
  'Patriarchal': 'Genesis',
  'Exodus': 'Exodus',
  'Conquest': 'Joshua',
  'Judges': 'Judges',
  'United Kingdom': '1 Samuel',
  'Divided Kingdom': '1 Kings',
  'Judah Alone': 'Isaiah',
  'Exile': 'Daniel',
  'Post-Exile': 'Ezra',
  'Gospel': 'Matthew',
  'Early Church': 'Acts',
};

export function eraColor(eraId: string): string {
  const book = ERA_BOOK[eraId];
  return book ? getBookColor(book) : CATEGORY_COLORS.historical;
}

/** An event takes the colour of the book it opens, or of its era. */
export function eventColor(ev: TimelineEvent): string {
  if (ev.first) return getBookColor(ev.first.book);
  return ev.era ? eraColor(ev.era) : CATEGORY_COLORS.historical;
}

export interface EraBand {
  era: TimelineEra;
  top: number;
  height: number;
  color: string;
  /** Which lane it draws in, so overlapping eras sit side by side. */
  lane: number;
}

/**
 * Place the bands, giving an overlapping pair its own lane each.
 *
 * Greedy by start year: a band takes the first lane whose last band ends before
 * it starts. With this data that is two lanes at most, but nothing here assumes
 * that — a richer era table would simply use more.
 */
export function layoutEras(eras: TimelineEra[], scale: TimelineScale): { bands: EraBand[]; lanes: number } {
  const laneEnds: number[] = [];
  const bands: EraBand[] = eras.map((era) => {
    const top = scale.y(era.year_start);
    const bottom = scale.y(era.year_end);
    let lane = laneEnds.findIndex((end) => end <= era.year_start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(era.year_end);
    } else {
      laneEnds[lane] = era.year_end;
    }
    return {
      era,
      top,
      // A band that spans a single year would be invisible; give it a floor.
      height: Math.max(6, bottom - top),
      color: eraColor(era.era_id),
      lane,
    };
  });
  return { bands, lanes: Math.max(1, laneEnds.length) };
}

export interface EventMark {
  event: TimelineEvent;
  /** The event's true position on the axis. */
  year: number;
  top: number;
  /** Where its label is drawn, pushed down where labels would collide. */
  labelTop: number;
  color: string;
}

/**
 * Place the markers, and stop their labels from stacking on top of each other.
 *
 * The dot stays at the true year — that is the whole point of a timeline — but
 * the label is allowed to slide down, with a leader line drawn back to the dot
 * by the component. Events in the same year (four pairs share one) would
 * otherwise print one name on top of another.
 */
export function layoutEvents(
  events: TimelineEvent[],
  scale: TimelineScale,
  minLabelGap: number,
  zoom: number,
): EventMark[] {
  // Labels are laid out in screen pixels, so the gap has to be converted back
  // into content pixels or zooming in would keep pushing them apart.
  const gap = minLabelGap / Math.max(zoom, 0.01);
  let lastLabel = -Infinity;
  return events.map((event) => {
    const top = scale.y(event.year_start);
    const labelTop = Math.max(top, lastLabel + gap);
    lastLabel = labelTop;
    return { event, year: event.year_start, top, labelTop, color: eventColor(event) };
  });
}

/**
 * The year lines down the side.
 *
 * The step widens as you zoom out so the axis never turns into a solid ruled
 * block — centuries close in, half-millennia at a distance.
 */
export function yearTicks(scale: TimelineScale, zoom: number): number[] {
  const pxPerYear = PX_PER_YEAR * zoom;
  const step = pxPerYear > 0.9 ? 100 : pxPerYear > 0.38 ? 250 : pxPerYear > 0.16 ? 500 : 1000;
  const first = Math.ceil(scale.minYear / step) * step;
  const out: number[] = [];
  for (let y = first; y <= scale.maxYear; y += step) out.push(y);
  return out;
}
