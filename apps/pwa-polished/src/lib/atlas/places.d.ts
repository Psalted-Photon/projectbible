// Types for places.js, which stays plain JavaScript so atlas-lab.js can
// import it as-is.

export function groupByBook(
  verses: [string, string][]
): { book: string; refs: { readable: string; osis: string }[] }[];

export function bookName(osisBook: string): string;

/**
 * Kilometres as a miles string, for display. Null for a missing distance, so a
 * caller cannot print "null miles" without noticing.
 */
export function miles(km: number | null | undefined): string | null;

/** The same, rounded and hedged, for a journey total. */
export function approxMiles(km: number | null | undefined): string | null;
