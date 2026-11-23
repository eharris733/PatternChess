// Decode map for the D1 app database (d1/migrations/0001_app.sql + 0002_auth.sql).
//
// D1 stores booleans as INTEGER 0/1, jsonb/text[] as JSON TEXT and timestamps
// as ISO TEXT. API responses must keep the row shape PostgREST returned
// (snake_case, real booleans, parsed JSON/arrays) so the client's mappers keep
// working: run every row read from an app table through decodeRow(), and every
// object written to one through encodeRow().
//
// Timestamps: one canonical format, ISO 8601 UTC with milliseconds
// (`2026-11-22T03:16:41.851Z`, what Date#toISOString() prints), so string
// comparison in SQL equals time order. encodeRow() normalizes ts columns to it.
//
// This file is also imported by scripts/migrate/import-d1.mjs (Node strips the
// types), so keep it free of non-erasable TypeScript (no enums/namespaces) and
// of runtime imports.

export interface TableSpec {
  /** INTEGER 0/1 columns that the API returns as booleans. */
  readonly bool: readonly string[];
  /** TEXT columns holding JSON (jsonb and text[] in Postgres). */
  readonly json: readonly string[];
  /** TEXT timestamp columns (timestamptz in Postgres), canonical ISO UTC. */
  readonly ts: readonly string[];
}

const spec = (s: Partial<TableSpec>): TableSpec => ({
  bool: s.bool ?? [],
  json: s.json ?? [],
  ts: s.ts ?? [],
});

export const TABLES: Record<string, TableSpec> = {
  profiles: spec({
    bool: [
      'preferred_rated_only',
      'show_engine_evals',
      'reveal_before_solve',
      'autoplay_refutation',
      'used_training_filter',
      'sounds_enabled',
      'leaderboard_opt_out',
      'followed_instagram',
      'show_answer_on_miss',
      'email_opt_in',
    ],
    json: ['preferred_time_controls', 'learn_chapters_done'],
    ts: [
      'created_at',
      'last_synced_lichess_at',
      'last_synced_chesscom_at',
      'contact_email_verified_at',
      'email_prompted_at',
      'course_prompted_at',
      'supporter_prompted_at',
      'email_unsubscribed_at',
    ],
  }),
  games: spec({
    bool: ['rated'],
    json: ['clock_per_ply'],
    ts: ['played_at', 'created_at', 'analyzed_at', 'parsed_metadata_at', 'opening_classified_at'],
  }),
  blunders: spec({
    bool: ['last_drill_failed'],
    json: ['correct_moves', 'solution_line', 'motifs', 'drill_data'],
    ts: ['last_drilled_at', 'next_drill_at', 'created_at', 'deepened_at', 'retired_at'],
  }),
  endgame_scenarios: spec({
    bool: ['last_drill_failed'],
    ts: ['last_played_at', 'created_at', 'verified_at', 'retired_at', 'last_drilled_at', 'next_drill_at'],
  }),
  opening_deviations: spec({
    json: ['theory_moves'],
    ts: ['evaluated_at', 'created_at', 'past_book_checked_at'],
  }),
  repertoire_moves: spec({ ts: ['created_at'] }),
  training_sessions: spec({ ts: ['started_at', 'ended_at'] }),
  game_annotations: spec({ json: ['annotations'], ts: ['created_at', 'updated_at'] }),
  supporters: spec({
    bool: ['cancel_at_period_end'],
    ts: ['current_period_end', 'first_supported_at', 'beta_invited_at', 'created_at', 'updated_at'],
  }),
  funnel_events: spec({ ts: ['created_at'] }),
  email_sends: spec({ ts: ['sent_at'] }),
  email_confirmations: spec({ ts: ['created_at'] }),
  event_digest_subscribers: spec({
    ts: ['created_at', 'confirmed_at', 'unsubscribed_at', 'last_sent_at'],
  }),
  lead_outreach: spec({ ts: ['contacted_at'] }),
  landing_stats_cache: spec({ json: ['payload'], ts: ['computed_at'] }),
  public_leaderboard_cache: spec({ json: ['payload'], ts: ['computed_at'] }),
  benchmarks: spec({}),
  // D1-native (0003): the daily Instagram/TikTok puzzle queue (scripts/social/).
  social_posts: spec({ json: ['puzzle'], ts: ['insights_at', 'posted_at', 'created_at'] }),
  // better-auth tables (camelCase columns; better-auth's own adapter handles
  // them, these entries exist for admin queries and the importer).
  user: spec({ bool: ['emailVerified'], ts: ['createdAt', 'updatedAt'] }),
  session: spec({ ts: ['expiresAt', 'createdAt', 'updatedAt'] }),
  account: spec({
    ts: ['accessTokenExpiresAt', 'refreshTokenExpiresAt', 'createdAt', 'updatedAt'],
  }),
  verification: spec({ ts: ['expiresAt', 'createdAt', 'updatedAt'] }),
};

/** The 17 app tables ported from Supabase `public` (excludes better-auth's and the D1-native ones). */
export const APP_TABLES: readonly string[] = Object.keys(TABLES).filter(
  (t) => !['user', 'session', 'account', 'verification', 'social_posts'].includes(t),
);

