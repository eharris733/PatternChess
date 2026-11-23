import type { TimeControlCategory } from '../services/chessApiService';
import { BOARD_THEMES, LEGACY_BOARD_THEMES, type BoardTheme } from '../lib/themeIds';
import { sanitizeAvatar, type AvatarParts } from '../lib/avatar';
import { DEFAULT_PIECE_SET, isPieceSet, type PieceSet } from '../lib/pieceSets';
import type { TablesInsert, TablesUpdate } from '../lib/database.types';
import { dailyGoalsFromJson, type DailyGoals } from '../lib/dailyGoal';

export interface UserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  preferredRatedOnly: boolean;
  preferredTimeControls: TimeControlCategory[];
  lastSyncedLichessAt: Date | null;
  lastSyncedChesscomAt: Date | null;
  createdAt: Date;
  currentStreakDays: number;
  longestStreakDays: number;
  /** Banked streak freezes (0–2); a missed day spends one instead of resetting the streak. */
  streakFreezes: number;
  lastDrillLocalDate: string | null;
  timezone: string | null;
  /** US state for OTB events (dashboard card + weekly email); null = not chosen. Read/write via `useEventsState`. */
  eventsState: string | null;
  /** App + board theme: `profiles.theme`, else the legacy `board_theme` (migration 0005). */
  boardTheme: BoardTheme;
  /** Pixel avatar parts (src/lib/avatar.ts); null = the default generated from `id` (resolveAvatar). */
  avatar: AvatarParts | null;
  /** Board piece set (src/lib/pieceSets.ts); `profiles.piece_set` NULL = cburnett. */
  pieceSet: PieceSet;
  /** /path rungs whose streak-freeze reward was banked (profile.claimPathReward). */
  pathRewardsClaimed: number[];
  /** Show raw engine evals next to win-chance percentages on the training screen. */
  showEngineEvals: boolean;
  /**
   * Show extra info before/while solving: the review step (played move +
   * refutation), pre-solve win chances, and the "See what you played" button.
   * The profile UI exposes this inverted as "Hide extra info when solving".
   */
  revealBeforeSolve: boolean;
  /**
   * After any wrong attempt (tactic or endgame, first try included), autoplay
   * the engine's refutation of the played move — then the solution line when
   * `showAnswerOnMiss` is on. Defaults on; off leaves the lines static.
   * Read through `useDrillFeedbackPrefs`, never directly.
   */
  autoplayRefutation: boolean;
  /**
   * After a wrong attempt, draw the best move and offer the solution line.
   * Defaults off. Read through `useDrillFeedbackPrefs`, never directly.
   */
  showAnswerOnMiss: boolean;
  /** True once the user has ever started a /training session with a picked focus (opening/motif/phase/situation) — backs the "Focused Training" achievement. */
  usedTrainingFilter: boolean;
  /** Board + feedback sounds (src/lib/sounds.ts). Defaults on. */
  soundsEnabled: boolean;
  /** Hide this user from every leaderboard (the Profile toggle is the inverse, "Show me on leaderboards"). */
  leaderboardOptOut: boolean;
  /** Clicked through to the PatternChess Instagram — backs the "Follow along" achievement. */
  followedInstagram: boolean;
  /** Shares from PatternChess (links, images, GIFs; increment_shares_count RPC) — backs the share achievements. */
  sharesCount: number;
  /** Public code for invite links (?ref=CODE); null until the referrals migration has run. */
  referralCode: string | null;
  /** Friends who joined through this user's invite link (claim_referral RPC). */
  referralsCount: number;
  /** Opening training started from /openings (increment_opening_reviews RPC) — backs the review achievements. */
  openingReviewsOpened: number;
  /** Distinct Learn chapters completed ("<slug>/<chapter>", mark_learn_chapter_done RPC). */
  learnChaptersDone: string[];
  /** Selected flair id (src/lib/flair.ts); null = none. Cosmetic only. */
  flair: string | null;
  /** Commitment level + the daily plan's position/game goals. Write via `updateDailyGoals`. */
  dailyGoals: DailyGoals;
  /** Training reminder emails. Opt-out: on by default for new accounts (migration 20261121120000). Write via `updateEmailOptIn`. */
  emailOptIn: boolean;
  /** Local hour (0–23, in `timezone`) reminders go out. Write via `updateEmailHour`. */
  emailHour: number;
  /** Typed-in address for accounts without one (Lichess sign-ins); confirmed by link. Write via `updateContactEmail`. */
  contactEmail: string | null;
  contactEmailVerifiedAt: Date | null;
  /** Set by the one-click unsubscribe; the dashboard never asks again after it. */
  emailUnsubscribedAt: Date | null;
  /** Tab sessions counted by `bump_app_open` (migration 20261123120000). */
  appOpens: number;
  /** Staged dashboard asks (src/lib/asks.ts): last answer/dismissal and how many times. */
  asks: Record<'email' | 'course' | 'supporter', { promptedAt: Date | null; count: number }>;
  /** The course the player follows (catalog slug; D1 migration 0003). Write via `setCourseFocus`. */
  courseFocus: string | null;
}

