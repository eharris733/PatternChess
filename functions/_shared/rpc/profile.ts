import { createProfileForUser } from '../auth';
import { all, first, nowIso, run, scalar, stmt, type SqlParam } from '../db';
import { encodeRow } from '../schema';
import { US_STATE_CODES } from '../../../src/lib/usStates';
import {
  REFERRAL_REWARD_POSITIONS,
  grantPerksUntil,
  maybeGrantReferralReward,
  referralRewardSummary,
} from '../supporterGrants';
import { sanitizeAvatar } from '../../../src/lib/avatar';
import { PIECE_SETS } from '../../../src/lib/pieceSets';
import { BOARD_THEMES as ALL_THEMES, LEGACY_BOARD_THEMES } from '../../../src/lib/themeIds';
import { FREEZE_RUNGS } from '../../../src/lib/rewards';
import {
  argOptString,
  argString,
  badRequest,
  userRpc,
  type RpcRegistry,
  type UserRpcContext,
} from './core';

/**
 * Profile, training-session, stat-row and supporter RPCs (domain B of the
 * Supabase → D1 move). Every query is scoped by `ctx.user.id`; nothing takes a
 * user id from the arguments.
 *
 * Postgres let the client UPDATE any column of its own `profiles` row (RLS),
 * with the `profiles_guard_email_columns` trigger pinning
 * `contact_email_verified_at` / `email_unsub_token` and clearing the
 * verification when `contact_email` changes. Here the writable columns are an
 * explicit allowlist (PROFILE_WRITABLE) and the guard is reproduced in SQL:
 * the two pinned columns are simply not writable, and a `contact_email` write
 * resets `contact_email_verified_at` unless the address is unchanged.
 */

const DAY_MS = 86_400_000;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Postgres CHECK: contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// board_theme's CHECK allows only the first five; every theme goes to `theme` (0005).
const BOARD_THEMES = LEGACY_BOARD_THEMES;
const STREAK_FREEZE_CAP = 2;
const COMMITMENT_LEVELS = ['casual', 'regular', 'serious', 'obsessed', 'custom'] as const;
const TIME_CONTROLS = ['bullet', 'blitz', 'rapid', 'classical'] as const;
const ASKS = ['email', 'course', 'supporter'] as const;

// ---------------------------------------------------------------------------
// profiles.update allowlist
// ---------------------------------------------------------------------------

type Validator = (v: unknown, col: string) => unknown;

const fail = (col: string, what: string) => badRequest(`${col} ${what}`, 'bad_profile_value');

const text =
  (max: number, nullable = true): Validator =>
  (v, col) => {
    if (v === null && nullable) return null;
    if (typeof v !== 'string') throw fail(col, 'must be a string');
    if (v.length > max) throw fail(col, `must be at most ${max} characters`);
    return v;
  };

const bool: Validator = (v, col) => {
  if (typeof v !== 'boolean') throw fail(col, 'must be a boolean');
  return v;
};

const int =
  (min: number, max: number): Validator =>
  (v, col) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw fail(col, `must be an integer in ${min}..${max}`);
    }
    return v;
  };

const oneOf =
  (values: readonly string[], nullable = false): Validator =>
  (v, col) => {
    if (v === null && nullable) return null;
    if (typeof v !== 'string' || !values.includes(v)) throw fail(col, `must be one of ${values.join(', ')}`);
    return v;
  };

const timestamp: Validator = (v, col) => {
  if (v === null) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw fail(col, 'must be an ISO timestamp');
  return v;
};

const localDate: Validator = (v, col) => {
  if (v === null) return null;
  if (typeof v !== 'string' || !LOCAL_DATE_RE.test(v)) throw fail(col, 'must be YYYY-MM-DD');
  return v;
};

const timeControls: Validator = (v, col) => {
  if (!Array.isArray(v) || v.some((x) => !(TIME_CONTROLS as readonly unknown[]).includes(x))) {
    throw fail(col, `must be an array of ${TIME_CONTROLS.join(', ')}`);
  }
  return Array.from(new Set(v as string[]));
};

const avatar: Validator = (v, col) => {
  if (v === null) return null;
  const parts = sanitizeAvatar(v);
  if (!parts) throw fail(col, 'is not a valid avatar');
  return parts;
};

const contactEmail: Validator = (v, col) => {
  if (v === null) return null;
  if (typeof v !== 'string') throw fail(col, 'must be a string');
  const email = v.trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw fail(col, 'is not an email address');
  return email;
};

