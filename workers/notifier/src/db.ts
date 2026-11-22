// Tiny helpers over the app D1 database (`patternchess-app`, bound as DB).
// Self-contained on purpose: the Worker bundles only workers/notifier/src.
// Timestamps are ISO 8601 UTC TEXT with milliseconds (what toISOString()
// prints), so string comparison in SQL equals time order; booleans are 0/1.

export type Param = string | number | boolean | null | undefined;

function bindValue(v: Param): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export function stmt(db: D1Database, sql: string, params: readonly Param[] = []): D1PreparedStatement {
  const s = db.prepare(sql);
  return params.length ? s.bind(...params.map(bindValue)) : s;
}

export async function all<T>(db: D1Database, sql: string, params: readonly Param[] = []): Promise<T[]> {
  const { results } = await stmt(db, sql, params).all<T>();
  return (results ?? []) as T[];
}

export async function first<T>(db: D1Database, sql: string, params: readonly Param[] = []): Promise<T | null> {
  return (await stmt(db, sql, params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, params: readonly Param[] = []): Promise<D1Meta> {
  return (await stmt(db, sql, params).run()).meta;
}
