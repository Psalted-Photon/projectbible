/**
 * How far a pack import has got, as a share of the rows in the pack file.
 *
 * The import counts its pack's rows once, when it opens the file, and every
 * batch write (batchWriteTransaction, which streamTable and the chunked loops
 * all go through) adds what it wrote. So the dozens of tables in pack-import
 * need no counting of their own.
 *
 * Not every row in a pack becomes exactly one row on the device -- a few
 * tables are skipped, a few are reshaped -- so the share holds at 99 until the
 * installer says the pack is in, and then shows 100.
 *
 * Nothing is counted unless an installer is watching, so the starter text at
 * launch and imports from a file pay nothing.
 */

let listener: ((percent: number) => void) | null = null;
let expected = 0;
let written = 0;
let lastPercent = -1;

/** Report import progress to `onPercent` until the returned stop is called. */
export function watchImportProgress(onPercent: (percent: number) => void): () => void {
  listener = onPercent;
  expected = 0;
  written = 0;
  lastPercent = -1;
  return () => {
    if (listener !== onPercent) return;
    listener = null;
    expected = 0;
  };
}

/** Whether anyone wants the rows counted. */
export function importWatched(): boolean {
  return listener !== null;
}

/** The import has opened its pack, which holds this many rows. */
export function expectImportRows(rows: number): void {
  if (!listener || rows <= 0) return;
  expected = rows;
  written = 0;
  lastPercent = -1;
  emit();
}

/** Whether batch writes should be counted right now. */
export function importCounting(): boolean {
  return listener !== null && expected > 0;
}

/** A batch write landed this many rows. */
export function countImportRows(rows: number): void {
  if (!importCounting() || rows <= 0) return;
  written += rows;
  emit();
}

function emit(): void {
  const percent = Math.min(99, Math.floor((written / expected) * 100));
  if (percent === lastPercent) return;
  lastPercent = percent;
  listener?.(percent);
}
