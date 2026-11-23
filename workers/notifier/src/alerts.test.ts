import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTestD1, type TestD1 } from '../../../functions/_shared/rpc/testD1';
import {
  FAIL_THRESHOLD,
  REMINDER_MS,
  RPC_ERROR_LIMIT,
  alertEmail,
  nextAlertState,
  probeAll,
  recordResults,
  type AlertRow,
  type CheckResult,
} from './alerts';

const T0 = new Date('2026-11-23T10:00:00.000Z');
const hours = (n: number) => new Date(T0.getTime() + n * 3600_000);
const fail: CheckResult = { id: 'lichess-api', ok: false, detail: 'https://lichess.org/api/user/lichess answered 503' };
const pass: CheckResult = { id: 'lichess-api', ok: true };

describe('nextAlertState', () => {
  it('waits for FAIL_THRESHOLD failures in a row before alerting', () => {
    let row: AlertRow | null = null;
    const events: Array<string | null> = [];
    for (let i = 0; i < FAIL_THRESHOLD + 1; i++) {
      const next = nextAlertState(row, fail, hours(i));
      row = next.row;
      events.push(next.event);
    }
    expect(events).toEqual([...Array(FAIL_THRESHOLD - 1).fill(null), 'failing', null]);
    expect(row?.failing_since).toBe(T0.toISOString());
  });

  it('a pass before the threshold resets quietly', () => {
    const one = nextAlertState(null, fail, hours(0));
    expect(nextAlertState(one.row, pass, hours(1)).event).toBeNull();
  });

  it('reminds daily while failing, then says it recovered once', () => {
    let { row } = nextAlertState(null, fail, hours(0));
    ({ row } = nextAlertState(row, fail, hours(1))); // failing
    expect(nextAlertState(row, fail, hours(5)).event).toBeNull();
    const reminder = nextAlertState(row, fail, new Date(hours(1).getTime() + REMINDER_MS));
    expect(reminder.event).toBe('reminder');
    const back = nextAlertState(reminder.row, pass, hours(30));
    expect(back.event).toBe('recovered');
    expect(back.row).toMatchObject({ consecutive_failures: 0, last_alert_at: null });
    expect(nextAlertState(back.row, pass, hours(31)).event).toBeNull();
  });

  it('one-shot reporters alert on the first failure', () => {
    expect(nextAlertState(null, { id: 'social-daily', ok: false, threshold: 1 }, T0).event).toBe('failing');
  });
});

describe('alertEmail', () => {
  it('lists every transition in one email', () => {
    const e = alertEmail(
      [
        { id: 'lichess-api', event: 'failing', detail: '503', failingSince: T0.toISOString() },
        { id: 'events-api', event: 'recovered', detail: null, failingSince: T0.toISOString() },
      ],
      hours(2),
    );
    expect(e?.subject).toBe('[PatternChess] lichess-api is failing');
    expect(e?.text).toContain('FAILING  lichess-api (since 2026-11-23 10:00 UTC)\n    503');
    expect(e?.text).toContain('RECOVERED  events-api');
    expect(alertEmail([], T0)).toBeNull();
  });
});

describe('with D1', () => {
  let db: TestD1;
  beforeEach(async () => {
    db = await openTestD1();
  });
  afterEach(() => db.close());

  it('recordResults keeps state across runs', async () => {
    const D = db as unknown as D1Database;
    expect(await recordResults(D, [fail], hours(0))).toEqual([]);
    expect((await recordResults(D, [fail], hours(1))).map((n) => n.event)).toEqual(['failing']);
    expect((await recordResults(D, [pass], hours(2))).map((n) => n.event)).toEqual(['recovered']);
  });

  it('probeAll flags each broken dependency and RPC error bursts', async () => {
    db.sqlite
      .prepare('INSERT INTO rpc_errors (hour, name, count) VALUES (?, ?, ?)')
      .run(hours(0).toISOString().slice(0, 13), 'games.list', RPC_ERROR_LIMIT + 5);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/rpc/health')) return Response.json({ data: { ok: true, db: true } });
      if (url.includes('/api/book')) return Response.json({ positions: { x: {} } });
      if (url.includes('/api/events')) return new Response('down', { status: 502 });
      if (url.includes('lichess.org')) return new Response('slow down', { status: 429 });
      if (url.includes('chess.com')) return Response.json({ username: 'hikaru' });
      return new Response('?', { status: 404 });
    });
    const results = await probeAll(
      { DB: db as unknown as D1Database, APP_URL: 'https://app.test' },
      hours(0),
      fetchImpl as unknown as typeof fetch,
    );
    const failing = Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, r.detail]));
    expect(Object.keys(failing).sort()).toEqual(['events-api', 'rpc-errors']);
    expect(failing['events-api']).toContain('502');
    expect(failing['rpc-errors']).toContain('games.list: 25 errors');
    // A 429 from a third-party API means it is up (it rate-limits the Worker's shared IP).
    expect(results.find((r) => r.id === 'lichess-api')).toEqual({ id: 'lichess-api', ok: true, detail: 'rate limited (up)' });
  });
});
