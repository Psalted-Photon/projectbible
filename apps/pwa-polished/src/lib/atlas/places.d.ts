// Types for places.js, which stays plain JavaScript so atlas-lab.js can
// import it as-is.

export function groupByBook(
  verses: [string, string][]
): { book: string; refs: { readable: string; osis: string }[] }[];

export function bookName(osisBook: string): string;

/** Set the US/Metric choice that distance strings default to. */
export function setDistanceUnits(units: "us" | "metric" | undefined): void;

/**
 * Kilometers as a distance string with its unit ("3.4 miles", "5.5 km"). Null
 * for a missing distance, so a caller cannot print "null miles" unnoticed.
 */
export function distance(km: number | null | undefined, units?: "us" | "metric"): string | null;

/** The same, rounded and hedged, for a journey total. */
export function approxDistance(km: number | null | undefined, units?: "us" | "metric"): string | null;
