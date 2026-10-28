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

/** Pages requested at once after the first one comes back full. */
const PARALLEL_PAGES = 4;

/**
 * Read every row of a query in 1000-row pages. The first page is fetched on
 * its own (most queries fit in it); when it comes back full, the next pages
 * are fetched PARALLEL_PAGES at a time. Each page costs about a second of
 * round trip for a large account, so one page after another made a
 * 3,500-game library take ~5s per list. A page past the end comes back
 * empty, so reading ahead is safe. `build` is called once per page because
 * supabase-js builders are mutable (a `.range()` on a reused builder stacks).
 * The query must have a deterministic order — add `.order('id')` as a
 * tiebreak — or pages can skip/repeat rows.
 */
export async function fetchAllRows<T>(build: () => RangeableQuery<T>): Promise<T[]> {
  const fetchPage = async (index: number): Promise<T[]> => {
    const from = index * PAGE_SIZE;
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    return data ?? [];
  };

  const first = await fetchPage(0);
  if (first.length < PAGE_SIZE) return first;
  const rows: T[] = [...first];
  for (let next = 1; ; next += PARALLEL_PAGES) {
    const batch = await Promise.all(
      Array.from({ length: PARALLEL_PAGES }, (_, i) => fetchPage(next + i)),
    );
    for (const page of batch) {
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
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
