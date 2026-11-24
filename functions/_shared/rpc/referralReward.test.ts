import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '../auth';
import type { AppEnv } from '../db';
import {
  GRANT_STACK_MAX_MONTHS,
  REFERRAL_REWARD_POSITIONS,
  addMonthsIso,
  grantReferralReward,
  hasSupporterPerks,
  maybeGrantReferralReward,
} from '../supporterGrants';
import { decodeRow } from '../schema';
import { handlers as profileHandlers } from './profile';
import { __test as leaderboardTest } from './leaderboard';
import { RpcError } from './core';
import { openTestD1, type TestD1 } from './testD1';
import { defaultAvatar } from '../../../src/lib/avatar';

const DAY = 86_400_000;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

const user = (id: string): SessionUser => ({ id, email: `${id}@example.com`, name: id, image: null, provider: 'google' });
const alice = user('u-alice'); // the referrer
const bob = user('u-bob'); // a friend

let db: TestD1;

function call<T = unknown>(name: string, u: SessionUser, args: Record<string, unknown> = {}): Promise<T> {
  const ctx = { db, env: { DB: db } as unknown as AppEnv, user: u, request: new Request('https://x'), waitUntil: () => {} };
  return profileHandlers[name].handler(ctx, args) as Promise<T>;
}

function sql(q: string, ...params: (string | number | null)[]) {
  return db.sqlite.prepare(q).all(...params) as Record<string, unknown>[];
}

