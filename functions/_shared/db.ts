import { decodeRow, encodeRow } from './schema';

/**
 * Thin helpers over the app D1 database (`patternchess-app`, bound as DB).
 *
 * Rows come back in the PostgREST shape the client mappers already parse:
 * snake_case columns, real booleans and parsed JSON/arrays. Pass the table name
 * as `decodeAs` to get that decoding (it uses the per-table map in ./schema).
 * Parameters are encoded for SQLite automatically: booleans → 0/1, Date → ISO,
 * arrays/objects → JSON text, undefined → NULL.
 *
 * D1 allows at most 100 bound parameters per statement: split `IN (...)` lists
 * and multi-row inserts with `chunk()` (insertMany does it for you).
 */

/** Bindings + vars shared by every Pages Function on the new backend. */
export interface AppEnv {
  /** D1 `patternchess-app`: app tables + better-auth tables. */
  DB: D1Database;
  /** KV `patternchess-auth`: better-auth secondaryStorage (sessions, rate limits). */
  AUTH_KV: KVNamespace;
  BETTER_AUTH_SECRET: string;
  /** Canonical origin (https://patternchess.com in prod, http://localhost:8788 locally). Optional. */
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** '1' enables email+password sign-up/in without verification (automated tests; never prod). */
  AUTH_TEST_MODE?: string;
  /**
   * Service binding to the notifier Worker (workers/notifier, RPC). Optional:
   * without it (local dev without the notifier) the hourly run still mails
   * the confirmation link.
   */
  NOTIFIER?: NotifierRpc;
}

/** The notifier Worker's RPC surface (workers/notifier/src/index.ts). */
export interface NotifierRpc {
  sendConfirm(userId: string): Promise<{ sent: boolean; reason?: string }>;
}

export type SqlParam = string | number | boolean | null | undefined | Date | readonly unknown[] | object;

/** D1 bind value for one JS value. */
export function toSqlValue(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** A prepared statement with its parameters bound (use in `batch`). */
export function stmt(db: D1Database, sql: string, params: readonly SqlParam[] = []): D1PreparedStatement {
  const s = db.prepare(sql);
  return params.length ? s.bind(...params.map(toSqlValue)) : s;
}

function decode<T>(row: Record<string, unknown>, decodeAs?: string): T {
  return (decodeAs ? decodeRow<T>(decodeAs, row) : row) as T;
}

/** Every row of a query, decoded as `decodeAs` when given. */
export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly SqlParam[] = [],
  decodeAs?: string,
): Promise<T[]> {
  const { results } = await stmt(db, sql, params).all<Record<string, unknown>>();
  return (results ?? []).map((r) => decode<T>(r, decodeAs));
}

/** The first row of a query (or null), decoded as `decodeAs` when given. */
export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly SqlParam[] = [],
  decodeAs?: string,
): Promise<T | null> {
  const row = await stmt(db, sql, params).first<Record<string, unknown>>();
  return row ? decode<T>(row, decodeAs) : null;
}

/** A single scalar (first column of the first row), e.g. `select count(*) …`. */
export async function scalar<T = number>(db: D1Database, sql: string, params: readonly SqlParam[] = []): Promise<T | null> {
  const row = await stmt(db, sql, params).first<Record<string, unknown>>();
  if (!row) return null;
  const key = Object.keys(row)[0];
  return key === undefined ? null : (row[key] as T);
}

/** A write. Returns D1's meta (`changes`, `last_row_id`, …). */
export async function run(db: D1Database, sql: string, params: readonly SqlParam[] = []): Promise<D1Meta> {
  const res = await stmt(db, sql, params).run();
  return res.meta;
}

/** Several statements in one implicit transaction (all or nothing). */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return db.batch(statements);
}

/** Split a list into chunks of at most `n` (D1: ≤100 bound parameters per statement). */
export function chunk<T>(items: readonly T[], n: number): T[][] {
  if (n <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** `?, ?, ?` for an IN list of `n` values. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Double-quoted SQL identifier (`user` is a reserved word in SQLite). */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** ISO 8601 UTC timestamp, the TEXT format every timestamptz column uses. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A random v4 uuid (replaces Postgres gen_random_uuid()). */
export function uuid(): string {
  return crypto.randomUUID();
}

export interface InsertOptions {
  /**
   * Conflict handling:
   * - `'ignore'` → `INSERT OR IGNORE`
   * - `{ target: ['user_id', 'fen'], update?: ['col', …] }` → `ON CONFLICT (…) DO UPDATE SET col = excluded.col`
   *   (no `update` → `DO NOTHING`)
   */
  onConflict?: 'ignore' | { target: readonly string[]; update?: readonly string[] };
  /** `RETURNING …` clause columns (use with `first`/`all` via `stmt`). */
  returning?: readonly string[];
}

function insertSql(table: string, cols: readonly string[], rowCount: number, opts: InsertOptions): string {
  const verb = opts.onConflict === 'ignore' ? 'INSERT OR IGNORE' : 'INSERT';
  const tuple = `(${placeholders(cols.length)})`;
  let sql = `${verb} INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES ${Array.from(
    { length: rowCount },
    () => tuple,
  ).join(', ')}`;
  if (opts.onConflict && opts.onConflict !== 'ignore') {
    const { target, update } = opts.onConflict;
    sql += ` ON CONFLICT (${target.map(ident).join(', ')})`;
    sql +=
      update && update.length
        ? ` DO UPDATE SET ${update.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
        : ' DO NOTHING';
  }
  if (opts.returning?.length) sql += ` RETURNING ${opts.returning.map(ident).join(', ')}`;
  return sql;
}

/** One-row INSERT statement; `row` is encoded with the table's map (booleans, JSON). */
export function insertStmt(
  db: D1Database,
  table: string,
  row: Record<string, unknown>,
  opts: InsertOptions = {},
): D1PreparedStatement {
  const enc = encodeRow(table, row);
  const cols = Object.keys(enc).filter((c) => enc[c] !== undefined);
  return stmt(db, insertSql(table, cols, 1, opts), cols.map((c) => enc[c] as SqlParam));
}

/**
 * Multi-row INSERT statements, chunked to stay under D1's 100-parameter limit.
 * Every row must have the same keys as the first. Run them with `batch()`.
 */
export function insertManyStmts(
  db: D1Database,
  table: string,
  rows: readonly Record<string, unknown>[],
  opts: InsertOptions = {},
): D1PreparedStatement[] {
  if (rows.length === 0) return [];
  const encoded = rows.map((r) => encodeRow(table, r));
  const cols = Object.keys(encoded[0]);
  const perStmt = Math.max(1, Math.floor(100 / Math.max(1, cols.length)));
  return chunk(encoded, perStmt).map((group) =>
    stmt(
      db,
      insertSql(table, cols, group.length, opts),
      group.flatMap((r) => cols.map((c) => r[c] as SqlParam)),
    ),
  );
}

/** `UPDATE table SET … WHERE <where>`; `patch` is encoded with the table's map. */
export function updateStmt(
  db: D1Database,
  table: string,
  patch: Record<string, unknown>,
  where: string,
  whereParams: readonly SqlParam[] = [],
): D1PreparedStatement {
  const enc = encodeRow(table, patch);
  const cols = Object.keys(enc).filter((c) => enc[c] !== undefined);
  if (cols.length === 0) throw new Error(`updateStmt(${table}): empty patch`);
  return stmt(
    db,
    `UPDATE ${ident(table)} SET ${cols.map((c) => `${ident(c)} = ?`).join(', ')} WHERE ${where}`,
    [...cols.map((c) => enc[c] as SqlParam), ...whereParams],
  );
}
