// Alerting (feedback round 2): the hourly run checks the things that can break
// quietly and emails the admin when one does.
//
// Checks (probeAll): the app's health RPC (Pages + D1), the opening book,
// the events API, the Lichess and Chess.com public APIs, RPC 500s per hour
// (rpc_errors, counted by functions/_shared/rpc/core.ts), this run's email
// send failures, and the outbox run itself. Outside reporters (the social
// workflow) post a result to /admin/alert.
//
// State per check lives in D1 `alert_state`. A check must fail
// FAIL_THRESHOLD runs in a row before the first email (one bad hour of a
// third-party API is noise); then a reminder every REMINDER_MS while it keeps
// failing, and one "recovered" email when it passes again. All transitions of
// one run go out in a single email to ALERT_TO.

import { all, first, run } from './db';

export const FAIL_THRESHOLD = 2;
export const REMINDER_MS = 24 * 60 * 60 * 1000;
/** RPC 500s in one hour for one handler before it counts as failing. */
export const RPC_ERROR_LIMIT = 20;
const PROBE_TIMEOUT_MS = 10_000;
const UA = 'PatternChess-Notifier/1.0 (+https://patternchess.com)';

export interface CheckResult {
  id: string;
  ok: boolean;
  /** What went wrong (or a short note when ok). */
  detail?: string;
  /**
   * Failures needed before the first alert (default FAIL_THRESHOLD). One-shot
   * reporters (a failed workflow run) use 1.
   */
  threshold?: number;
}

export interface AlertRow {
  check_id: string;
  consecutive_failures: number;
  failing_since: string | null;
  last_alert_at: string | null;
  last_error: string | null;
}

export type AlertEvent = 'failing' | 'reminder' | 'recovered';

/**
 * Pure transition for one check: the next row and what (if anything) to
 * email about it.
 */