function tableSpec(table: string): TableSpec {
  const s = TABLES[table];
  if (!s) throw new Error(`schema: unknown table "${table}"`);
  return s;
}

/**
 * D1 row -> PostgREST-shaped row: INTEGER 0/1 -> boolean, JSON TEXT -> parsed.
 * Only keys present on the row are touched, so partial selects work. NULL stays
 * null. Columns not in the map (and computed aliases) pass through unchanged.
 */
export function decodeRow<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): T {
  const s = tableSpec(table);
  const out: Record<string, unknown> = { ...row };
  for (const col of s.bool) {
    const v = out[col];
    if (typeof v === 'number') out[col] = v !== 0;
    else if (typeof v === 'bigint') out[col] = v !== 0n;
  }
  for (const col of s.json) {
    const v = out[col];
    if (typeof v === 'string') {
      try {
        out[col] = JSON.parse(v);
      } catch {
        // Leave malformed text as-is rather than failing the whole response.
      }
    }
  }
  return out as T;
}

export function decodeRows<T = Record<string, unknown>>(
  table: string,
  rows: readonly Record<string, unknown>[],
): T[] {
  return rows.map((r) => decodeRow<T>(table, r));
}

/**
 * Object -> D1-bindable row (inverse of decodeRow), for inserts and updates:
 * boolean -> 0/1, JSON columns -> JSON.stringify (always, even for strings,
 * so pass the decoded value), timestamp columns -> canonical ISO UTC
 * (accepts Date, epoch ms, or any parseable string such as PostgREST's
 * `…034104+00:00`). `undefined` keys are dropped so the result can drive an
 * INSERT column list. For `games`, writing `time_control` also fills
 * `time_category` unless the caller set it explicitly.
 */
export function encodeRow(
  table: string,
  obj: Record<string, unknown>,
): Record<string, string | number | null> {
  const s = tableSpec(table);
  const bool = new Set(s.bool);
  const json = new Set(s.json);
  const ts = new Set(s.ts);
  const out: Record<string, string | number | null> = {};
  for (const [col, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) {
      out[col] = null;
    } else if (json.has(col)) {
      out[col] = JSON.stringify(v);
    } else if (bool.has(col)) {
      out[col] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    } else if (ts.has(col)) {
      out[col] = toIsoTimestamp(v as string | number | Date);
    } else if (typeof v === 'boolean') {
      out[col] = v ? 1 : 0;
    } else if (typeof v === 'string' || typeof v === 'number') {
      out[col] = v;
    } else if (typeof v === 'bigint') {
      out[col] = Number(v);
    } else {
      throw new TypeError(`schema: ${table}.${col} is not a JSON column; got ${typeof v}`);
    }
  }
  if (table === 'games' && 'time_control' in out && !('time_category' in obj)) {
    out.time_category = timeCategory(out.time_control as string | null);
  }
  return out;
}

const TS_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Canonical timestamp: ISO 8601 UTC with exactly 3 fractional digits.
 * Postgres microseconds are truncated to milliseconds. A string without an
 * offset is read as UTC. Unparseable strings are returned unchanged (and
 * other values throw), so bad input surfaces instead of turning into NULL.
 */
export function toIsoTimestamp(v: string | number | Date): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new RangeError('schema: invalid Date');
    return v.toISOString();
  }
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof v !== 'string') throw new TypeError(`schema: not a timestamp: ${typeof v}`);
  const m = TS_RE.exec(v.trim());
  if (!m) return v;
  const [, date, hm, sec = '00', frac = '', rawOff] = m;
  const ms = (frac + '000').slice(0, 3);
  let off = rawOff === undefined || rawOff === 'z' ? 'Z' : rawOff;
  if (off !== 'Z') {
    const sign = off[0];
    const digits = off.slice(1).replace(':', '');
    off = `${sign}${digits.slice(0, 2)}:${(digits.slice(2) || '00').padEnd(2, '0')}`;
  }
  const d = new Date(`${date}T${hm}:${sec}.${ms}${off}`);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

export type TimeCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

/**
 * games.time_category from a raw time-control header. Exact parity with the
 * Postgres aggregates (landing_stats, leaderboard, public_leaderboard,
 * email_report_data) and the client's categoryForTimeControl()
 * (src/services/chessApiService.ts): base = leading digits of the last '/'
 * segment of the part before '+' ("300+5" -> 300, "1/86400" -> 86400), then
 * < 180 bullet, < 600 blitz, < 1800 rapid, else classical. NULL when there
 * are no leading digits ("-", NULL).
 *
 * Known quirk kept for parity: "1 day per move" parses as 1 -> bullet.
 */
export function timeCategory(timeControl: string | null | undefined): TimeCategory | null {
  if (!timeControl) return null;
  const basePart = timeControl.split('+')[0].split('/').pop() ?? '';
  const m = /^\d+/.exec(basePart);
  if (!m) return null;
  const base = Number.parseInt(m[0], 10);
  if (base < 180) return 'bullet';
  if (base < 600) return 'blitz';
  if (base < 1800) return 'rapid';
  return 'classical';
}

/** Now as a canonical timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
