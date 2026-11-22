import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import {
  __test,
  computeOutreach,
  computeRetention,
  filterUserList,
  handlers,
  mondayOf,
  percentileCont,
  type FunnelUser,
} from './admin';
import { openTestD1, type TestD1 } from './testD1';

describe('pure helpers', () => {
  it('percentileCont interpolates like Postgres', () => {
    expect(percentileCont([], 0.5)).toBe(0);
    expect(percentileCont([5], 0.5)).toBe(5);
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([9, 1, 5], 0.5)).toBe(5);
  });
  it('mondayOf', () => {
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });
});

describe('computeRetention', () => {
  it('builds cohort curves and weekly actives', () => {
    const r = computeRetention({
      today: '2026-11-22',
      users: [
        { id: 'a', signup: '2026-10-01' },
        { id: 'b', signup: '2026-10-20' },
        { id: 'c', signup: '2026-11-21' },
      ],
      active: [
        { user_id: 'a', d: '2026-10-01' },
        { user_id: 'a', d: '2026-10-09' },
        { user_id: 'b', d: '2026-10-20' },
        { user_id: 'b', d: '2026-11-17' },
        { user_id: 'zz', d: '2026-11-17' }, // no profile: ignored in weeks
      ],
    });
    expect(r.cohorts.map((c) => c.cohort)).toEqual(['all', '2026-11', '2026-10']);
    const all = r.cohorts[0];
    expect(all).toMatchObject({ signups: 3, trained: 2, trained2Days: 2, trained5Days: 0 });
    // day 7: eligible a, b (c signed up yesterday); a last active day 8, b day 28 → both retained.
    expect(all.curve.find((p) => p.day === 7)).toEqual({ day: 7, eligible: 2, retained: 2 });
    // day 30: eligible a and b (b signed up 33 days ago); last active on day 8 and day 28, so neither is retained.
    expect(all.curve.find((p) => p.day === 30)).toEqual({ day: 30, eligible: 2, retained: 0 });
    expect(all.curve.find((p) => p.day === 60)).toEqual({ day: 60, eligible: 0, retained: 0 });
    expect(r.weeks).toEqual([
      { week: '2026-09-28', active: 1, returning: 0 },
      { week: '2026-10-05', active: 1, returning: 1 },
      { week: '2026-10-19', active: 1, returning: 0 },
      { week: '2026-11-16', active: 1, returning: 1 },
    ]);
  });
});

const fu = (p: Partial<FunnelUser> & { id: string }): FunnelUser => ({
  email: null,
  displayName: null,
  lichessUsername: null,
  chesscomUsername: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  connected: false,
  synced: false,
  foundBlunders: false,
  openedTraining: false,
  trained: false,
  games: 0,
  blunders: 0,
  trainingSessions: 0,
  lastSessionAt: null,
  lastActive: null,
  ...p,
});

