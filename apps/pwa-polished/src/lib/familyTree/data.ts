/**
 * The family tree's data, lazily imported as its own chunk.
 *
 * src/data/family-tree.json is 130 KB — small next to the pack-backed data
 * modules beside this one, but the main bundle is already 3.58 MB and Workbox
 * won't precache anything over 4 MB, so it still has to be its own chunk
 * rather than a static import. Loaded the way enochBooks.ts loads a book: one
 * shared promise, reset on failure so a flaky connection gets another try.
 */

import { writable } from 'svelte/store';

/** A tribal head or one of his descendants — the 665-person canopy. */
export interface FamilyTreeNode {
  id: string;
  label: string;
  father: string | null;
  tribe: string;
  /** Generations below the son of Jacob who heads this tribe. */
  depth: number;
  meaning: string | null;
  verseCount: number;
}

/** Someone from Adam to Jacob, or married into that line — the 187-person root mat. */
export interface FamilyTreeRoot {
  id: string;
  label: string;
  father: string | null;
  /** Who this person is married to, where both are on the tree. */
  spouseOf: string | null;
  /** Generations from Adam. */
  depth: number;
  /** Which pre-Jacob bough this hangs off; 'Trunk' is Adam → Jacob itself. */
  branch: string;
  female: boolean;
  meaning: string | null;
  /** Years lived, only where the pack gives both a birth and a death year. */
  lived: number | null;
  verseCount: number;
}

/** One name on a genealogy chain to Jesus. */
export interface FamilyTreeCrownLink {
  id: string;
  label: string;
}

export interface FamilyTreeCrown {
  jesus: string;
  matthew: FamilyTreeCrownLink[];
  luke: FamilyTreeCrownLink[];
  /** Ids the two chains share, so the run from Jacob to David draws once. */
  shared: string[];
  /** Where Matthew and Luke part ways — David, choosing Solomon over Nathan. */
  divergeAt: string | null;
}

export interface FamilyTreeData {
  attribution: string;
  generated: string;
  /** israel_682, the patriarch — see the note on this slug in the build script. */
  jacob: string;
  /** Birth order, which is also the order of the breastpiece stones. */
  tribeOrder: string[];
  counts: Record<string, number>;
  maxDepth: number;
  /** The order the twelve boughs' root-side counterparts are listed in. */
  rootBranchOrder: string[];
  rootCounts: Record<string, number>;
  rootMaxDepth: number;
  roots: FamilyTreeRoot[];
  crown: FamilyTreeCrown;
  nodes: FamilyTreeNode[];
}

let dataPromise: Promise<FamilyTreeData> | null = null;

/**
 * Every id on the tree — nodes and roots together, 852 in all.
 *
 * Populated once the data resolves, so the People index and card can show a
 * 🌳 without loading the whole tree themselves. Filled by replacing the Set
 * outright rather than mutating it: Svelte only reacts to a store's value
 * actually changing, and adding to a Set in place leaves the reference — and
 * so the subscription — untouched.
 */
export const familyTreeIds = writable<Set<string>>(new Set());

/**
 * Load the tree's data, keeping one shared promise around the import.
 *
 * Reset on failure — the way BibleReader's red-letter loader does — so a
 * network hiccup on first open doesn't wedge every later attempt behind a
 * permanently-rejected promise.
 */
export function loadFamilyTree(): Promise<FamilyTreeData> {
  if (dataPromise) return dataPromise;
  dataPromise = import('../../data/family-tree.json')
    .then((m) => m.default as unknown as FamilyTreeData)
    .then((data) => {
      familyTreeIds.set(new Set([...data.nodes.map((n) => n.id), ...data.roots.map((r) => r.id)]));
      return data;
    })
    .catch((err) => {
      dataPromise = null;
      throw err;
    });
  return dataPromise;
}
