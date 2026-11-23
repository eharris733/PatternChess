/**
 * Test-only D1 stand-in over Node's built-in `node:sqlite` (Node ≥ 22.5), so
 * RPC handlers can run against the real D1 schema (d1/migrations/*.sql) in
 * plain vitest — no miniflare. Covers what functions/_shared/db.ts uses:
 * prepare → bind → all / first / run / raw, plus batch (one transaction).
 *
 *   const db = await openTestD1();            // in-memory, both migrations applied
 *   const db = await openTestD1({ file, readOnly: true, migrate: false }); // a local D1 copy
 *
 * Never import this from runtime code.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Bind = string | number | null | bigint | Uint8Array;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SqliteDb {
  prepare(sql: string): any;
  exec(sql: string): void;
  close(): void;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'd1', 'migrations');

class TestStatement {
  constructor(
    private readonly db: SqliteDb,
    readonly sql: string,
    readonly params: Bind[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(
      this.db,
      this.sql,
      values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Bind))),
    );
  }

  private prepared(): any {
    return this.db.prepare(this.sql);
  }

  returnsRows(): boolean {
    const s = this.prepared();
    return typeof s.columns === 'function' ? s.columns().length > 0 : /^\s*(select|with)\b|\breturning\b/i.test(this.sql);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.prepared().all(...this.params) as Record<string, unknown>[];
    return { results: rows.map((r) => ({ ...r }) as T), success: true, meta: { duration: 0 } };
  }

  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.prepared().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? (row[col] as T) : ({ ...row } as T)) ?? null;
  }

  async run(): Promise<{ results: never[]; success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.prepared().run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const s = this.prepared();
    s.setReturnArrays?.(true);
    return s.all(...this.params) as T[];
  }

  /** Synchronous execution for batch(). */
  execSync(): { results: Record<string, unknown>[]; success: true; meta: Record<string, unknown> } {
    if (this.returnsRows()) {
      return { results: this.prepared().all(...this.params), success: true, meta: {} };
    }
    const r = this.prepared().run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
}

export interface TestD1 extends D1Database {
  /** The underlying node:sqlite handle (seed data with `.exec` / `.prepare`). */
  readonly sqlite: SqliteDb;
  close(): void;
}

export interface OpenTestD1Options {
  /** Path to an existing SQLite file (e.g. a copy of .wrangler/state's D1). Default: in-memory. */
  file?: string;
  readOnly?: boolean;
  /** Apply d1/migrations/*.sql (default true for in-memory, false for a file). */
  migrate?: boolean;
}

export async function openTestD1(opts: OpenTestD1Options = {}): Promise<TestD1> {
  const spec = 'node:sqlite';
  const { DatabaseSync } = (await import(/* @vite-ignore */ spec)) as { DatabaseSync: new (p: string, o?: object) => SqliteDb };
  const db = new DatabaseSync(opts.file ?? ':memory:', opts.readOnly ? { readOnly: true } : {});
  if (opts.migrate ?? !opts.file) {
    for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
  }
  const d1 = {
    sqlite: db,
    close: () => db.close(),
    prepare: (sql: string) => new TestStatement(db, sql),
    batch: async (stmts: TestStatement[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.execSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => {
      throw new Error('dump() is not supported by the test D1');
    },
    withSession: () => d1,
  };
  return d1 as unknown as TestD1;
}
