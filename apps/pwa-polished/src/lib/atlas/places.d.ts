// Types for places.js, which stays plain JavaScript so atlas-lab.js can
// import it as-is.

export function groupByBook(
  verses: [string, string][]
): { book: string; refs: { readable: string; osis: string }[] }[];

export function bookName(osisBook: string): string;
