import { all, first, insertStmt, nowIso, scalar, uuid } from './db';

/**
 * Supporter perks given without Stripe (D1 `supporter_grants`, migrations
 * 0005 + 0010). Two sources: `comp` rows are perks given by hand (the owner,
 * friends, testers; inserted with `wrangler d1 execute`, referee_id NULL), and
 * the referral reward: when a friend who
 * joined through your invite link trains their first
 * `REFERRAL_REWARD_POSITIONS` positions (first attempts, the same count as the
 * daily goal: sum of `training_sessions.blunders_attempted`), you get
 * `REFERRAL_GRANT_MONTHS` of Supporter perks. Grants run back to back and
 * never reach more than `GRANT_STACK_MAX_MONTHS` past today.
 *
 * Abuse rules: never on a self-referral (claimReferral already refuses it and
 * the grant re-checks), only friends whose account was under 7 days old when
 * they claimed the code (claimReferral's rule, so `referred_by` is only ever
 * set that way), and one grant per friend (unique `(source, referee_id)`).
 *
 * The perk rule everywhere (useSupporter via supporters.mine, the articles
 * endpoint, leaderboard badges) is "an active Stripe subscription OR an
 * active grant" — see hasSupporterPerks. No Stripe import here, so RPC
 * modules can use it without pulling in the SDK.
 */

export const REFERRAL_REWARD_POSITIONS = 20;
export const REFERRAL_GRANT_MONTHS = 3;
export const GRANT_STACK_MAX_MONTHS = 12;

/** Statuses that carry the perks (same list as supporters.ts PERK_STATUSES). */
const PERK_STATUS_LIST = ['active', 'trialing', 'past_due'];

/** ISO timestamp `months` calendar months after `iso` (UTC; clamps to the month's last day). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export type GrantSource = 'referral' | 'comp';

/**
 * End of the player's current run of grants (the latest `ends_at` still
 * ahead), or null when none is running now. `source` narrows it to one kind.
 */
export async function grantPerksUntil(
  db: D1Database,
  userId: string,
  now = nowIso(),
  source?: GrantSource,
): Promise<string | null> {
  const bySource = source ? ' AND source = ?' : '';
  const extra = source ? [source] : [];
  const active = await scalar<number>(
    db,
    `SELECT 1 FROM supporter_grants WHERE user_id = ? AND starts_at <= ? AND ends_at > ?${bySource} LIMIT 1`,
    [userId, now, now, ...extra],
  );
  if (active !== 1) return null;
  return scalar<string>(db, `SELECT max(ends_at) FROM supporter_grants WHERE user_id = ? AND ends_at > ?${bySource}`, [
    userId,
    now,
    ...extra,
  ]);
}

/** Users (of `userIds`) with a grant running at `now`. */
export async function usersWithActiveGrant(
  db: D1Database,
  userIds: readonly string[],
  now = nowIso(),
): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 90) {
    const group = ids.slice(i, i + 90);
    const rows = await all<{ user_id: string }>(
      db,
      `SELECT DISTINCT user_id FROM supporter_grants
        WHERE user_id IN (${group.map(() => '?').join(', ')}) AND starts_at <= ? AND ends_at > ?`,
      [...group, now, now],
    );
    for (const r of rows) out.add(r.user_id);
  }
  return out;
}

/** The server-side perk check: a Stripe subscription in a perk status, or an active grant. */
export async function hasSupporterPerks(db: D1Database, userId: string, now = nowIso()): Promise<boolean> {
  const status = await scalar<string>(db, 'SELECT status FROM supporters WHERE user_id = ?', [userId]);
  if (status && PERK_STATUS_LIST.includes(status)) return true;
  return (await grantPerksUntil(db, userId, now)) != null;
}

export interface GrantResult {
  startsAt: string;
  endsAt: string;
}

/**
 * Gives `referrerId` the referral reward for `refereeId` (idempotent per
 * friend). The new grant starts where the current run ends (or now) and is
 * clipped so perks never run more than GRANT_STACK_MAX_MONTHS past `now`; a
 * friend who arrives while the bank is full still uses up their reward (a
 * zero-length row), so it can't be replayed later. Returns null when nothing
 * was inserted.
 */
export async function grantReferralReward(
  db: D1Database,
  referrerId: string,
  refereeId: string,
  now = nowIso(),
): Promise<GrantResult | null> {
  if (!referrerId || referrerId === refereeId) return null;
  const runEnd = await scalar<string>(
    db,
    'SELECT max(ends_at) FROM supporter_grants WHERE user_id = ? AND ends_at > ?',
    [referrerId, now],
  );
  const startsAt = runEnd ?? now;
  const cap = addMonthsIso(now, GRANT_STACK_MAX_MONTHS);
  const full = addMonthsIso(startsAt, REFERRAL_GRANT_MONTHS);
  const endsAt = full < cap ? full : cap > startsAt ? cap : startsAt;
  const meta = await insertStmt(
    db,
    'supporter_grants',
    { id: uuid(), user_id: referrerId, source: 'referral', referee_id: refereeId, starts_at: startsAt, ends_at: endsAt, created_at: now },
    { onConflict: 'ignore' },
  ).run();
  return (meta.meta?.changes ?? 0) > 0 ? { startsAt, endsAt } : null;
}

/**
 * Called after the friend's training progress moves (sessions.update): grants
 * their referrer the reward once they've trained REFERRAL_REWARD_POSITIONS
 * positions. Cheap for everyone else (one indexed read).
 */
export async function maybeGrantReferralReward(db: D1Database, refereeId: string, now = nowIso()): Promise<GrantResult | null> {
  const row = await first<{ referred_by: string | null; trained: number; granted: number }>(
    db,
    `SELECT p.referred_by,
            (SELECT coalesce(sum(blunders_attempted), 0) FROM training_sessions WHERE user_id = p.id) AS trained,
            EXISTS (SELECT 1 FROM supporter_grants WHERE source = 'referral' AND referee_id = p.id) AS granted
       FROM profiles p
      WHERE p.id = ? AND p.referred_by IS NOT NULL`,
    [refereeId],
  );
  if (!row?.referred_by || row.granted || Number(row.trained) < REFERRAL_REWARD_POSITIONS) return null;
  return grantReferralReward(db, row.referred_by, refereeId, now);
}

/** The caller's referral-reward progress for the InviteCard: grants earned and the end of the perks they give (comps excluded). */
export async function referralRewardSummary(
  db: D1Database,
  userId: string,
  now = nowIso(),
): Promise<{ rewardsEarned: number; perksUntil: string | null }> {
  const earned = await scalar<number>(
    db,
    "SELECT count(*) FROM supporter_grants WHERE user_id = ? AND source = 'referral'",
    [userId],
  );
  return { rewardsEarned: Number(earned ?? 0), perksUntil: await grantPerksUntil(db, userId, now, 'referral') };
}