/**
 * Columns a user may write on their own profile, with their validators.
 * Everything else (counters, referral fields, anon_id, the email token and
 * verification stamp, created_at, …) is written only by dedicated RPCs.
 */
export const PROFILE_WRITABLE: Readonly<Record<string, Validator>> = {
  // updateProfile
  display_name: text(200),
  avatar_url: text(2000),
  lichess_username: text(100),
  chesscom_username: text(100),
  preferred_rated_only: bool,
  preferred_time_controls: timeControls,
  board_theme: oneOf(BOARD_THEMES),
  // cosmetics (0005); unlocks are client-checked like flair
  theme: oneOf(ALL_THEMES, true),
  piece_set: oneOf(PIECE_SETS, true),
  avatar,
  // updateTrainingPrefs + milestone flags
  show_engine_evals: bool,
  reveal_before_solve: bool,
  autoplay_refutation: bool,
  show_answer_on_miss: bool,
  sounds_enabled: bool,
  leaderboard_opt_out: bool,
  used_training_filter: bool,
  followed_instagram: bool,
  flair: text(64),
  // sync bookkeeping
  last_synced_lichess_at: timestamp,
  last_synced_chesscom_at: timestamp,
  // streak (profile.updateStreak is the usual path)
  current_streak_days: int(0, 100_000),
  longest_streak_days: int(0, 100_000),
  last_drill_local_date: localDate,
  timezone: text(64),
  streak_freezes: int(0, 2),
  // daily goals
  commitment_level: oneOf(COMMITMENT_LEVELS),
  daily_positions_goal: int(1, 100),
  daily_games_goal: int(0, 10),
  // email prefs
  email_opt_in: bool,
  email_hour: int(0, 23),
  email_prompted_at: timestamp,
  email_reminders: oneOf(['daily', 'few_days', 'off']),
  email_reports: oneOf(['weekly', 'monthly', 'off']),
  contact_email: contactEmail,
  // OTB events (dashboard card + weekly email); src/lib/usStates.ts
  events_state: oneOf(US_STATE_CODES, true),
};

/** Validate + normalize a client patch against the allowlist (throws 400 on anything else). */
export function sanitizeProfilePatch(patch: unknown): Record<string, unknown> {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('patch must be an object');
  }
  const out: Record<string, unknown> = {};
  for (const [col, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const validate = Object.prototype.hasOwnProperty.call(PROFILE_WRITABLE, col) ? PROFILE_WRITABLE[col] : undefined;
    if (!validate) throw badRequest(`profiles.${col} is not writable`, 'column_not_writable');
    out[col] = validate(v, col);
  }
  return out;
}

/**
 * The UPDATE for a sanitized patch, with the email guard: writing
 * `contact_email` clears `contact_email_verified_at` unless the address is
 * unchanged (SQLite evaluates every SET expression against the old row, like
 * the Postgres BEFORE UPDATE trigger's `old`).
 */
export function profileUpdateSql(userId: string, patch: Record<string, unknown>): { sql: string; params: SqlParam[] } {
  const enc = encodeRow('profiles', patch);
  const cols = Object.keys(enc);
  if (cols.length === 0) throw badRequest('empty patch');
  const sets = cols.map((c) => `"${c}" = ?`);
  const params: SqlParam[] = cols.map((c) => enc[c]);
  if ('contact_email' in enc) {
    sets.push('contact_email_verified_at = CASE WHEN contact_email IS ? THEN contact_email_verified_at ELSE NULL END');
    params.push(enc.contact_email);
  }
  params.push(userId);
  return { sql: `UPDATE profiles SET ${sets.join(', ')} WHERE id = ? RETURNING *`, params };
}

async function getProfileRow(ctx: UserRpcContext) {
  return first(ctx.db, 'SELECT * FROM profiles WHERE id = ?', [ctx.user.id], 'profiles');
}

/** `UPDATE profiles SET <col> = <col> + 1 WHERE id = me RETURNING <col>` → the new value (null: no profile). */
async function bump(ctx: UserRpcContext, col: string): Promise<number | null> {
  return scalar<number>(ctx.db, `UPDATE profiles SET ${col} = ${col} + 1 WHERE id = ? RETURNING ${col}`, [ctx.user.id]);
}

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// training_sessions
// ---------------------------------------------------------------------------

const SESSION_PATCH_COLS = ['blunders_attempted', 'blunders_correct', 'cycles_completed', 'ended_at'] as const;

