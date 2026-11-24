import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import { RpcError } from './core';
import { handlers, sanitizeProfilePatch } from './profile';
import { openTestD1, type TestD1 } from './testD1';

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

const alice: SessionUser = { id: 'u-alice', email: 'alice@example.com', name: 'Alice', image: null, provider: 'google' };
const bob: SessionUser = { id: 'u-bob', email: 'bob@example.com', name: 'Bob', image: null, provider: 'google' };
const lich: SessionUser = { id: 'u-lich', email: null, name: 'KnightRider', image: null, provider: 'lichess' };

let db: TestD1;

/** Extra env for a call (a fake NOTIFIER binding, an in-memory AUTH_KV); reset per test. */
let extraEnv: Partial<AppEnv> = {};
let pending: Promise<unknown>[] = [];

function call<T = unknown>(name: string, user: SessionUser, args: Record<string, unknown> = {}): Promise<T> {
  const ctx = {
    db,
    env: { DB: db, ...extraEnv } as unknown as AppEnv,
    user,
    request: new Request('https://x'),
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  };
  return handlers[name].handler(ctx, args) as Promise<T>;
}

function memoryKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
  } as unknown as KVNamespace;
}

function sql(q: string, ...params: unknown[]) {
  return db.sqlite.prepare(q).all(...params) as Record<string, unknown>[];
}

function addUser(id: string, email: string, name: string, createdAt = iso()) {
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, name, email, createdAt, createdAt);
}

