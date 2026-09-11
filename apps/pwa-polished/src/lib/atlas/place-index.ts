/**
 * Loading the place index out of the installed pack.
 *
 * Thirteen gzipped columns covering all 562,524 places — about 11 MB on the
 * wire and 30 MB resident once inflated. Loaded on the first search or the
 * first drawn dot, not when the map opens, and dropped when the pane closes:
 * a reader who never searches never pays for it.
 *
 * The searching and ranking live in place-search.ts, which has no imports at
 * all so it can be run against the real rows outside a browser.
 */

import { readTransaction } from '../../adapters/db';
import {
  boundsIn,
  columnsFrom,
  searchIn,
  type PlaceColumns,
  type PlaceHit,
} from './place-search';

export type { PlaceHit } from './place-search';

let loading: Promise<PlaceColumns | null> | null = null;

/** Let the index go. The map pane calls this when it closes. */
export function releasePlaceIndex(): void {
  loading = null;
}

async function inflate(data: Blob | Uint8Array): Promise<Uint8Array> {
  const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function loadPlaceIndex(): Promise<PlaceColumns | null> {
  if (!loading) loading = build();
  return loading;
}

async function build(): Promise<PlaceColumns | null> {
  let stored: any[];
  try {
    stored = await readTransaction<any[]>('atlas_place_index', (store) =>
      store.getAll() as IDBRequest<any[]>
    );
  } catch {
    return null;
  }
  if (!stored?.length) return null;

  const raw = new Map<string, Uint8Array>();
  for (const row of stored) raw.set(row.name, await inflate(row.data));

  return columnsFrom(raw);
}

/** Search the modern world. Empty until the index is installed. */
export async function searchPlaces(query: string, limit = 40): Promise<PlaceHit[]> {
  const cols = await loadPlaceIndex();
  return cols ? searchIn(cols, query, limit) : [];
}

/** Everything worth a dot inside the given view. */
export async function placesInBounds(
  bounds: { west: number; south: number; east: number; north: number },
  options: { limit?: number; minPopulation?: number } = {}
): Promise<PlaceHit[]> {
  const cols = await loadPlaceIndex();
  return cols ? boundsIn(cols, bounds, options) : [];
}