function sanitizeSessionPatch(patch: unknown): Record<string, unknown> {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('patch must be an object');
  const out: Record<string, unknown> = {};
  for (const [col, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (!(SESSION_PATCH_COLS as readonly string[]).includes(col)) {
      throw badRequest(`training_sessions.${col} is not writable`, 'column_not_writable');
    }
    if (col === 'ended_at') out[col] = timestamp(v, col);
    else out[col] = int(0, 1_000_000)(v, col);
  }
  return out;
}

// ---------------------------------------------------------------------------
// stat rows (keyset-paged narrow reads; the client loops until a short page)
// ---------------------------------------------------------------------------

export const STAT_ROWS_PAGE_MAX = 5000;

const BLUNDER_STAT_COLUMNS =
  'id, kind, phase, game_id, eval_before, move_number, side_to_move, cycle_number, times_correct, times_attempted, last_drilled_at, last_drill_failed';
const GAME_STAT_COLUMNS =
  'id, opening_family, opening_name, eco, user_color, result, platform, time_control, clock_per_ply, rated, user_rating';

function pageArgs(args: { afterId?: unknown; limit?: unknown }): { afterId: string; limit: number } {
  const afterId = argOptString(args as Record<string, unknown>, 'afterId') ?? '';
  const raw = args.limit;
  const limit =
    typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? Math.min(raw, STAT_ROWS_PAGE_MAX) : STAT_ROWS_PAGE_MAX;
  return { afterId, limit };
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export const handlers: RpcRegistry = {
  // --- profiles --------------------------------------------------------------

  /** The caller's profile row (PostgREST shape) or null. */
  'profile.get': userRpc(async (ctx) => getProfileRow(ctx)),

  /**
   * The caller's profile, creating it when the better-auth create hook didn't
   * (it never fails a sign-in over the profile). Stamps the landing-page
   * visitor id when the row has none yet.
   */
  'profile.getOrCreate': userRpc<{ anonId?: string | null }>(async (ctx, args) => {
    const anonId = argOptString(args, 'anonId');
    let row = await getProfileRow(ctx);
    if (!row) {
      const u = await first<{ id: string; email: string; name: string | null; image: string | null }>(
        ctx.db,
        'SELECT id, email, name, image FROM "user" WHERE id = ?',
        [ctx.user.id],
      );
      if (!u) throw badRequest('No account for this session', 'no_user');
      await createProfileForUser(ctx.db, u);
      row = await getProfileRow(ctx);
      if (!row) throw new Error('profile create failed');
    }
    if (anonId && anonId.length <= 100 && row.anon_id == null) {
      const stamped = await first(
        ctx.db,
        'UPDATE profiles SET anon_id = ? WHERE id = ? AND anon_id IS NULL RETURNING *',
        [anonId, ctx.user.id],
        'profiles',
      );
      if (stamped) row = stamped;
    }
    return row;
  }),

  /** Allowlisted column update of the caller's profile; returns the new row (null: no profile). */
  'profile.update': userRpc<{ patch: Record<string, unknown> }>(async (ctx, args) => {
    const patch = sanitizeProfilePatch(args.patch);
    const { sql, params } = profileUpdateSql(ctx.user.id, patch);
    return first(ctx.db, sql, params, 'profiles');
  }),

  /**
   * Streak write from recordStreakActivity: the streak columns plus, when
   * given, the banked freezes, and an atomic add to the lifetime
   * `streak_freezes_used` (was a client read-modify-write).
   */
  'profile.updateStreak': userRpc<{
    currentStreakDays: number;
    longestStreakDays: number;
    lastDrillLocalDate: string;
    timezone: string;
    streakFreezes?: number | null;
    freezesUsed?: number | null;
  }>(async (ctx, args) => {
    const patch = sanitizeProfilePatch({
      current_streak_days: args.currentStreakDays,
      longest_streak_days: args.longestStreakDays,
      last_drill_local_date: args.lastDrillLocalDate,
      timezone: args.timezone,
      ...(args.streakFreezes != null ? { streak_freezes: args.streakFreezes } : {}),
    });
    const used = args.freezesUsed ?? 0;
    if (typeof used !== 'number' || !Number.isInteger(used) || used < 0 || used > 1000) {
      throw badRequest('freezesUsed must be a non-negative integer');
    }
    const enc = encodeRow('profiles', patch);
    const cols = Object.keys(enc);
    const sets = cols.map((c) => `"${c}" = ?`);
    const params: SqlParam[] = cols.map((c) => enc[c]);
    if (used > 0) {
      sets.push('streak_freezes_used = streak_freezes_used + ?');
      params.push(used);
    }
    await run(ctx.db, `UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, [...params, ctx.user.id]);
    return null;
  }),

  /** bump_app_open(): +1 per tab session, returns the new total. */
  'profile.bumpAppOpen': userRpc(async (ctx) => bump(ctx, 'app_opens')),

  /** mark_ask_prompted(p_ask): stamp <ask>_prompted_at and bump <ask>_prompt_count. */
  'profile.markAskPrompted': userRpc<{ ask: string }>(async (ctx, args) => {
    const ask = argString(args, 'ask');
    if (!(ASKS as readonly string[]).includes(ask)) throw badRequest(`unknown ask ${ask}`);
    await run(
      ctx.db,
      `UPDATE profiles SET ${ask}_prompted_at = ?, ${ask}_prompt_count = ${ask}_prompt_count + 1 WHERE id = ?`,
      [nowIso(), ctx.user.id],
    );
    return null;
  }),

  /** increment_opening_reviews(): returns the new count. */
  'profile.incrementOpeningReviews': userRpc(async (ctx) => bump(ctx, 'opening_reviews_opened')),

  /** increment_shares_count(): returns the new count. */
  'profile.incrementShares': userRpc(async (ctx) => bump(ctx, 'shares_count')),

  /**
   * mark_learn_chapter_done(key): append the key unless it is already there or
   * longer than 200 characters; returns the array length either way.
   */
  'profile.markLearnChapterDone': userRpc<{ key: string }>(async (ctx, args) => {
    const key = argString(args, 'key');
    const n = await scalar<number>(
      ctx.db,
      `UPDATE profiles SET learn_chapters_done = CASE
         WHEN length(?1) > 200 OR EXISTS (SELECT 1 FROM json_each(learn_chapters_done) WHERE value = ?1)
           THEN learn_chapters_done
         ELSE json_insert(learn_chapters_done, '$[#]', ?1)
       END
       WHERE id = ?2
       RETURNING json_array_length(learn_chapters_done) AS n`,
      [key, ctx.user.id],
    );
    return n ?? 0;
  }),

  /**
   * training_totals(): minutes = finished sessions' durations, each capped at
   * 120, rounded once over the sum; activeDays = distinct local dates with a
   * correct drill; positions = lifetime first-attempt positions trained, the
   * daily goal's count summed over every session (openings excluded, like the
   * goal) — the /path metric.
   */
  'profile.trainingTotals': userRpc(async (ctx) => {
    const row = await first<{ minutes: number | null; activeDays: number | null; positions: number | null }>(
      ctx.db,
      `SELECT
         (SELECT CAST(round(sum(min((julianday(ended_at) - julianday(started_at)) * 1440.0, 120))) AS INTEGER)
            FROM training_sessions
           WHERE user_id = ?1 AND ended_at IS NOT NULL AND ended_at > started_at) AS minutes,
         (SELECT count(DISTINCT local_date)
            FROM training_sessions
           WHERE user_id = ?1 AND blunders_correct > 0) AS activeDays,
         (SELECT coalesce(sum(blunders_attempted), 0)
            FROM training_sessions
           WHERE user_id = ?1) AS positions`,
      [ctx.user.id],
    );
    return { minutes: row?.minutes ?? 0, activeDays: row?.activeDays ?? 0, positions: row?.positions ?? 0 };
  }),

  /**
   * Banks the streak freeze a /path rung awards (src/lib/rewards.ts
   * FREEZE_RUNGS), once per rung. The server re-checks the rung against
   * lifetime positions trained (sum of training_sessions.blunders_attempted,
   * the daily-goal count) and records it in path_rewards_claimed whether or
   * not the bank (capped at 2) had room. Returns the new freeze count.
   */
  'profile.claimPathReward': userRpc<{ rung: number }>(async (ctx, args) => {
    const rung = args.rung;
    if (typeof rung !== 'number' || !FREEZE_RUNGS.includes(rung)) throw badRequest('not a streak-freeze rung');
    const trained = Number(
      (await scalar<number>(
        ctx.db,
        'SELECT coalesce(sum(blunders_attempted), 0) FROM training_sessions WHERE user_id = ?',
        [ctx.user.id],
      )) ?? 0,
    );
    if (trained < rung) return { granted: false, reason: 'not_reached', streakFreezes: null };
    const row = await first<{ streak_freezes: number }>(
      ctx.db,
      `UPDATE profiles
          SET streak_freezes = min(streak_freezes + 1, ?1),
              path_rewards_claimed = json_insert(path_rewards_claimed, '$[#]', CAST(?2 AS INTEGER))
        WHERE id = ?3
          AND NOT EXISTS (SELECT 1 FROM json_each(path_rewards_claimed) WHERE value = CAST(?2 AS INTEGER))
        RETURNING streak_freezes`,
      [STREAK_FREEZE_CAP, rung, ctx.user.id],
    );
    if (!row) return { granted: false, reason: 'already_claimed', streakFreezes: null };
    return { granted: true, reason: null, streakFreezes: row.streak_freezes };
  }),

  /**
   * claim_referral(code): record who invited the caller (once, never self,
   * only for accounts under 7 days old) and credit the referrer.
   */
  'profile.claimReferral': userRpc<{ code: string | null }>(async (ctx, args) => {
    const code = argOptString(args, 'code');
    if (code == null) return false;
    const referrer = await scalar<string>(ctx.db, 'SELECT id FROM profiles WHERE referral_code = lower(trim(?))', [
      code,
    ]);
    if (!referrer || referrer === ctx.user.id) return false;
    const meta = await run(
      ctx.db,
      `UPDATE profiles SET referred_by = ?
        WHERE id = ? AND referred_by IS NULL AND (created_at IS NULL OR created_at > ?)`,
      [referrer, ctx.user.id, sevenDaysAgoIso()],
    );
    if ((meta.changes ?? 0) === 0) return false;
    await run(ctx.db, 'UPDATE profiles SET referrals_count = referrals_count + 1 WHERE id = ?', [referrer]);
    return true;
  }),

  /** claim_signup_source(source): set once (≤ 120 chars) within 7 days of sign-up. */
  'profile.claimSignupSource': userRpc<{ source: string | null }>(async (ctx, args) => {
    const source = argOptString(args, 'source');
    if (source == null || source.length > 120) return false;
    const meta = await run(
      ctx.db,
      `UPDATE profiles SET signup_source = ?
        WHERE id = ? AND signup_source IS NULL AND (created_at IS NULL OR created_at > ?)`,
      [source, ctx.user.id, sevenDaysAgoIso()],
    );
    return (meta.changes ?? 0) > 0;
  }),

  /**
   * Claim ownerless games played under `username` (RLS let any user update
   * `user_id IS NULL` rows), then the ownerless blunders of the caller's games.
   */
  'profile.claimAnonymousData': userRpc<{ username: string }>(async (ctx, args) => {
    const username = argString(args, 'username').trim();
    if (!username) return null;
    await ctx.db.batch([
      stmt(ctx.db, 'UPDATE games SET user_id = ? WHERE username = ? AND user_id IS NULL', [ctx.user.id, username]),
      stmt(
        ctx.db,
        'UPDATE blunders SET user_id = ?1 WHERE user_id IS NULL AND game_id IN (SELECT id FROM games WHERE user_id = ?1)',
        [ctx.user.id],
      ),
    ]);
    return null;
  }),

  // --- training_sessions -------------------------------------------------------

  'sessions.create': userRpc<{ localDate: string }>(async (ctx, args) => {
    const localDate = argString(args, 'localDate');
    if (!LOCAL_DATE_RE.test(localDate)) throw badRequest('localDate must be YYYY-MM-DD');
    return first(
      ctx.db,
      `INSERT INTO training_sessions
         (id, user_id, started_at, local_date, blunders_attempted, blunders_correct, cycles_completed)
       VALUES (?, ?, ?, ?, 0, 0, 0) RETURNING *`,
      [crypto.randomUUID(), ctx.user.id, nowIso(), localDate],
      'training_sessions',
    );
  }),

  'sessions.update': userRpc<{ id: string; patch: Record<string, unknown> }>(async (ctx, args) => {
    const id = argString(args, 'id');
    const patch = sanitizeSessionPatch(args.patch);
    const enc = encodeRow('training_sessions', patch);
    const cols = Object.keys(enc);
    if (cols.length === 0) return null;
    await run(
      ctx.db,
      `UPDATE training_sessions SET ${cols.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
      [...cols.map((c) => enc[c]), id, ctx.user.id],
    );
    // A referred friend's progress may earn their referrer the reward.
    if ('blunders_attempted' in enc) await maybeGrantReferralReward(ctx.db, ctx.user.id);
    return null;
  }),

  'sessions.recent': userRpc<{ limit?: number }>(async (ctx, args) => {
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 1000) : 10;
    return all(
      ctx.db,
      'SELECT * FROM training_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?',
      [ctx.user.id, limit],
      'training_sessions',
    );
  }),

  'sessions.since': userRpc<{ sinceDate: string }>(async (ctx, args) => {
    const since = argString(args, 'sinceDate');
    return all(
      ctx.db,
      'SELECT * FROM training_sessions WHERE user_id = ? AND local_date >= ? ORDER BY local_date DESC',
      [ctx.user.id, since],
      'training_sessions',
    );
  }),

  'sessions.hasToday': userRpc<{ localDate: string }>(async (ctx, args) => {
    const localDate = argString(args, 'localDate');
    const hit = await scalar<number>(
      ctx.db,
      'SELECT 1 FROM training_sessions WHERE user_id = ? AND local_date = ? AND blunders_correct > 0 LIMIT 1',
      [ctx.user.id, localDate],
    );
    return hit === 1;
  }),

  // --- dashboard stat rows ------------------------------------------------------

  /** Every blunder row (all kinds, retired included), narrow columns, keyset-paged by id. */
  'stats.blunderRows': userRpc<{ afterId?: string; limit?: number }>(async (ctx, args) => {
    const { afterId, limit } = pageArgs(args);
    return all(
      ctx.db,
      `SELECT ${BLUNDER_STAT_COLUMNS} FROM blunders WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [ctx.user.id, afterId, limit],
      'blunders',
    );
  }),

  /** Every game row with the stat columns (incl. clocks), keyset-paged by id. */
  'stats.gameRows': userRpc<{ afterId?: string; limit?: number }>(async (ctx, args) => {
    const { afterId, limit } = pageArgs(args);
    return all(
      ctx.db,
      `SELECT ${GAME_STAT_COLUMNS} FROM games WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?`,
      [ctx.user.id, afterId, limit],
      'games',
    );
  }),

  /**
   * get_blunder_motif_counts(): motif tallies over the caller's enriched
   * (solution_line present) tactic rows, plus tagged/untagged/total.
   */
  'stats.motifCounts': userRpc(async (ctx) => {
    const [counts, totals] = await ctx.db.batch<Record<string, unknown>>([
      stmt(
        ctx.db,
        `SELECT m.value AS motif, count(*) AS n
           FROM blunders b, json_each(b.motifs) m
          WHERE b.user_id = ? AND b.kind = 'tactic' AND b.solution_line IS NOT NULL
          GROUP BY m.value`,
        [ctx.user.id],
      ),
      stmt(
        ctx.db,
        `SELECT coalesce(sum(solution_line IS NOT NULL), 0) AS tagged,
                coalesce(sum(solution_line IS NULL), 0) AS untagged,
                count(*) AS total
           FROM blunders WHERE user_id = ? AND kind = 'tactic'`,
        [ctx.user.id],
      ),
    ]);
    const out: Record<string, number> = {};
    for (const r of counts.results ?? []) out[String(r.motif)] = Number(r.n);
    const t = (totals.results ?? [])[0] ?? {};
    return {
      counts: out,
      tagged: Number(t.tagged ?? 0),
      untagged: Number(t.untagged ?? 0),
      total: Number(t.total ?? 0),
    };
  }),

  // --- supporters -----------------------------------------------------------------

  /**
   * The caller's own supporters row (the Stripe mirror) plus `grant_ends_at`
   * (the end of their running supporter_grants, e.g. the referral reward), or
   * null when they have neither. Perks = a PERK_STATUSES status OR a grant.
   */
  'supporters.mine': userRpc(async (ctx) => {
    const [row, grantEndsAt] = await Promise.all([
      first<Record<string, unknown>>(
        ctx.db,
        'SELECT status, current_period_end, cancel_at_period_end, first_supported_at FROM supporters WHERE user_id = ?',
        [ctx.user.id],
        'supporters',
      ),
      grantPerksUntil(ctx.db, ctx.user.id),
    ]);
    if (!row && !grantEndsAt) return null;
    return {
      status: 'none',
      current_period_end: null,
      cancel_at_period_end: false,
      first_supported_at: null,
      ...(row ?? {}),
      grant_ends_at: grantEndsAt,
    };
  }),

  /** InviteCard: referral rewards earned so far, perks end, and the friend threshold. */
  'referral.summary': userRpc(async (ctx) => ({
    ...(await referralRewardSummary(ctx.db, ctx.user.id)),
    positionsNeeded: REFERRAL_REWARD_POSITIONS,
  })),
  // admin_supporters() lives in ./admin.ts as `admin.supporters`.
};