describe('filterUserList', () => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  const users = [
    fu({ id: 'a', trained: true, trainingSessions: 3, lastSessionAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-03-01T00:00:00.000Z' }),
    fu({ id: 'b', trained: true, trainingSessions: 9, lastActive: '2026-11-22T06:00:00.000Z' }),
    fu({ id: 'c', synced: true, lastActive: '2026-11-20T00:00:00.000Z', createdAt: '2026-05-01T00:00:00.000Z' }),
    fu({ id: 'd', createdAt: '2026-06-01T00:00:00.000Z' }),
  ];
  it('orders trained by sessions, activity tiles by last activity, else newest', () => {
    expect(filterUserList(users, 'trained', now).map((u) => u.id)).toEqual(['b', 'a']);
    expect(filterUserList(users, 'dau', now).map((u) => u.id)).toEqual(['b']);
    expect(filterUserList(users, 'wau', now).map((u) => u.id)).toEqual(['b', 'c']);
    expect(filterUserList(users, 'signups', now).map((u) => u.id)).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('computeOutreach', () => {
  const input = {
    profiles: [
      { id: 'p1', created_at: '2026-11-01T00:00:00.000Z', anon_id: 'anon1', lichess_username: 'Alice', chesscom_username: null, email: 'a@x.com', has_games: false, trained: false, blunders: 0 },
      { id: 'p2', created_at: '2026-11-02T00:00:00.000Z', anon_id: null, lichess_username: null, chesscom_username: null, email: 'b@x.com', has_games: false, trained: false, blunders: 0 },
      { id: 'p3', created_at: '2026-11-03T00:00:00.000Z', anon_id: null, lichess_username: null, chesscom_username: 'Carl', email: null, has_games: true, trained: false, blunders: 4 },
      { id: 'p4', created_at: '2026-11-04T00:00:00.000Z', anon_id: null, lichess_username: 'dan', chesscom_username: null, email: null, has_games: true, trained: true, blunders: 9 },
    ],
    demoEvents: [
      { anon_id: 'x1', platform: 'lichess', username: 'Zed', created_at: '2026-11-05T00:00:00.000Z' },
      { anon_id: 'x2', platform: 'lichess', username: 'zed', created_at: '2026-11-06T00:00:00.000Z' },
      { anon_id: 'anon1', platform: 'lichess', username: 'other', created_at: '2026-11-07T00:00:00.000Z' }, // converted
      { anon_id: 'x3', platform: 'lichess', username: 'ALICE', created_at: '2026-11-08T00:00:00.000Z' }, // signed up handle
      { anon_id: 'x4', platform: 'chesscom', username: 'yan', created_at: '2026-11-09T00:00:00.000Z' },
    ],
    outreach: [
      { lead_key: 'chesscom:yan', segment: 'demo_only', contacted_at: '2026-11-10T00:00:00.000Z', note: 'hi' },
      { lead_key: 'user:p2', segment: 'signed_up_not_connected', contacted_at: '2026-11-11T00:00:00.000Z', note: null },
    ],
    sessionStarts: new Map([['p2', ['2026-11-12T00:00:00.000Z']]]),
  };
  it('segments leads and counts the uncontacted ones', () => {
    const r = computeOutreach('demo_only', input);
    expect(r.counts).toEqual({
      demo_only: 1, // zed (yan is contacted)
      signed_up_not_connected: 0,
      connected_no_games: 1,
      synced_never_trained: 1,
      contacted: 2,
    });
    expect(r.rows.map((x) => [x.leadKey, x.username, x.attempts, x.contactedAt !== null])).toEqual([
      ['lichess:zed', 'zed', 2, false],
      ['chesscom:yan', 'yan', 1, true],
    ]);
    expect(r.rows[0]).toMatchObject({ since: '2026-11-05T00:00:00.000Z', lastSeen: '2026-11-06T00:00:00.000Z', signedUp: false });
  });
  it('lists contacted leads with sign-up and training since contact', () => {
    const r = computeOutreach('contacted', input);
    expect(r.rows).toEqual([
      { leadKey: 'user:p2', platform: 'user', username: null, email: 'b@x.com', since: null, lastSeen: null, attempts: null, blunders: 0, contactedAt: '2026-11-11T00:00:00.000Z', note: null, signedUp: true, trainedSinceContact: true },
      { leadKey: 'chesscom:yan', platform: 'chesscom', username: 'yan', email: null, since: null, lastSeen: null, attempts: null, blunders: null, contactedAt: '2026-11-10T00:00:00.000Z', note: 'hi', signedUp: false, trainedSinceContact: false },
    ]);
  });
});

// --- handlers against the real D1 schema --------------------------------------

let db: TestD1;
const admin: SessionUser = { id: 'admin', email: 'elliotmharris@gmail.com', name: 'E', image: null, provider: 'google' };
const ctx = () => ({ db, env: {}, user: admin, request: new Request('https://x/api/rpc/x'), waitUntil: () => {} });

function addUser(id: string, email: string, p: Record<string, unknown> = {}) {
  db.sqlite
    .prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`)
    .run(id, id, email, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  const row: Record<string, unknown> = { id, created_at: '2026-01-01T00:00:00.000Z', referral_code: id.padEnd(8, 'x'), ...p };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO profiles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

beforeEach(async () => {
  db = await openTestD1();
});
afterEach(() => db.close());

describe('admin handlers (SQLite)', () => {
  it('kpis: funnel excludes the owner, emails hide the Lichess placeholder', async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    addUser('admin', 'elliotmharris@gmail.com');
    addUser('u1', 'one@example.com', { chesscom_username: 'one' });
    addUser('u2', 'lich@lichess.invalid', { lichess_username: 'lich' });
    db.sqlite
      .prepare(
        `INSERT INTO training_sessions (id, user_id, started_at, ended_at, local_date, blunders_attempted) VALUES
         ('s1', 'u1', ?, ?, '2026-11-22', 3), ('s2', 'admin', ?, NULL, '2026-11-22', 1)`,
      )
      .run(recent, new Date(Date.parse(recent) + 600_000).toISOString(), recent);
    db.sqlite
      .prepare(
        `INSERT INTO funnel_events (id, anon_id, type, user_agent, created_at) VALUES
         ('e1', 'h1', 'landing_view', 'Mozilla/5.0', '2026-11-20T00:00:00.000Z'),
         ('e2', 'h1', 'landing_view', NULL, '2026-11-21T00:00:00.000Z'),
         ('e3', 'b1', 'landing_view', 'Googlebot/2.1', '2026-11-21T00:00:00.000Z')`,
      )
      .run();
    const k = (await handlers['admin.kpis'].handler(ctx(), {})) as Awaited<ReturnType<typeof __test.adminKpis>>;
    expect(k.totals).toEqual({ signups: 2, connected: 2, synced: 0, foundBlunders: 0, openedTraining: 1, trained: 1 });
    expect(k.activity).toEqual({ dau: 2, wau: 2, mau: 2 });
    expect(k.landingFunnel).toEqual({ views: 1, entered: 0, converted: 0 });
    expect(k.viewsByDay).toEqual([
      { date: '2026-11-20', count: 1 },
      { date: '2026-11-21', count: 1 },
    ]);
    expect(k.trainingAnalytics.medianDurationSeconds).toBe(600);
    expect(k.recentSignups.map((r) => r.email).sort()).toEqual([null, 'one@example.com']);
    expect(k.trainingAnalytics.topTrainees).toHaveLength(2);
  });

  it('userList validates the category', async () => {
    await expect(handlers['admin.userList'].handler(ctx(), { category: 'nope' })).rejects.toMatchObject({ status: 400 });
    addUser('u1', 'one@example.com');
    const rows = (await handlers['admin.userList'].handler(ctx(), { category: 'signups' })) as { email: string }[];
    expect(rows.map((r) => r.email)).toEqual(['one@example.com']);
  });

  it('mark / unmark contacted round-trips and keeps the first note', async () => {
    await handlers['admin.markContacted'].handler(ctx(), { leadKey: 'lichess:zed', segment: 'demo_only', note: 'first' });
    await handlers['admin.markContacted'].handler(ctx(), { leadKey: 'lichess:zed', segment: 'demo_only', note: '' });
    const row = db.sqlite.prepare(`SELECT note FROM lead_outreach WHERE lead_key = 'lichess:zed'`).get() as { note: string };
    expect(row.note).toBe('first');
    const leads = (await handlers['admin.outreachLeads'].handler(ctx(), { segment: 'contacted' })) as { rows: unknown[] };
    expect(leads.rows).toHaveLength(1);
    await handlers['admin.unmarkContacted'].handler(ctx(), { leadKey: 'lichess:zed' });
    expect(db.sqlite.prepare(`SELECT count(*) AS n FROM lead_outreach`).get()).toEqual({ n: 0 });
  });

  it('funnel.track inserts a validated event; landingCtas groups by source', async () => {
    const req = new Request('https://x/api/rpc/funnel.track', { headers: { 'user-agent': 'UA-from-header' } });
    const pctx = { ...ctx(), user: null, request: req };
    await expect(handlers['funnel.track'].handler(pctx, { type: 'evil', anon_id: 'a' })).rejects.toMatchObject({ status: 400 });
    await expect(handlers['funnel.track'].handler(pctx, { type: 'cta_click' })).rejects.toMatchObject({ status: 400 });
    await handlers['funnel.track'].handler(pctx, { type: 'cta_click', anon_id: 'a1', source: 'hero' });
    await handlers['funnel.track'].handler(pctx, { type: 'cta_click', anon_id: 'a1', source: 'hero' });
    await handlers['funnel.track'].handler(pctx, { type: 'lead_return', anon_id: 'a2' });
    const ev = db.sqlite.prepare(`SELECT user_agent FROM funnel_events LIMIT 1`).get() as { user_agent: string };
    expect(ev.user_agent).toBe('UA-from-header');
    const ctas = await handlers['admin.landingCtas'].handler(ctx(), { days: 30 });
    expect(ctas).toEqual([
      { type: 'cta_click', source: 'hero', events: 2, visitors: 1 },
      { type: 'lead_return', source: '(none)', events: 1, visitors: 1 },
    ]);
  });

  it('emailStats and supporters', async () => {
    addUser('u1', 'one@example.com', { email_opt_in: 1, created_at: '2026-01-01T00:00:00.000Z' });
    addUser('u2', 'l@lichess.invalid', { email_opt_in: 1 });
    db.sqlite
      .prepare(
        `INSERT INTO supporters (user_id, stripe_customer_id, status, first_supported_at, cancel_at_period_end)
         VALUES ('u2', 'cus_1', 'active', '2026-11-01T00:00:00.000Z', 1)`,
      )
      .run();
    const s = (await handlers['admin.emailStats'].handler(ctx(), {})) as Record<string, unknown>;
    expect(s).toMatchObject({ optedIn: 2, reachable: 1, noAddress: 1, unsubscribed30d: 0, kinds: [] });
    const sup = await handlers['admin.supporters'].handler(ctx(), {});
    expect(sup).toEqual([
      {
        user_id: 'u2',
        label: 'Player',
        email: null,
        status: 'active',
        first_supported_at: '2026-11-01T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: true,
        beta_invited_at: null,
      },
    ]);
  });
});
