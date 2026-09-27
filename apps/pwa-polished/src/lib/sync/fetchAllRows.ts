/**
 * Every row a query matches, fetched a page at a time.
 *
 * Supabase answers any single request with at most 1,000 rows (the project's
 * max-rows setting) and says nothing about the rest. The full pulls then
 * reconcile against what came back, so an unpaged pull treated row 1,001
 * onwards as "deleted elsewhere" and removed it from the device on every
 * sign-in. The server copy was never touched.
 *
 * Keyset paging — "the next 1,000 after the last id I saw" — rather than
 * offsets, so a row added or removed on another device mid-pull cannot shift
 * the pages and make one row fall through the gap between two of them.
 *
 * `makeQuery` must build a fresh `.from(...).select(...)` with its filters
 * each time; the ordering, the cursor and the limit are added here. `key` has
 * to be unique within the result.
 */

const PAGE_SIZE = 1000;

export async function fetchAllRows<T = any>(
  makeQuery: () => any,
  key = 'id',
): Promise<{ data: T[] | null; error: any }> {
  const rows: T[] = [];
  let after: unknown = null;

  for (;;) {
    let query = makeQuery();
    if (after !== null) query = query.gt(key, after);
    const { data, error } = await query.order(key, { ascending: true }).limit(PAGE_SIZE);
    if (error) return { data: null, error };

    const batch: T[] = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: rows, error: null };
    after = (batch[batch.length - 1] as any)[key];
  }
}