function addProfile(id: string, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    referral_code: `code${id.slice(-4)}`,
    email_unsub_token: `tok-${id}`,
    created_at: iso(),
    ...extra,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO profiles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

beforeEach(async () => {
  extraEnv = {};
  pending = [];
  db = await openTestD1();
  addUser('u-alice', 'alice@example.com', 'Alice');
  addUser('u-bob', 'bob@example.com', 'Bob');
  addUser('u-lich', 'knightrider@lichess.invalid', 'KnightRider');
  addProfile('u-alice');
  addProfile('u-bob');
});

afterEach(() => db.close());

describe('contact email confirmation', () => {
  it('a new address mails the confirmation at once through the notifier', async () => {
    const sent: string[] = [];
    extraEnv = { NOTIFIER: { sendConfirm: async (id: string) => (sent.push(id), { sent: true }) } };
    addProfile('u-lich');
    await call('profile.update', lich, { patch: { contact_email: 'knight@example.org', email_opt_in: true } });
    await Promise.all(pending);
    expect(sent).toEqual(['u-lich']);
    // Saving the same address again sends nothing new.
    await call('profile.update', lich, { patch: { contact_email: 'knight@example.org' } });
    await Promise.all(pending);
    expect(sent).toEqual(['u-lich']);
  });

  it("refuses an address another account owns, so a Lichess sign-in doesn't make a duplicate", async () => {
    addProfile('u-lich');
    await expect(call('profile.update', lich, { patch: { contact_email: 'Bob@Example.com' } })).rejects.toMatchObject({
      status: 409,
      code: 'email_in_use',
    });
    // Another player's unconfirmed typed-in address doesn't block anyone.
    db.sqlite.prepare("UPDATE profiles SET contact_email = 'shared@example.org' WHERE id = 'u-bob'").run();
    await call('profile.update', lich, { patch: { contact_email: 'shared@example.org' } });
    db.sqlite.prepare("UPDATE profiles SET contact_email_verified_at = ? WHERE id = 'u-lich'").run(iso());
    db.sqlite.prepare("UPDATE profiles SET contact_email = NULL WHERE id = 'u-bob'").run();
    await expect(call('profile.update', bob, { patch: { contact_email: 'shared@example.org' } })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('resend is rate limited: once a minute', async () => {
    const sent: string[] = [];
    extraEnv = { AUTH_KV: memoryKv(), NOTIFIER: { sendConfirm: async (id: string) => (sent.push(id), { sent: true }) } };
    addProfile('u-lich', { contact_email: 'knight@example.org' });
    expect(await call('profile.resendConfirm', lich)).toEqual({ sent: true });
    await expect(call('profile.resendConfirm', lich)).rejects.toMatchObject({ status: 429 });
    expect(sent).toEqual(['u-lich']);
    db.sqlite.prepare("UPDATE profiles SET contact_email_verified_at = ? WHERE id = 'u-lich'").run(iso());
    expect(await call('profile.resendConfirm', lich)).toEqual({ sent: false, reason: 'already_confirmed' });
  });
});

describe('profile.update supporter plans', () => {
  it('Obsessed and goals past 20 positions need Supporter perks', async () => {
    await expect(call('profile.update', alice, { patch: { commitment_level: 'obsessed', daily_positions_goal: 30 } })).rejects.toMatchObject({
      status: 403,
    });
    await expect(call('profile.update', alice, { patch: { commitment_level: 'custom', daily_positions_goal: 21 } })).rejects.toMatchObject({
      status: 403,
    });
    await call('profile.update', alice, { patch: { commitment_level: 'custom', daily_positions_goal: 20 } });
    db.sqlite
      .prepare('INSERT INTO supporters (user_id, stripe_customer_id, status) VALUES (?, ?, ?)')
      .run('u-alice', 'cus_a', 'active');
    const row = await call<Record<string, unknown>>('profile.update', alice, {
      patch: { commitment_level: 'obsessed', daily_positions_goal: 30, daily_games_goal: 3 },
    });
    expect(row).toMatchObject({ commitment_level: 'obsessed', daily_positions_goal: 30 });
  });
});

describe('profile.update allowlist + email guard', () => {
  it('rejects columns outside the allowlist', () => {
    for (const col of ['contact_email_verified_at', 'email_unsub_token', 'shares_count', 'anon_id', 'referred_by', 'id']) {
      expect(() => sanitizeProfilePatch({ [col]: 'x' })).toThrow(RpcError);
    }
  });

  it('validates values', () => {
    expect(() => sanitizeProfilePatch({ board_theme: 'neon' })).toThrow(/board_theme/);
    expect(() => sanitizeProfilePatch({ email_hour: 24 })).toThrow(/email_hour/);
    expect(() => sanitizeProfilePatch({ daily_positions_goal: 0 })).toThrow();
    expect(() => sanitizeProfilePatch({ streak_freezes: 3 })).toThrow();
    expect(() => sanitizeProfilePatch({ preferred_time_controls: ['blitz', 'hyper'] })).toThrow();
    expect(() => sanitizeProfilePatch({ contact_email: 'not-an-email' })).toThrow();
    expect(() => sanitizeProfilePatch({ show_engine_evals: 'yes' })).toThrow();
    expect(sanitizeProfilePatch({ contact_email: '  a@b.co ', undefinedCol: undefined })).toEqual({ contact_email: 'a@b.co' });
  });

  it('writes the caller row only and returns it decoded', async () => {
    const row = await call<Record<string, unknown>>('profile.update', alice, {
      patch: { display_name: 'Al', show_engine_evals: true, preferred_time_controls: ['blitz', 'rapid'] },
    });
    expect(row).toMatchObject({ id: 'u-alice', display_name: 'Al', show_engine_evals: true, preferred_time_controls: ['blitz', 'rapid'] });
    expect(sql('SELECT display_name FROM profiles WHERE id = ?', 'u-bob')[0].display_name).toBeNull();
  });

  it('clears contact_email_verified_at when the address changes, keeps it when unchanged', async () => {
    db.sqlite
      .prepare("UPDATE profiles SET contact_email = 'old@x.io', contact_email_verified_at = ? WHERE id = 'u-alice'")
      .run(iso(DAY));
    await call('profile.update', alice, { patch: { contact_email: 'old@x.io', email_opt_in: true } });
    expect(sql("SELECT contact_email_verified_at v FROM profiles WHERE id = 'u-alice'")[0].v).not.toBeNull();
    await call('profile.update', alice, { patch: { contact_email: 'new@x.io' } });
    expect(sql("SELECT contact_email c, contact_email_verified_at v FROM profiles WHERE id = 'u-alice'")[0]).toEqual({
      c: 'new@x.io',
      v: null,
    });
    // Other columns leave the stamp alone.
    db.sqlite.prepare("UPDATE profiles SET contact_email_verified_at = ? WHERE id = 'u-alice'").run(iso());
    await call('profile.update', alice, { patch: { email_hour: 7 } });
    expect(sql("SELECT contact_email_verified_at v FROM profiles WHERE id = 'u-alice'")[0].v).not.toBeNull();
  });
});

describe('counters', () => {
  it('bump RPCs return the new value atomically', async () => {
    expect(await call('profile.bumpAppOpen', alice)).toBe(1);
    expect(await call('profile.bumpAppOpen', alice)).toBe(2);
    expect(await call('profile.incrementShares', alice)).toBe(1);
    expect(await call('profile.incrementOpeningReviews', alice)).toBe(1);
    expect(sql("SELECT app_opens FROM profiles WHERE id = 'u-bob'")[0].app_opens).toBe(0);
  });

  it('markAskPrompted stamps + counts, rejects unknown asks', async () => {
    await call('profile.markAskPrompted', alice, { ask: 'course' });
    await call('profile.markAskPrompted', alice, { ask: 'course' });
    const r = sql("SELECT course_prompt_count n, course_prompted_at t FROM profiles WHERE id = 'u-alice'")[0];
    expect(r.n).toBe(2);
    expect(typeof r.t).toBe('string');
    await expect(call('profile.markAskPrompted', alice, { ask: 'x; drop table profiles' })).rejects.toThrow(/unknown ask/);
  });

  it('markLearnChapterDone appends distinct keys ≤ 200 chars', async () => {
    expect(await call('profile.markLearnChapterDone', alice, { key: 'study/1' })).toBe(1);
    expect(await call('profile.markLearnChapterDone', alice, { key: 'study/1' })).toBe(1);
    expect(await call('profile.markLearnChapterDone', alice, { key: 'study/2' })).toBe(2);
    expect(await call('profile.markLearnChapterDone', alice, { key: 'x'.repeat(201) })).toBe(2);
    const row = await call<Record<string, unknown>>('profile.get', alice);
    expect(row.learn_chapters_done).toEqual(['study/1', 'study/2']);
  });

  it('updateStreak writes the streak and adds freezes used', async () => {
    db.sqlite.prepare("UPDATE profiles SET streak_freezes_used = 3 WHERE id = 'u-alice'").run();
    await call('profile.updateStreak', alice, {
      currentStreakDays: 8,
      longestStreakDays: 9,
      lastDrillLocalDate: '2026-11-21',
      timezone: 'America/New_York',
      streakFreezes: 1,
      freezesUsed: 2,
    });
    expect(
      sql(
        "SELECT current_streak_days c, longest_streak_days l, last_drill_local_date d, timezone tz, streak_freezes f, streak_freezes_used u FROM profiles WHERE id = 'u-alice'",
      )[0],
    ).toEqual({ c: 8, l: 9, d: '2026-11-21', tz: 'America/New_York', f: 1, u: 5 });
    // Omitted freezes stay as they are.
    await call('profile.updateStreak', alice, {
      currentStreakDays: 9,
      longestStreakDays: 9,
      lastDrillLocalDate: '2026-11-22',
      timezone: 'America/New_York',
    });
    expect(sql("SELECT streak_freezes f, streak_freezes_used u FROM profiles WHERE id = 'u-alice'")[0]).toEqual({ f: 1, u: 5 });
  });
});

describe('training totals + sessions', () => {
  it('caps each session at 120 minutes and counts distinct active days', async () => {
    const t0 = Date.parse('2026-11-01T10:00:00.000Z');
    const ins = db.sqlite.prepare(
      'INSERT INTO training_sessions (id, user_id, started_at, ended_at, local_date, blunders_correct, blunders_attempted) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const at = (ms: number) => new Date(ms).toISOString();
    ins.run('s1', 'u-alice', at(t0), at(t0 + 30.4 * 60_000), '2026-11-01', 3, 4); // 30.4
    ins.run('s2', 'u-alice', at(t0), at(t0 + 5 * 3600_000), '2026-11-01', 0, 2); // capped 120
    ins.run('s3', 'u-alice', at(t0), null, '2026-11-02', 1, 1); // unfinished
    ins.run('s4', 'u-alice', at(t0), at(t0 + 0.3 * 60_000), '2026-11-03', 2, 3); // 0.3
    ins.run('s5', 'u-bob', at(t0), at(t0 + 60 * 60_000), '2026-11-01', 9, 9);
    // positions = every session's first-attempt count, unfinished ones included (the daily goal's rule).
    expect(await call('profile.trainingTotals', alice)).toEqual({ minutes: 151, activeDays: 3, positions: 10 });
    expect(await call('profile.trainingTotals', lich)).toEqual({ minutes: 0, activeDays: 0, positions: 0 });
  });

  it('create/update/read sessions scoped to the caller', async () => {
    const s = await call<Record<string, unknown>>('sessions.create', alice, { localDate: '2026-11-22' });
    expect(s).toMatchObject({ user_id: 'u-alice', local_date: '2026-11-22', blunders_attempted: 0, ended_at: null });
    await call('sessions.update', bob, { id: s.id, patch: { blunders_correct: 99 } });
    expect(await call('sessions.hasToday', alice, { localDate: '2026-11-22' })).toBe(false);
    await call('sessions.update', alice, { id: s.id, patch: { blunders_correct: 2, ended_at: iso() } });
    expect(await call('sessions.hasToday', alice, { localDate: '2026-11-22' })).toBe(true);
    await expect(call('sessions.update', alice, { id: s.id, patch: { user_id: 'u-bob' } })).rejects.toThrow(/not writable/);
    expect(await call<unknown[]>('sessions.recent', alice, { limit: 5 })).toHaveLength(1);
    expect(await call<unknown[]>('sessions.recent', bob)).toHaveLength(0);
    expect(await call<unknown[]>('sessions.since', alice, { sinceDate: '2026-11-23' })).toHaveLength(0);
    expect(await call<unknown[]>('sessions.since', alice, { sinceDate: '2026-11-22' })).toHaveLength(1);
    await expect(call('sessions.create', alice, { localDate: 'today' })).rejects.toThrow();
  });
});

describe('referrals + signup source', () => {
  it('refuses unknown codes, null and the caller\'s own code', async () => {
    expect(await call('profile.claimReferral', alice, { code: 'nosuchcd' })).toBe(false);
    expect(await call('profile.claimReferral', alice, { code: null })).toBe(false);
    expect(await call('profile.claimReferral', alice, { code: ' CODELICE ' })).toBe(false); // own code
    expect(sql("SELECT referred_by r FROM profiles WHERE id = 'u-alice'")[0].r).toBeNull();
  });

  it('records the referrer and bumps their count', async () => {
    db.sqlite.prepare("UPDATE profiles SET referral_code = 'bobcode1' WHERE id = 'u-bob'").run();
    expect(await call('profile.claimReferral', alice, { code: '  BOBCODE1 ' })).toBe(true);
    expect(await call('profile.claimReferral', alice, { code: 'bobcode1' })).toBe(false); // already referred
    expect(sql("SELECT referred_by r FROM profiles WHERE id = 'u-alice'")[0].r).toBe('u-bob');
    expect(sql("SELECT referrals_count n FROM profiles WHERE id = 'u-bob'")[0].n).toBe(1);
  });

  it('refuses accounts older than 7 days', async () => {
    db.sqlite.prepare("UPDATE profiles SET referral_code = 'bobcode1' WHERE id = 'u-bob'").run();
    db.sqlite.prepare("UPDATE profiles SET created_at = ? WHERE id = 'u-alice'").run(iso(8 * DAY));
    expect(await call('profile.claimReferral', alice, { code: 'bobcode1' })).toBe(false);
    expect(await call('profile.claimSignupSource', alice, { source: 'events' })).toBe(false);
  });

  it('claims the signup source once, ≤ 120 chars', async () => {
    expect(await call('profile.claimSignupSource', alice, { source: 'x'.repeat(121) })).toBe(false);
    expect(await call('profile.claimSignupSource', alice, { source: 'events/event/otb' })).toBe(true);
    expect(await call('profile.claimSignupSource', alice, { source: 'other' })).toBe(false);
    expect(sql("SELECT signup_source s FROM profiles WHERE id = 'u-alice'")[0].s).toBe('events/event/otb');
  });
});

describe('profile.getOrCreate', () => {
  it('creates the missing profile (Lichess: no email, username from name) and stamps anon_id once', async () => {
    const row = await call<Record<string, unknown>>('profile.getOrCreate', lich, { anonId: 'anon-1' });
    expect(row).toMatchObject({ id: 'u-lich', lichess_username: 'KnightRider', email_opt_in: false, anon_id: 'anon-1' });
    const again = await call<Record<string, unknown>>('profile.getOrCreate', lich, { anonId: 'anon-2' });
    expect(again.anon_id).toBe('anon-1');
    const existing = await call<Record<string, unknown>>('profile.getOrCreate', alice, { anonId: null });
    expect(existing).toMatchObject({ id: 'u-alice', anon_id: null });
  });
});

describe('stats', () => {
  it('motif counts over enriched tactic rows only', async () => {
    const ins = db.sqlite.prepare(
      "INSERT INTO blunders (id, user_id, fen, kind, motifs, solution_line, move_number, side_to_move, played_move, eval_before, eval_after, eval_swing, correct_moves) VALUES (?, ?, ?, ?, ?, ?, 10, 'white', 'e4', 0, 0, 0, '[]')",
    );
    ins.run('b1', 'u-alice', 'f1', 'tactic', '["fork","pin"]', '[]');
    ins.run('b2', 'u-alice', 'f2', 'tactic', '["fork"]', '[]');
    ins.run('b3', 'u-alice', 'f3', 'tactic', '["skewer"]', null); // untagged: motifs ignored
    ins.run('b4', 'u-alice', 'f4', 'endgame', '["fork"]', '[]'); // not a tactic
    ins.run('b5', 'u-bob', 'f5', 'tactic', '["fork"]', '[]');
    expect(await call('stats.motifCounts', alice)).toEqual({
      counts: { fork: 2, pin: 1 },
      tagged: 2,
      untagged: 1,
      total: 3,
    });
    expect(await call('stats.motifCounts', lich)).toEqual({ counts: {}, tagged: 0, untagged: 0, total: 0 });

    const page1 = await call<{ id: string; last_drill_failed: unknown }[]>('stats.blunderRows', alice, { limit: 2 });
    expect(page1.map((r) => r.id)).toEqual(['b1', 'b2']);
    const page2 = await call<{ id: string }[]>('stats.blunderRows', alice, { afterId: 'b2', limit: 2 });
    expect(page2.map((r) => r.id)).toEqual(['b3', 'b4']);
    expect(await call<unknown[]>('stats.blunderRows', alice, { afterId: 'b4', limit: 2 })).toEqual([]);
  });
});

describe('supporters', () => {
  it('reads only the caller row', async () => {
    const ins = db.sqlite.prepare(
      'INSERT INTO supporters (user_id, stripe_customer_id, status, first_supported_at, cancel_at_period_end) VALUES (?, ?, ?, ?, ?)',
    );
    ins.run('u-bob', 'cus_b', 'active', '2026-11-01T00:00:00.000Z', 1);
    expect(await call('supporters.mine', alice)).toBeNull();
    expect(await call('supporters.mine', bob)).toEqual({
      status: 'active',
      current_period_end: null,
      cancel_at_period_end: true,
      first_supported_at: '2026-11-01T00:00:00.000Z',
      grant_ends_at: null,
      comp_ends_at: null,
    });
  });
});

describe('claimAnonymousData', () => {
  it('claims ownerless games by username and their blunders', async () => {
    db.sqlite.exec(`
      INSERT INTO games (id, user_id, platform, external_game_id, username, opponent, pgn) VALUES
        ('g1', NULL, 'lichess', 'x1', 'knightrider', 'o', ''),
        ('g2', NULL, 'lichess', 'x2', 'someoneelse', 'o', ''),
        ('g3', 'u-bob', 'lichess', 'x3', 'knightrider', 'o', '');
      INSERT INTO blunders (id, user_id, game_id, fen, kind, move_number, side_to_move, played_move, eval_before, eval_after, eval_swing, correct_moves)
        VALUES ('b1', NULL, 'g1', 'f', 'tactic', 1, 'white', 'e4', 0, 0, 0, '[]');
    `);
    await call('profile.claimAnonymousData', alice, { username: 'knightrider' });
    expect(sql('SELECT id, user_id FROM games ORDER BY id')).toEqual([
      { id: 'g1', user_id: 'u-alice' },
      { id: 'g2', user_id: null },
      { id: 'g3', user_id: 'u-bob' },
    ]);
    expect(sql("SELECT user_id FROM blunders WHERE id = 'b1'")[0].user_id).toBe('u-alice');
  });
});