function parseBoardTheme(v: unknown): BoardTheme {
  if (typeof v === 'string' && (BOARD_THEMES as readonly string[]).includes(v)) {
    return v as BoardTheme;
  }
  return 'default';
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isTimeControl(v: unknown): v is TimeControlCategory {
  return v === 'bullet' || v === 'blitz' || v === 'rapid' || v === 'classical';
}

function parseTimeControls(v: unknown): TimeControlCategory[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<TimeControlCategory>();
  for (const item of v) {
    if (isTimeControl(item)) seen.add(item);
  }
  return Array.from(seen);
}

export function userProfileFromJson(json: any): UserProfile {
  return {
    id: json.id as string,
    displayName: (json.display_name as string | null) ?? null,
    avatarUrl: (json.avatar_url as string | null) ?? null,
    lichessUsername: (json.lichess_username as string | null) ?? null,
    chesscomUsername: (json.chesscom_username as string | null) ?? null,
    // New accounts default to rated games only (defaultProfileRow).
    preferredRatedOnly: Boolean(json.preferred_rated_only ?? true),
    preferredTimeControls: parseTimeControls(json.preferred_time_controls),
    lastSyncedLichessAt: parseDate(json.last_synced_lichess_at),
    lastSyncedChesscomAt: parseDate(json.last_synced_chesscom_at),
    createdAt: new Date(json.created_at as string),
    currentStreakDays: (json.current_streak_days as number | null) ?? 0,
    longestStreakDays: (json.longest_streak_days as number | null) ?? 0,
    streakFreezes: (json.streak_freezes as number | null) ?? 0,
    lastDrillLocalDate: (json.last_drill_local_date as string | null) ?? null,
    timezone: (json.timezone as string | null) ?? null,
    eventsState: typeof json.events_state === 'string' && json.events_state ? json.events_state : null,
    boardTheme: parseBoardTheme(json.theme ?? json.board_theme),
    avatar: sanitizeAvatar(json.avatar),
    pieceSet: isPieceSet(json.piece_set) ? json.piece_set : DEFAULT_PIECE_SET,
    pathRewardsClaimed: Array.isArray(json.path_rewards_claimed)
      ? (json.path_rewards_claimed as unknown[]).filter((n): n is number => typeof n === 'number')
      : [],
    // Columns may be absent until the 20260610 migration is applied; default off.
    showEngineEvals: Boolean(json.show_engine_evals ?? false),
    revealBeforeSolve: Boolean(json.reveal_before_solve ?? false),
    autoplayRefutation: Boolean(json.autoplay_refutation ?? true),
    showAnswerOnMiss: Boolean(json.show_answer_on_miss ?? false),
    usedTrainingFilter: Boolean(json.used_training_filter ?? false),
    soundsEnabled: Boolean(json.sounds_enabled ?? true),
    leaderboardOptOut: Boolean(json.leaderboard_opt_out ?? false),
    followedInstagram: Boolean(json.followed_instagram ?? false),
    sharesCount: (json.shares_count as number | null) ?? 0,
    referralCode: (json.referral_code as string | null) ?? null,
    referralsCount: (json.referrals_count as number | null) ?? 0,
    openingReviewsOpened: (json.opening_reviews_opened as number | null) ?? 0,
    learnChaptersDone: Array.isArray(json.learn_chapters_done)
      ? (json.learn_chapters_done as unknown[]).filter((k): k is string => typeof k === 'string')
      : [],
    flair: typeof json.flair === 'string' && json.flair ? json.flair : null,
    dailyGoals: dailyGoalsFromJson(json),
    emailOptIn: json.email_opt_in === true,
    emailHour: typeof json.email_hour === 'number' ? json.email_hour : 18,
    contactEmail: typeof json.contact_email === 'string' && json.contact_email ? json.contact_email : null,
    contactEmailVerifiedAt: parseDate(json.contact_email_verified_at),
    emailUnsubscribedAt: parseDate(json.email_unsubscribed_at),
    appOpens: (json.app_opens as number | null) ?? 0,
    courseFocus: typeof json.course_focus === 'string' && json.course_focus ? json.course_focus : null,
    asks: {
      email: { promptedAt: parseDate(json.email_prompted_at), count: (json.email_prompt_count as number | null) ?? 0 },
      course: { promptedAt: parseDate(json.course_prompted_at), count: (json.course_prompt_count as number | null) ?? 0 },
      supporter: {
        promptedAt: parseDate(json.supporter_prompted_at),
        count: (json.supporter_prompt_count as number | null) ?? 0,
      },
    },
  };
}

export function userProfileToInsert(p: UserProfile): TablesInsert<'profiles'> {
  return {
    id: p.id,
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
    preferred_rated_only: p.preferredRatedOnly,
    preferred_time_controls: p.preferredTimeControls,
    ...themeColumns(p.boardTheme),
  };
}

/**
 * The theme write: `theme` always, `board_theme` (CHECK: the first five
 * themes) only when the pick fits it, so older readers keep a sensible value.
 */
function themeColumns(theme: BoardTheme): { theme: string; board_theme?: string } {
  return LEGACY_BOARD_THEMES.includes(theme) ? { theme, board_theme: theme } : { theme };
}

export function userProfileToUpdate(p: UserProfile): TablesUpdate<'profiles'> {
  return {
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    lichess_username: p.lichessUsername,
    chesscom_username: p.chesscomUsername,
    preferred_rated_only: p.preferredRatedOnly,
    preferred_time_controls: p.preferredTimeControls,
    ...themeColumns(p.boardTheme),
  };
}
