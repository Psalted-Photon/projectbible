// Types for map.js, plain JavaScript lifted from the atlas lab. Only what the
// app imports is described here.

export interface TileBasemap {
  label: string;
  online: boolean;
  build: () => unknown;
  credit: string;
}

export const TILE_BASEMAPS: Record<string, TileBasemap>;

export function createAtlasMap(container: HTMLElement, options?: Record<string, any>): any;