function addAccount(id: string, extra: Record<string, unknown> = {}) {
  const now = iso();
  db.sqlite
    .prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, id, `${id}@example.com`, now, now);
  const row: Record<string, unknown> = {
    id,
    referral_code: `rc-${id}`,
    email_unsub_token: `tok-${id}`,
    created_at: now,
    ...extra,
  };
  const cols = Object.keys(row);
  db.sqlite
    .prepare(`INSERT INTO profiles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] as string | number | null));
}

/** A finished session row with `attempted` first attempts (what sessions.update writes). */
async function train(u: SessionUser, attempted: number) {
  const s = await call<{ id: string }>('sessions.create', u, { localDate: '2026-11-22' });
  await call('sessions.update', u, { id: s.id, patch: { blunders_attempted: attempted, blunders_correct: attempted } });
}

async function referBy(friend: SessionUser, referrer: SessionUser) {
  const code = sql('SELECT referral_code c FROM profiles WHERE id = ?', referrer.id)[0].c as string;
  return call<boolean>('profile.claimReferral', friend, { code });
}

const grants = (userId: string) =>
  sql('SELECT referee_id, starts_at, ends_at FROM supporter_grants WHERE user_id = ? ORDER BY starts_at', userId);

beforeEach(async () => {
  db = await openTestD1();
  addAccount('u-alice');
  addAccount('u-bob');
});

afterEach(() => db.close());

describe('addMonthsIso', () => {
  it('adds calendar months and clamps to the month end', () => {
    expect(addMonthsIso('2026-01-31T10:00:00.000Z', 1)).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonthsIso('2026-11-22T00:00:00.000Z', 3)).toBe('2027-02-22T00:00:00.000Z');
    expect(addMonthsIso('2026-11-22T00:00:00.000Z', 12)).toBe('2027-11-22T00:00:00.000Z');
  });
});

describe('referral reward (supporter_grants)', () => {
  it('grants the referrer 3 months once the friend trains 20 first-attempt positions', async () => {
    expect(await referBy(bob, alice)).toBe(true);
    await train(bob, REFERRAL_REWARD_POSITIONS - 1);
    expect(grants('u-alice')).toHaveLength(0);
    expect(await hasSupporterPerks(db, 'u-alice')).toBe(false);

    await train(bob, 1); // cumulative 20 across sessions
    const g = grants('u-alice');
    expect(g).toHaveLength(1);
    expect(g[0].referee_id).toBe('u-bob');
    expect(g[0].ends_at).toBe(addMonthsIso(g[0].starts_at as string, 3));
    expect(await hasSupporterPerks(db, 'u-alice')).toBe(true);
    // The friend gets nothing from it.
    expect(grants('u-bob')).toHaveLength(0);
    expect(await hasSupporterPerks(db, 'u-bob')).toBe(false);
  });

  it('is idempotent per friend', async () => {
    await referBy(bob, alice);
    await train(bob, 25);
    await train(bob, 30);
    expect(await maybeGrantReferralReward(db, 'u-bob')).toBeNull();
    expect(await grantReferralReward(db, 'u-alice', 'u-bob')).toBeNull(); // unique (source, referee_id)
    expect(grants('u-alice')).toHaveLength(1);
  });

  it('never grants without a referral (training alone earns nothing)', async () => {
    await train(bob, 100);
    expect(sql('SELECT count(*) n FROM supporter_grants')[0].n).toBe(0);
  });

  it('never grants a self-referral', async () => {
    expect(await referBy(alice, alice)).toBe(false);
    await train(alice, 50);
    expect(await grantReferralReward(db, 'u-alice', 'u-alice')).toBeNull();
    expect(sql('SELECT count(*) n FROM supporter_grants')[0].n).toBe(0);
  });

  it('keeps the 7-day rule: an account older than a week cannot be claimed, so it never earns a grant', async () => {
    db.sqlite.prepare('UPDATE profiles SET created_at = ? WHERE id = ?').run(iso(8 * DAY), 'u-bob');
    expect(await referBy(bob, alice)).toBe(false);
    await train(bob, 50);
    expect(grants('u-alice')).toHaveLength(0);
  });

  it('stacks back to back and caps at 12 months ahead', async () => {
    const friends = ['u-f1', 'u-f2', 'u-f3', 'u-f4', 'u-f5', 'u-f6'].map((id) => {
      addAccount(id);
      return user(id);
    });
    for (const f of friends) {
      expect(await referBy(f, alice)).toBe(true);
      await train(f, REFERRAL_REWARD_POSITIONS);
    }
    const g = grants('u-alice');
    expect(g).toHaveLength(6); // every friend's reward is used, none can be replayed
    for (let i = 1; i < g.length; i++) expect(g[i].starts_at).toBe(g[i - 1].ends_at); // contiguous
    const last = g[g.length - 1].ends_at as string;
    expect(last <= addMonthsIso(new Date().toISOString(), GRANT_STACK_MAX_MONTHS)).toBe(true);
    // Four 3-month grants fill the year; the fifth and sixth add (next to) nothing.
    expect(g[3].ends_at).toBe(addMonthsIso(g[0].starts_at as string, GRANT_STACK_MAX_MONTHS));
    const len = (r: Record<string, unknown>) => Date.parse(r.ends_at as string) - Date.parse(r.starts_at as string);
    expect(len(g[4])).toBeLessThan(60_000);
    expect(len(g[5])).toBeLessThan(60_000);
  });

  it('expired grants carry no perks; a new one starts from now', async () => {
    const old = iso(200 * DAY);
    db.sqlite
      .prepare(
        "INSERT INTO supporter_grants (id, user_id, source, referee_id, starts_at, ends_at) VALUES ('g-old', 'u-alice', 'referral', NULL, ?, ?)",
      )
      .run(old, iso(100 * DAY));
    expect(await hasSupporterPerks(db, 'u-alice')).toBe(false);
    expect(await call('supporters.mine', alice)).toBeNull();
    await referBy(bob, alice);
    await train(bob, 20);
    const fresh = grants('u-alice').find((r) => r.referee_id === 'u-bob');
    expect(Date.parse(fresh!.starts_at as string)).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('perks from grants', () => {
  beforeEach(async () => {
    await referBy(bob, alice);
    await train(bob, 20);
  });

  it('supporters.mine reports the grant end with no Stripe row', async () => {
    const mine = await call<Record<string, unknown>>('supporters.mine', alice);
    expect(mine).toMatchObject({ status: 'none', first_supported_at: null });
    expect(typeof mine.grant_ends_at).toBe('string');
    expect(await call('supporters.mine', bob)).toBeNull();
  });

  it('keeps the Stripe row alongside the grant', async () => {
    db.sqlite
      .prepare("INSERT INTO supporters (user_id, stripe_customer_id, status, first_supported_at) VALUES ('u-alice', 'cus_1', 'canceled', ?)")
      .run(iso(DAY));
    const mine = await call<Record<string, unknown>>('supporters.mine', alice);
    expect(mine.status).toBe('canceled');
    expect(mine.first_supported_at).not.toBeNull();
    expect(mine.grant_ends_at).not.toBeNull();
  });

  it('referral.summary counts rewards', async () => {
    expect(await call('referral.summary', alice)).toMatchObject({ rewardsEarned: 1, positionsNeeded: 20 });
    expect(await call('referral.summary', bob)).toMatchObject({ rewardsEarned: 0, perksUntil: null });
  });

  it('shows the supporter mark on the leaderboard', async () => {
    db.sqlite.prepare("UPDATE profiles SET lichess_username = 'alicechess' WHERE id = 'u-alice'").run();
    db.sqlite.prepare("UPDATE blunders SET times_correct = 0").run();
    db.sqlite
      .prepare(
        "INSERT INTO blunders (id, user_id, fen, kind, move_number, side_to_move, played_move, eval_before, eval_after, eval_swing, correct_moves, times_correct) VALUES ('b1', 'u-alice', 'f', 'tactic', 1, 'white', 'e4', 0, 0, 0, '[]', 3)",
      )
      .run();
    const board = await leaderboardTest.leaderboard(db, 'u-bob', 'solved', 'all', 10);
    const row = board.rows.find((r) => r.label === 'alicechess');
    expect(row?.supporter).toBe('supporter');
  });
});

describe('comp grants', () => {
  const comp = (userId: string, endsAt = '2099-12-31T00:00:00.000Z') =>
    db.sqlite
      .prepare(
        "INSERT INTO supporter_grants (id, user_id, source, referee_id, starts_at, ends_at) VALUES (?, ?, 'comp', NULL, ?, ?)",
      )
      .run(`comp-${userId}-${endsAt}`, userId, iso(DAY), endsAt);

  it('give perks and show as a comp, never as an invite reward', async () => {
    comp('u-bob');
    expect(await hasSupporterPerks(db, 'u-bob')).toBe(true);
    const mine = await call<Record<string, unknown>>('supporters.mine', bob);
    expect(mine).toMatchObject({ grant_ends_at: '2099-12-31T00:00:00.000Z', comp_ends_at: '2099-12-31T00:00:00.000Z' });
    expect(await call('referral.summary', bob)).toMatchObject({ rewardsEarned: 0, perksUntil: null });
  });

  it('keep the referral summary to referral grants when a player has both', async () => {
    comp('u-alice');
    await referBy(bob, alice);
    await train(bob, 20);
    const summary = await call<{ rewardsEarned: number; perksUntil: string | null }>('referral.summary', alice);
    expect(summary.rewardsEarned).toBe(1);
    expect(summary.perksUntil).not.toBe('2099-12-31T00:00:00.000Z');
  });

  it('report no comp end once the comp has run out', async () => {
    comp('u-bob', iso(1000));
    expect(await call('supporters.mine', bob)).toBeNull();
  });
});

describe('cosmetics on the profile', () => {
  const avatar = { ...defaultAvatar('x'), accessory: 'crown' };

  it('profile.update accepts an avatar, piece set and any theme', async () => {
    const row = await call<Record<string, unknown>>('profile.update', alice, {
      patch: { avatar, piece_set: 'chessnut', theme: 'midnight', board_theme: 'inverse' },
    });
    expect(row).toMatchObject({ avatar, piece_set: 'chessnut', theme: 'midnight', board_theme: 'inverse' });
    expect(decodeRow('profiles', sql("SELECT avatar FROM profiles WHERE id = 'u-alice'")[0])).toEqual({ avatar });
    const cleared = await call<Record<string, unknown>>('profile.update', alice, { patch: { avatar: null, piece_set: null } });
    expect(cleared).toMatchObject({ avatar: null, piece_set: null });
  });

  it('rejects bad cosmetics', async () => {
    await expect(call('profile.update', alice, { patch: { avatar: { ...avatar, hair: 'afro-galaxy' } } })).rejects.toThrow(RpcError);
    await expect(call('profile.update', alice, { patch: { avatar: { ...avatar, extra: 'x' } } })).rejects.toThrow(RpcError);
    await expect(call('profile.update', alice, { patch: { piece_set: 'merida' } })).rejects.toThrow(RpcError);
    await expect(call('profile.update', alice, { patch: { theme: 'neon' } })).rejects.toThrow(RpcError);
    // The legacy column keeps its five-value CHECK.
    await expect(call('profile.update', alice, { patch: { board_theme: 'midnight' } })).rejects.toThrow(RpcError);
  });

  it('leaderboard rows carry the stored avatar, or the id-seeded default', async () => {
    await call('profile.update', alice, { patch: { avatar, lichess_username: 'alicechess' } });
    db.sqlite.prepare("UPDATE profiles SET chesscom_username = 'bobby' WHERE id = 'u-bob'").run();
    const ins = db.sqlite.prepare(
      "INSERT INTO blunders (id, user_id, fen, kind, move_number, side_to_move, played_move, eval_before, eval_after, eval_swing, correct_moves, times_correct) VALUES (?, ?, ?, 'tactic', 1, 'white', 'e4', 0, 0, 0, '[]', ?)",
    );
    ins.run('b1', 'u-alice', 'f1', 5);
    ins.run('b2', 'u-bob', 'f2', 3);
    const board = await leaderboardTest.leaderboard(db, 'u-alice', 'solved', 'all', 10);
    expect(board.rows.find((r) => r.label === 'alicechess')?.avatar).toEqual(avatar);
    expect(board.rows.find((r) => r.label === 'bobby')?.avatar).toEqual(defaultAvatar('u-bob'));
  });
});

describe('profile.claimPathReward', () => {
  it('banks one freeze per freeze rung, once, only when reached', async () => {
    await expect(call('profile.claimPathReward', alice, { rung: 10 })).rejects.toThrow(RpcError); // no freeze at 10
    expect(await call('profile.claimPathReward', alice, { rung: 50 })).toMatchObject({ granted: false, reason: 'not_reached' });
    await train(alice, 60);
    expect(await call('profile.claimPathReward', alice, { rung: 50 })).toMatchObject({ granted: true, streakFreezes: 1 });
    expect(await call('profile.claimPathReward', alice, { rung: 50 })).toMatchObject({ granted: false, reason: 'already_claimed' });
    expect(sql("SELECT streak_freezes n, path_rewards_claimed c FROM profiles WHERE id = 'u-alice'")[0]).toEqual({
      n: 1,
      c: '[50]',
    });
  });

  it('never banks past the cap of 2', async () => {
    db.sqlite.prepare("UPDATE profiles SET streak_freezes = 2 WHERE id = 'u-alice'").run();
    await train(alice, 250);
    expect(await call('profile.claimPathReward', alice, { rung: 200 })).toMatchObject({ granted: true, streakFreezes: 2 });
  });
});