export function nextAlertState(
  prev: AlertRow | null,
  result: CheckResult,
  now: Date,
): { row: AlertRow; event: AlertEvent | null } {
  const iso = now.toISOString();
  const base: AlertRow = prev ?? {
    check_id: result.id,
    consecutive_failures: 0,
    failing_since: null,
    last_alert_at: null,
    last_error: null,
  };
  if (result.ok) {
    const event: AlertEvent | null = base.last_alert_at ? 'recovered' : null;
    return {
      row: { check_id: result.id, consecutive_failures: 0, failing_since: null, last_alert_at: null, last_error: null },
      event,
    };
  }
  const failures = base.consecutive_failures + 1;
  const row: AlertRow = {
    check_id: result.id,
    consecutive_failures: failures,
    failing_since: base.failing_since ?? iso,
    last_alert_at: base.last_alert_at,
    last_error: result.detail ?? 'failed',
  };
  const threshold = result.threshold ?? FAIL_THRESHOLD;
  if (!base.last_alert_at) {
    if (failures >= threshold) {
      row.last_alert_at = iso;
      return { row, event: 'failing' };
    }
    return { row, event: null };
  }
  if (now.getTime() - Date.parse(base.last_alert_at) >= REMINDER_MS) {
    row.last_alert_at = iso;
    return { row, event: 'reminder' };
  }
  return { row, event: null };
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

export interface ProbeEnv {
  DB: D1Database;
  APP_URL: string;
  EVENTS_URL?: string;
}

type Fetch = typeof fetch;

async function probe(id: string, fn: () => Promise<string | void>): Promise<CheckResult> {
  try {
    const note = await fn();
    return { id, ok: true, ...(note ? { detail: note } : {}) };
  } catch (err) {
    if (err instanceof RateLimited) return { id, ok: true, detail: err.message };
    return { id, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function get(fetchImpl: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetchImpl(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url.replace(/\?.*$/, '')} answered ${res.status}`);
  return res;
}

/** A rate-limit answer from a third-party API: it is up, it just won't serve the Worker's shared IP right now. */
class RateLimited extends Error {}

/**
 * Third-party reachability: up when it answers 2xx, or 429 (Lichess rate-limits
 * Cloudflare's shared egress IPs; players fetch from their own IPs, so a 429
 * here says nothing about them). Returns null on 429 (nothing to inspect).
 */
async function reachable(fetchImpl: Fetch, url: string): Promise<Response | null> {
  try {
    return await get(fetchImpl, url);
  } catch (err) {
    if (err instanceof Error && / answered 429$/.test(err.message)) throw new RateLimited('rate limited (up)');
    throw err;
  }
}

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** RPC handlers with more than RPC_ERROR_LIMIT 500s in the current or previous hour. */
export async function rpcErrorBursts(db: D1Database, now: Date): Promise<Array<{ name: string; count: number; hour: string }>> {
  const hour = now.toISOString().slice(0, 13);
  const prev = new Date(now.getTime() - 3600_000).toISOString().slice(0, 13);
  return all<{ name: string; count: number; hour: string }>(
    db,
    'SELECT name, count, hour FROM rpc_errors WHERE hour IN (?, ?) AND count > ? ORDER BY count DESC',
    [hour, prev, RPC_ERROR_LIMIT],
  );
}

/** Every external and internal check this hour (each one isolated: one failure never stops the rest). */
export async function probeAll(env: ProbeEnv, now: Date, fetchImpl: Fetch = fetch): Promise<CheckResult[]> {
  const app = env.APP_URL.replace(/\/$/, '');
  const events = (env.EVENTS_URL || 'https://events.patternchess.com').replace(/\/$/, '');
  return Promise.all([
    probe('app-health', async () => {
      const res = await get(fetchImpl, `${app}/api/rpc/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: app },
        body: '{}',
      });
      const body = (await res.json()) as { data?: { ok?: boolean; db?: boolean } };
      if (!body.data?.ok) throw new Error('health RPC did not answer ok');
      if (!body.data.db) throw new Error('health RPC cannot reach D1');
    }),
    probe('opening-book', async () => {
      const res = await get(fetchImpl, `${app}/api/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: app },
        body: JSON.stringify({ fens: [STARTPOS] }),
      });
      const body = (await res.json()) as { positions?: Record<string, unknown> };
      if (!body.positions || Object.keys(body.positions).length === 0) throw new Error('book has no start position');
    }),
    probe('events-api', async () => {
      const res = await get(fetchImpl, `${events}/api/events?state=MA`);
      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) throw new Error('events API returned no data array');
    }),
    probe('lichess-api', async () => {
      const res = await reachable(fetchImpl, 'https://lichess.org/api/user/lichess');
      if (!res) return;
      const body = (await res.json()) as { id?: string };
      if (body.id !== 'lichess') throw new Error('Lichess user lookup returned an unexpected body');
    }),
    probe('chesscom-api', async () => {
      const res = await reachable(fetchImpl, 'https://api.chess.com/pub/player/hikaru');
      if (!res) return;
      const body = (await res.json()) as { username?: string };
      if (!body.username) throw new Error('Chess.com player lookup returned an unexpected body');
    }),
    probe('rpc-errors', async () => {
      const bursts = await rpcErrorBursts(env.DB, now);
      if (bursts.length > 0) {
        throw new Error(bursts.map((b) => `${b.name}: ${b.count} errors in ${b.hour}:00 UTC`).join('; '));
      }
    }),
  ]);
}

// ---------------------------------------------------------------------------
// State + email
// ---------------------------------------------------------------------------

export interface AlertNotice {
  id: string;
  event: AlertEvent;
  detail: string | null;
  failingSince: string | null;
}

/** Applies a run's results to alert_state and returns what to email about. */
export async function recordResults(db: D1Database, results: CheckResult[], now: Date): Promise<AlertNotice[]> {
  const notices: AlertNotice[] = [];
  for (const result of results) {
    const prev = await first<AlertRow>(
      db,
      'SELECT check_id, consecutive_failures, failing_since, last_alert_at, last_error FROM alert_state WHERE check_id = ?',
      [result.id],
    );
    const { row, event } = nextAlertState(prev, result, now);
    await run(
      db,
      `INSERT INTO alert_state (check_id, consecutive_failures, failing_since, last_alert_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (check_id) DO UPDATE SET consecutive_failures = excluded.consecutive_failures,
         failing_since = excluded.failing_since, last_alert_at = excluded.last_alert_at,
         last_error = excluded.last_error, updated_at = excluded.updated_at`,
      [row.check_id, row.consecutive_failures, row.failing_since, row.last_alert_at, row.last_error, now.toISOString()],
    );
    if (event) {
      notices.push({
        id: result.id,
        event,
        detail: event === 'recovered' ? null : (result.detail ?? null),
        failingSince: event === 'recovered' ? (prev?.failing_since ?? null) : row.failing_since,
      });
    }
  }
  return notices;
}

const LABEL: Record<AlertEvent, string> = { failing: 'FAILING', reminder: 'STILL FAILING', recovered: 'RECOVERED' };

/** The plain-text alert email for one run's notices (null when there's nothing to say). */
export function alertEmail(notices: AlertNotice[], now: Date): { subject: string; text: string; html: string } | null {
  if (notices.length === 0) return null;
  const failing = notices.filter((n) => n.event !== 'recovered');
  const subject = failing.length
    ? `[PatternChess] ${failing.map((n) => n.id).join(', ')} ${failing.length === 1 ? 'is' : 'are'} failing`
    : `[PatternChess] recovered: ${notices.map((n) => n.id).join(', ')}`;
  const lines = notices.map((n) => {
    const since = n.failingSince ? ` (since ${n.failingSince.slice(0, 16).replace('T', ' ')} UTC)` : '';
    return `${LABEL[n.event]}  ${n.id}${since}${n.detail ? `\n    ${n.detail}` : ''}`;
  });
  const text = [
    `Health checks at ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC:`,
    '',
    ...lines,
    '',
    'Checks run hourly from the notifier Worker (workers/notifier/src/alerts.ts).',
  ].join('\n');
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return { subject, text, html: `<pre style="font:13px/1.5 ui-monospace,monospace">${esc(text)}</pre>` };
}
