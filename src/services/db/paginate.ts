/**
 * PostgREST caps a single response at 1000 rows (the project's `max_rows`).
 * A query that can return more than that silently truncates, so any read
 * whose size grows with the user's history goes through these helpers.
 */
export const PAGE_SIZE = 1000;

/** The part of a supabase-js filter builder `fetchAllRows` needs. */
interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Read every row of a query, one 1000-row page at a time. `build` is called
 * once per page because supabase-js builders are mutable (a `.range()` on a
 * reused builder stacks). The query must have a deterministic order — add
 * `.order('id')` as a tiebreak — or pages can skip/repeat rows.
 */
export async function fetchAllRows<T>(build: () => RangeableQuery<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * `.in(column, ids)` puts every id in the URL; a few hundred UUIDs already
 * overflow it (HTTP 400). Run the lookup per chunk and concatenate.
 */
export const IN_CHUNK_SIZE = 200;

export async function fetchInChunks<T>(
  ids: readonly string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    rows.push(...(await fetchChunk(ids.slice(i, i + IN_CHUNK_SIZE))));
  }
  return rows;
}
