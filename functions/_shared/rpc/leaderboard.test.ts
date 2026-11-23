import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __test,
  cached,
  computeLandingStats,
  computePublicLeaderboard,
  isoWeekStart,
  mainCategoryRating,
  rankByValue,
  supporterBadge,
} from './leaderboard';
import { openTestD1, type TestD1 } from './testD1';

describe('isoWeekStart', () => {
  it('returns Monday 00:00 UTC', () => {
    expect(isoWeekStart(new Date('2026-11-22T03:00:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Sunday
    expect(isoWeekStart(new Date('2026-11-16T00:00:00Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Monday
    expect(isoWeekStart(new Date('2026-11-18T23:59:59Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });
});

describe('supporterBadge', () => {
  it('mirrors supporter_badge()', () => {
    expect(supporterBadge(undefined)).toBeNull();
    expect(supporterBadge({ status: 'active', first_supported_at: '2026-01-01' })).toBe('supporter');
    expect(supporterBadge({ status: 'past_due', first_supported_at: null })).toBe('supporter');
    expect(supporterBadge({ status: 'canceled', first_supported_at: '2026-01-01' })).toBe('early');
    expect(supporterBadge({ status: 'none', first_supported_at: null })).toBeNull();
  });
});

describe('rankByValue', () => {
  it('drops non-positive values and breaks ties by user id', () => {
    const r = rankByValue([
      { user_id: 'b', value: 5 },
      { user_id: 'a', value: 5 },
      { user_id: 'c', value: 0 },
      { user_id: 'd', value: 9 },
    ]);
    expect(r.map((x) => [x.rank, x.item.user_id])).toEqual([
      [1, 'd'],
      [2, 'a'],
      [3, 'b'],
    ]);
  });
});

describe('mainCategoryRating', () => {
  it('picks the most-played category, newest rating in it', () => {
    expect(
      mainCategoryRating([
        { played_at: '2026-11-20', user_rating: 1500, category: 'blitz' },
        { played_at: '2026-11-19', user_rating: 1700, category: 'rapid' },
        { played_at: '2026-11-18', user_rating: 1690, category: 'rapid' },
        { played_at: '2026-11-17', user_rating: 1490, category: 'blitz' },
        { played_at: '2026-11-16', user_rating: 1680, category: 'rapid' },
        { played_at: '2026-11-15', user_rating: 1000, category: null },
      ]),
    ).toEqual({ category: 'rapid', rating: 1700 });
  });
  it('breaks count ties by the most recent game', () => {
    expect(
      mainCategoryRating([
        { played_at: '2026-11-20', user_rating: 1500, category: 'blitz' },
        { played_at: '2026-11-19', user_rating: 1700, category: 'rapid' },
      ]),
    ).toEqual({ category: 'blitz', rating: 1500 });
  });
  it('is null without categorised games', () => {
    expect(mainCategoryRating([{ played_at: 'x', user_rating: 1, category: null }])).toBeNull();
  });
});

// --- against the real D1 schema (node:sqlite) --------------------------------

let db: TestD1;
const NOW = new Date('2026-11-22T12:00:00.000Z'); // Sunday

function addUser(id: string, p: Record<string, unknown> = {}) {
  db.sqlite
    .prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`)
    .run(id, id, `${id}@example.com`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  const row: Record<string, unknown> = { id, created_at: '2026-01-01T00:00:00.000Z', referral_code: id.padEnd(8, 'x'), ...p };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO profiles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

let n = 0;
function addBlunder(userId: string, p: Record<string, unknown>) {
  n += 1;
  const row: Record<string, unknown> = {
    id: `b${n}`,
    user_id: userId,
    fen: `fen${n}`,
    kind: 'tactic',
    move_number: 10,
    played_move: 'e4',
    eval_before: 0,
    eval_after: -300,
    eval_swing: 300,
    side_to_move: 'white',
    ...p,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO blunders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

function addGame(userId: string, playedAt: string, rating: number, tc = '300+0', platform = 'lichess', rated = 1) {
  n += 1;
  const cat = tc.includes('/') ? 'classical' : Number(tc.split('+')[0]) < 180 ? 'bullet' : Number(tc.split('+')[0]) < 600 ? 'blitz' : 'rapid';
  db.sqlite
    .prepare(
      `INSERT INTO games (id, user_id, platform, username, opponent, pgn, time_control, time_category, rated, user_rating, played_at, external_game_id)
       VALUES (?, ?, ?, 'me', 'opp', '', ?, ?, ?, ?, ?, ?)`,
    )
    .run(`g${n}`, userId, platform, tc, cat, rated, rating, playedAt, `ext${n}`);
}

function addSession(userId: string, startedAt: string, correct: number) {
  n += 1;
  db.sqlite
    .prepare(
      `INSERT INTO training_sessions (id, user_id, started_at, local_date, blunders_attempted, blunders_correct) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`s${n}`, userId, startedAt, startedAt.slice(0, 10), correct, correct);
}

beforeEach(async () => {
  db = await openTestD1();
  n = 0;
});
afterEach(() => db.close());

describe('leaderboard (SQLite)', () => {
  it('solved: lifetime sums times_correct, week sums sessions since Monday; opt-outs excluded', async () => {
    addUser('u1', { lichess_username: 'Alpha', flair: 'f1' });
    addUser('u2', { chesscom_username: 'beta' });
    addUser('u3', { display_name: 'Gamma', leaderboard_opt_out: 1 });
    addBlunder('u1', { times_correct: 3 });
    addBlunder('u1', { times_correct: 4 });
    addBlunder('u2', { times_correct: 10 });
    addBlunder('u3', { times_correct: 50 });
    addSession('u1', '2026-11-17T10:00:00.000Z', 6);
    addSession('u2', '2026-11-15T10:00:00.000Z', 9); // before Monday
    db.sqlite.prepare(`INSERT INTO supporters (user_id, stripe_customer_id, status, first_supported_at) VALUES ('u2', 'cus', 'active', '2026-11-01T00:00:00.000Z')`).run();

    const all = await __test.leaderboard(db, 'u1', 'solved', 'all', 20, NOW);
    expect(all.since).toBeNull();
    expect(all.rows).toEqual([
      { rank: 1, label: 'beta', value: 10, isMe: false, flair: null, supporter: 'supporter', avatar: expect.any(Object) },
      { rank: 2, label: 'Alpha', value: 7, isMe: true, flair: 'f1', supporter: null, avatar: expect.any(Object) },
    ]);
    expect(all.me).toMatchObject({ rank: 2, value: 7, isMe: true });

    const week = await __test.leaderboard(db, 'u2', 'solved', 'week', 20, NOW);
    expect(week.since).toBe('2026-11-16T00:00:00.000Z');
    expect(week.rows.map((r) => [r.label, r.value])).toEqual([['Alpha', 6]]);
    expect(week.me).toBeNull();
  });

  it('mastered, openings, endgames and streak', async () => {
    addUser('u1', { lichess_username: 'a', longest_streak_days: 12, current_streak_days: 2 });
    addUser('u2', { lichess_username: 'b', longest_streak_days: 3, current_streak_days: 3 });
    addBlunder('u1', { cycle_number: 4, times_attempted: 5, times_correct: 4, last_drilled_at: '2026-11-17T00:00:00.000Z' });
    addBlunder('u1', { cycle_number: 4, times_attempted: 5, times_correct: 3 }); // 60% recall
    addBlunder('u2', { cycle_number: 5, times_attempted: 2, times_correct: 2, last_drilled_at: '2026-11-01T00:00:00.000Z' });
    addBlunder('u1', { kind: 'opening', times_correct: 2, last_drilled_at: '2026-11-18T00:00:00.000Z', last_drill_failed: 0 });
    addBlunder('u2', { kind: 'opening', times_correct: 5, last_drilled_at: '2026-11-18T00:00:00.000Z', last_drill_failed: 1 });
    addBlunder('u2', { kind: 'endgame', times_correct: 1, last_drilled_at: '2026-11-19T00:00:00.000Z', last_drill_failed: 0 });

    const m = await __test.leaderboard(db, 'u1', 'mastered', 'all', 20, NOW);
    expect(m.rows.map((r) => [r.label, r.value])).toEqual([['a', 1], ['b', 1]]);
    const mw = await __test.leaderboard(db, 'u1', 'mastered', 'week', 20, NOW);
    expect(mw.rows.map((r) => [r.label, r.value])).toEqual([['a', 1]]);

    const o = await __test.leaderboard(db, 'u1', 'openings', 'all', 20, NOW);
    expect(o.rows.map((r) => [r.label, r.value])).toEqual([['b', 5], ['a', 2]]);
    const ow = await __test.leaderboard(db, 'u1', 'openings', 'week', 20, NOW);
    expect(ow.rows.map((r) => [r.label, r.value])).toEqual([['a', 1]]);

    const e = await __test.leaderboard(db, 'u1', 'endgames', 'week', 20, NOW);
    expect(e.rows.map((r) => [r.label, r.value])).toEqual([['b', 1]]);

    const s = await __test.leaderboard(db, 'u1', 'streak', 'all', 1, NOW);
    expect(s.rows.map((r) => [r.label, r.value])).toEqual([['a', 12]]);
    expect(s.me).toMatchObject({ rank: 1 });
    const sw = await __test.leaderboard(db, 'u1', 'streak', 'week', 20, NOW);
    expect(sw.rows.map((r) => [r.label, r.value])).toEqual([['b', 3], ['a', 2]]);
  });

  it('elo: positive first→latest delta per (platform, category) series with ≥ 3 games after joining', async () => {
    addUser('u1', { lichess_username: 'a', created_at: '2026-06-01T00:00:00.000Z' });
    addGame('u1', '2026-05-01T00:00:00.000Z', 1000); // before joining: ignored
    addGame('u1', '2026-07-01T00:00:00.000Z', 1500);
    addGame('u1', '2026-08-01T00:00:00.000Z', 1450);
    addGame('u1', '2026-11-20T00:00:00.000Z', 1560); // blitz +60
    addGame('u1', '2026-07-01T00:00:00.000Z', 1800, '900+10');
    addGame('u1', '2026-08-01T00:00:00.000Z', 1700, '900+10');
    addGame('u1', '2026-09-01T00:00:00.000Z', 1650, '900+10'); // rapid −150 → 0
    addGame('u1', '2026-07-01T00:00:00.000Z', 1200, '60+0');
    addGame('u1', '2026-11-21T00:00:00.000Z', 1400, '60+0'); // bullet: only 2 games
    addGame('u1', '2026-11-21T00:00:00.000Z', 9999, '300+0', 'lichess', 0); // unrated
    const all = await __test.leaderboard(db, 'u1', 'elo', 'all', 20, NOW);
    expect(all.rows.map((r) => r.value)).toEqual([60]);
    const stats = await computeLandingStats(db, NOW);
    expect(stats.eloGained).toBe(60);
  });
});

describe('public leaderboard + landing stats (SQLite)', () => {
  it('ranks the rolling week, uses chess handles only and the main-category rating', async () => {
    addUser('u1', { lichess_username: 'Alpha', display_name: 'Real Name' });
    addUser('u2', { display_name: 'Secret Person' });
    addUser('u3', { chesscom_username: 'Cee', leaderboard_opt_out: 1 });
    addSession('u1', '2026-11-20T00:00:00.000Z', 4);
    addSession('u2', '2026-11-21T00:00:00.000Z', 7);
    addSession('u3', '2026-11-21T00:00:00.000Z', 70);
    addSession('u1', '2026-11-01T00:00:00.000Z', 99); // outside 7 days
    addGame('u1', '2026-11-10T00:00:00.000Z', 1500, '300+0');
    addGame('u1', '2026-11-11T00:00:00.000Z', 1510, '300+0');
    addGame('u1', '2026-11-12T00:00:00.000Z', 1800, '900+0');
    addGame('u1', '2026-11-13T00:00:00.000Z', 2000, '1/86400'); // daily: no category
    const p = await computePublicLeaderboard(db, NOW);
    expect(p.since).toBe('2026-11-15T12:00:00.000Z');
    expect(p.rows).toEqual([
      { rank: 1, label: 'Player', platform: null, rating: null, ratingCategory: null, value: 7, flair: null, supporter: null },
      { rank: 2, label: 'Alpha', platform: 'lichess', rating: 1510, ratingCategory: 'blitz', value: 4, flair: null, supporter: null },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/Secret|Real Name|u1|u2|example\.com/);
  });

  it('landing stats sum times_correct and cache for 6 hours', async () => {
    addUser('u1');
    addBlunder('u1', { times_correct: 5 });
    addBlunder('u1', { times_correct: 2 });
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return computeLandingStats(db, NOW);
    };
    const a = await cached(db, 'landing_stats_cache', 6 * 3600_000, compute);
    expect(a).toMatchObject({ positionsReviewed: 7, eloGained: 0 });
    addBlunder('u1', { times_correct: 100 });
    const b = await cached(db, 'landing_stats_cache', 6 * 3600_000, compute);
    expect(b.positionsReviewed).toBe(7);
    expect(calls).toBe(1);
    // Expired → recomputed.
    const c = await cached(db, 'landing_stats_cache', 6 * 3600_000, compute, new Date(Date.now() + 7 * 3600_000));
    expect(c.positionsReviewed).toBe(107);
    expect(calls).toBe(2);
  });
});
