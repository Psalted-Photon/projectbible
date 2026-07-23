/**
 * Turns flat search categories into the nested tree the results UI renders.
 *
 * Every category collapses to the same shape — label, count, children or leaf
 * results — so one component can draw Bible → translation → book → verse and
 * Notes → note with the same code.
 */

import { BIBLE_BOOKS, normalizeBookName, getBookColor } from './bibleData.js';
import type { SearchCategory, SearchResult } from './services/searchService';

export interface SearchTreeNode {
  /** Unique path key — drives expand/collapse state. */
  key: string;
  label: string;
  count: number;
  /** Depth-based accent colour (book colours come from getBookColor). */
  color?: string;
  children?: SearchTreeNode[];
  results?: SearchResult[];
}

const bookOrderMap = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Verses grouped into canonical book order, coloured to match the reader. */
function bookNodes(parentKey: string, results: SearchResult[]): SearchTreeNode[] {
  const byBook = groupBy(results, (r) => normalizeBookName(r.data?.book || 'Unknown'));
  return [...byBook.entries()]
    .sort(([a], [b]) => (bookOrderMap.get(a) ?? 999) - (bookOrderMap.get(b) ?? 999))
    .map(([book, bookResults]) => ({
      key: `${parentKey}::${book}`,
      label: book,
      count: bookResults.length,
      color: getBookColor(book),
      results: bookResults,
    }));
}

/**
 * Build the full tree.
 *
 * Bible results nest twice (translation, then book). Categories that declare a
 * `groupKey` on their results nest once. Everything else is a flat leaf list.
 */
export function buildSearchTree(categories: SearchCategory[]): SearchTreeNode[] {
  return categories
    .filter((category) => category.count > 0 || category.alwaysShow)
    .map((category) => {
      const key = category.key;

      if (category.key === 'bible') {
        const byTranslation = groupBy(category.results, (r) => r.data?.translation || 'Unknown');
        const children = [...byTranslation.entries()]
          .map(([translationId, results]) => ({
            key: `${key}::${translationId}`,
            label: translationId.toUpperCase(),
            count: results.length,
            children: bookNodes(`${key}::${translationId}`, results),
          }))
          .sort((a, b) => b.count - a.count);

        return { key, label: category.name, count: category.count, children };
      }

      const hasGroups = category.results.some((r) => r.group);
      if (hasGroups) {
        const byGroup = groupBy(category.results, (r) => r.group || 'Other');
        const children = [...byGroup.entries()]
          .map(([group, results]) => ({
            key: `${key}::${group}`,
            label: group,
            count: results.length,
            results,
          }))
          .sort((a, b) => b.count - a.count);

        return { key, label: category.name, count: category.count, children };
      }

      return {
        key,
        label: category.name,
        count: category.count,
        results: category.results,
      };
    });
}
