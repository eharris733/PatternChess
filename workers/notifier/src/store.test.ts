import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NearbyEvent } from './events';
import { openTestD1, type TestD1 } from '../../../functions/_shared/rpc/testD1';
import {
  candidateFacts,
  confirmEmail,
  emailCandidates,
  emailOutbox,
  logSend,
  maskEmail,
  newConfirmToken,
  prefsByToken,
  reportData,
  unsubscribeByToken,
  updatePrefsByToken,
} from './store';

// The SQL half of the notifier against the real D1 schema (node:sqlite shim).

const H = 3_600_000;
const D = 24 * H;
// Sunday 2026-11-29 18:00 in New York.
const NOW = new Date('2026-11-29T23:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

let db: TestD1;
let n = 0;

function exec(sql: string, ...params: unknown[]) {
  db.sqlite.prepare(sql).run(...params);
}

function addUser(id: string, email: string, profile: Record<string, unknown> = {}) {
  exec('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)', id, id, email, ago(60 * D), ago(60 * D));
  const row: Record<string, unknown> = {
    id,
    created_at: ago(60 * D),
    display_name: 'Ada Lovelace',
    timezone: 'America/New_York',
    email_hour: 18,
    email_unsub_token: `${id.slice(0, 8)}-0000-4000-8000-000000000000`,
    referral_code: `ref${id.slice(0, 5)}`,
    ...profile,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO profiles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

function addBlunder(userId: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: `b${++n}`,
    user_id: userId,
    fen: `fen-${n}`,
    move_number: 10,
    played_move: 'e4',
    eval_before: 0,
    eval_after: -300,
    eval_swing: 300,
    side_to_move: 'white',
    kind: 'tactic',
    created_at: ago(30 * D),
    next_drill_at: ago(H),
    last_drilled_at: null,
    ...over,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO blunders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

function addSession(userId: string, startedAgo: number, minutes: number, attempted: number, correct: number, localDate: string) {
  exec(
    'INSERT INTO training_sessions (id, user_id, started_at, ended_at, local_date, blunders_attempted, blunders_correct) VALUES (?, ?, ?, ?, ?, ?, ?)',
    `s${++n}`,
    userId,
    ago(startedAgo),
    ago(startedAgo - minutes * 60_000),
    localDate,
    attempted,
    correct,
  );
}

function addGame(userId: string, playedAgo: number, rating: number, timeControl = '180+2', platform = 'lichess') {
  exec(
    `INSERT INTO games (id, user_id, platform, username, opponent, pgn, external_game_id, played_at, rated, user_rating, time_control, time_category)
     VALUES (?, ?, ?, 'me', 'them', '1. e4', ?, ?, 1, ?, ?, ?)`,
    `g${++n}`,
    userId,
    platform,
    `ext${n}`,
    ago(playedAgo),
    rating,
    timeControl,
    timeControl.startsWith('180') ? 'blitz' : 'rapid',
  );
}

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
  db = await openTestD1();
  n = 0;
});
afterEach(() => db.close());

describe('candidate facts', () => {
  it('aggregates positions, sends and unanswered reminders per player', async () => {
    addUser(U1, 'ada@example.com', { last_drill_local_date: '2026-11-20' });
    addBlunder(U1, { last_drilled_at: ago(9 * D) }); // due, trained 9 days ago
    addBlunder(U1, { next_drill_at: ago(-D) }); // not due yet
    addBlunder(U1, { kind: 'opening' }); // due, but openings don't count
    addBlunder(U1, { retired_at: ago(D) }); // retired
    addBlunder(U1, { created_at: ago(2 * H) }); // fresh
    for (const t of [8 * D, 3 * D, 2 * D]) exec("INSERT INTO email_sends (user_id, kind, to_email, sent_at) VALUES (?, 'daily_plan', 'x', ?)", U1, ago(t));
    exec("INSERT INTO email_sends (user_id, kind, to_email, sent_at) VALUES (?, 'welcome', 'x', ?)", U1, ago(50 * D));
    const [f] = await candidateFacts(db, NOW, null);
    expect(f).toMatchObject({
      id: U1,
      auth_email: 'ada@example.com',
      due_now: 2, // b1 + b5: tactic/endgame, live, due
      live_total: 4,
      last_trained: ago(9 * D),
      last_any: ago(2 * D),
      last_reminder: ago(2 * D),
      ready_sent: 0,
      welcome_sent: 1,
      unanswered: 3,
      fresh_blunders: 1,
    });
  });

  it('skips opted-out players unless asked for by id', async () => {
    addUser(U1, 'ada@example.com', { email_opt_in: 0 });
    expect(await candidateFacts(db, NOW, null)).toHaveLength(0);
    expect(await candidateFacts(db, NOW, U1)).toHaveLength(1);
  });
});

describe('outbox', () => {
  beforeEach(() => {
    exec(`INSERT INTO landing_stats_cache (id, payload) VALUES (1, '{"eloGained": 6064, "positionsReviewed": 9}')`);
  });

  it('sends the weekly report on Sunday with the report data and community Elo', async () => {
    addUser(U1, 'ada@example.com', { last_drill_local_date: '2026-11-27', current_streak_days: 3 });
    addBlunder(U1, { last_drilled_at: ago(2 * D), cycle_number: 4, motifs: '["missedFork"]', created_at: ago(3 * D) });
    addSession(U1, 2 * D, 30, 12, 10, '2026-11-27');
    const rows = await emailOutbox(db, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: U1, kind: 'weekly_report', to_email: 'ada@example.com' });
    expect(rows[0].data).toMatchObject({ firstName: 'Ada', communityElo: 6064, localToday: '2026-11-29', streak: 0 });
    expect(rows[0].data.report).toMatchObject({ solved: 10, attempted: 12, minutes: 30, newlyMastered: 1, topMotif: 'missedFork' });
  });

  it('leaves out Lichess sign-ins without an address and players with nothing due', async () => {
    addUser(U1, 'adal@lichess.invalid');
    addBlunder(U1, { last_drilled_at: ago(9 * D) });
    addUser(U2, 'bob@example.com', { email_reports: 'off' });
    addBlunder(U2, { next_drill_at: ago(-D), last_drilled_at: ago(9 * D) });
    expect(await emailOutbox(db, NOW)).toEqual([]);
    const all = await emailCandidates(db, NOW);
    expect(all.map((r) => [r.user_id, r.kind, r.to_email])).toEqual([
      [U1, null, null],
      [U2, null, 'bob@example.com'],
    ]);
  });

  it('respects the 20-hour spacing once a send is logged', async () => {
    addUser(U1, 'ada@example.com', { email_reports: 'off' });
    addBlunder(U1, { last_drilled_at: ago(9 * D) });
    expect((await emailOutbox(db, NOW))[0]?.kind).toBe('daily_plan');
    await logSend(db, { user_id: U1, kind: 'daily_plan', to_email: 'ada@example.com', provider_id: 'm1' }, new Date(NOW.getTime() - H));
    expect(await emailOutbox(db, NOW)).toEqual([]);
  });

  it('attaches the report for a single-user preview', async () => {
    addUser(U1, 'ada@example.com', { email_reports: 'off' });
    const [row] = await emailCandidates(db, NOW, U1);
    expect(row.data.report).toBeDefined();
  });
});

describe('events near you', () => {
  const LISTING: NearbyEvent[] = [{ title: 'Boylston Saturday Open', when: 'Sat, Dec 5', where: 'Boylston · Boston', url: 'https://e/1' }];

  function weeklyReader(id: string, email: string, profile: Record<string, unknown> = {}) {
    addUser(id, email, { last_drill_local_date: '2026-11-27', ...profile });
    addBlunder(id, { last_drilled_at: ago(2 * D) });
  }

  it('reads events_state from the profile', async () => {
    addUser(U1, 'ada@example.com', { events_state: 'MA' });
    addUser(U2, 'bob@example.com');
    const facts = await candidateFacts(db, NOW, null);
    expect(facts.map((f) => [f.id, f.events_state])).toEqual([
      [U1, 'MA'],
      [U2, null],
    ]);
  });

  it('loads the listing for weekly reports with a saved state, once per player, in the local day', async () => {
    weeklyReader(U1, 'ada@example.com', { events_state: 'MA' });
    weeklyReader(U2, 'bob@example.com'); // weekly report, no state
    addUser(U3, 'cy@example.com', { events_state: 'NY', email_reports: 'off' }); // daily plan, not a report
    addBlunder(U3, { last_drilled_at: ago(9 * D) });
    const loadEvents = vi.fn(async () => LISTING);
    const rows = await emailOutbox(db, NOW, { loadEvents });
    expect(rows.map((r) => [r.user_id, r.kind])).toEqual([
      [U1, 'weekly_report'],
      [U2, 'weekly_report'],
      [U3, 'daily_plan'],
    ]);
    expect(loadEvents).toHaveBeenCalledTimes(1);
    expect(loadEvents).toHaveBeenCalledWith('US-MA', '2026-11-29');
    expect(rows[0].data).toMatchObject({ eventsRegion: 'US-MA', events: LISTING });
    expect(rows[1].data.eventsRegion).toBeUndefined();
    expect(rows[2].data.eventsRegion).toBeUndefined();
  });

  it('still sends the report when the events lookup fails', async () => {
    weeklyReader(U1, 'ada@example.com', { events_state: 'MA' });
    const rows = await emailOutbox(db, NOW, { loadEvents: async () => Promise.reject(new Error('down')) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'weekly_report', data: { eventsRegion: 'US-MA', events: null } });
  });

  it('makes no lookups without a loader', async () => {
    weeklyReader(U1, 'ada@example.com', { events_state: 'MA' });
    const [row] = await emailOutbox(db, NOW);
    expect(row.data).toMatchObject({ eventsRegion: 'US-MA', events: null });
  });

  it('a saved country lists that country', async () => {
    weeklyReader(U1, 'ada@example.com', { events_country: 'GB-ENG' });
    const loadEvents = vi.fn(async () => LISTING);
    const [row] = await emailOutbox(db, NOW, { loadEvents });
    expect(loadEvents).toHaveBeenCalledWith('GB-ENG', '2026-11-29');
    expect(row.data).toMatchObject({ eventsRegion: 'GB-ENG', events: LISTING });
  });

  it('a single-user preview includes events for a saved state whatever the kind', async () => {
    addUser(U1, 'ada@example.com', { events_state: 'RI', email_reports: 'off' });
    const loadEvents = vi.fn(async () => LISTING);
    const [row] = await emailCandidates(db, NOW, U1, { loadEvents });
    expect(loadEvents).toHaveBeenCalledWith('US-RI', '2026-11-29');
    expect(row.data.events).toEqual(LISTING);
  });
});

describe('reportData', () => {
  it('counts the week: minutes capped at 120, active days, games, Elo in the main bucket, rank', async () => {
    addUser(U1, 'ada@example.com');
    addUser(U2, 'bob@example.com');
    addUser(U3, 'cy@example.com', { leaderboard_opt_out: 1 });
    addSession(U1, 6 * D, 300, 10, 8, '2026-11-23'); // capped at 120
    addSession(U1, 2 * D, 15, 5, 0, '2026-11-27'); // no correct: not an active day
    addSession(U1, 1 * D, 20, 6, 4, '2026-11-28');
    addSession(U1, 9 * D, 30, 99, 99, '2026-11-20'); // outside the week
    addSession(U2, 1 * D, 10, 30, 20, '2026-11-28'); // ahead of U1
    addSession(U3, 1 * D, 10, 90, 90, '2026-11-28'); // ahead, but opted out
    addGame(U1, 5 * D, 1500);
    addGame(U1, 3 * D, 1490);
    addGame(U1, 1 * D, 1530);
    addGame(U1, 2 * D, 1700, '900+10'); // rapid bucket, only one game
    addGame(U1, 10 * D, 1400); // before the week
    addBlunder(U1, { motifs: '["hangingPiece","missedFork"]', created_at: ago(D) });
    addBlunder(U1, { motifs: '["missedFork"]', created_at: ago(D) });
    addBlunder(U1, { motifs: '["pin"]', created_at: ago(D), kind: 'endgame' });
    const r = await reportData(db, U1, new Date(NOW.getTime() - 7 * D), NOW);
    expect(r).toEqual({
      periodDays: 7,
      attempted: 21,
      solved: 12,
      minutes: 155,
      activeDays: 2,
      newlyMastered: 0,
      gamesPlayed: 4,
      eloChange: 30,
      leaderboardRank: 2,
      topMotif: 'missedFork',
    });
  });

  it('has no rank without solves or when opted out, and no Elo change from one game', async () => {
    addUser(U1, 'ada@example.com', { leaderboard_opt_out: 1 });
    addSession(U1, D, 10, 5, 5, '2026-11-28');
    addGame(U1, D, 1500);
    const r = await reportData(db, U1, new Date(NOW.getTime() - 7 * D), NOW);
    expect(r).toMatchObject({ leaderboardRank: null, eloChange: null, topMotif: null });
  });
});

describe('token pages', () => {
  const T1 = '11111111-0000-4000-8000-000000000000';

  it('masks the address', () => {
    expect(maskEmail('ada@example.com')).toBe('a•••@example.com');
    expect(maskEmail('')).toBe('');
  });

  it('reads, updates and unsubscribes by token (case-insensitive)', async () => {
    addUser(U1, 'ada@example.com');
    expect(await prefsByToken(db, T1.toUpperCase())).toEqual({
      optIn: true,
      reminders: 'daily',
      reports: 'weekly',
      hour: 18,
      email: 'a•••@example.com',
      needsConfirm: false,
    });
    expect(await updatePrefsByToken(db, T1, { optIn: true, reminders: 'few_days', reports: 'off', hour: 7 })).toMatchObject({
      reminders: 'few_days',
      reports: 'off',
      hour: 7,
    });
    const prefs = await unsubscribeByToken(db, T1, NOW);
    expect(prefs?.optIn).toBe(false);
    expect(db.sqlite.prepare('SELECT email_unsubscribed_at AS t FROM profiles WHERE id = ?').get(U1)).toEqual({ t: NOW.toISOString() });
    expect(await prefsByToken(db, '99999999-0000-4000-8000-000000000000')).toBeNull();
  });

  it('shows no address for a Lichess sign-in', async () => {
    addUser(U1, 'adal@lichess.invalid');
    expect((await prefsByToken(db, T1))?.email).toBe('');
  });

  it('confirms a contact address with the newest link only', async () => {
    addUser(U1, 'ada@example.com', { contact_email: 'work@example.com' });
    expect((await prefsByToken(db, T1))?.needsConfirm).toBe(true);
    const old = await newConfirmToken(db, U1, 'work@example.com');
    const token = await newConfirmToken(db, U1, 'work@example.com');
    expect(await confirmEmail(db, old)).toBeNull();
    const prefs = await confirmEmail(db, token, NOW);
    expect(prefs).toMatchObject({ needsConfirm: false, email: 'w•••@example.com' });
    expect(await confirmEmail(db, token)).toBeNull();
  });

  it('does not confirm an address that changed after the link was sent', async () => {
    addUser(U1, 'ada@example.com', { contact_email: 'new@example.com' });
    const token = await newConfirmToken(db, U1, 'old@example.com');
    expect((await confirmEmail(db, token))?.needsConfirm).toBe(true);
  });
});
