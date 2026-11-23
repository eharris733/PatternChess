import { rpc } from '../../lib/api';
import type { TablesUpdate } from '../../lib/database.types';
import { currentUserId } from './currentUser';
import type { DailyGoals } from '../../lib/dailyGoal';

/**
 * Allowlisted column write on the caller's own profile (server:
 * functions/_shared/rpc/profile.ts, PROFILE_WRITABLE). The server scopes it to
 * the session user and keeps the old guard trigger's rule: a new
 * `contact_email` clears `contact_email_verified_at`.
 */
export async function updateOwnProfile(patch: TablesUpdate<'profiles'>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await rpc('profile.update', { patch });
}

export async function updateProfileLastSynced(
  platform: 'lichess' | 'chess.com',
  ts: Date,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile(
    platform === 'lichess'
      ? { last_synced_lichess_at: ts.toISOString() }
      : { last_synced_chesscom_at: ts.toISOString() },
  );
}

export async function updateProfileStreak(args: {
  currentStreakDays: number;
  longestStreakDays: number;
  lastDrillLocalDate: string;
  timezone: string;
  /** Banked freezes after this update; omitted = leave unchanged. */
  streakFreezes?: number;
  /** Freezes spent by this update, added to the lifetime counter. */
  freezesUsed?: number;
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  // One UPDATE server-side; the lifetime freezes-used counter is an atomic add.
  await rpc('profile.updateStreak', args);
}

/** Commitment level + daily plan goals (presets in src/lib/dailyGoal.ts). */
export async function updateDailyGoals(goals: DailyGoals): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile({
    commitment_level: goals.level,
    daily_positions_goal: goals.positionsPerDay,
    daily_games_goal: goals.gamesPerDay,
  });
}

/** Training reminder emails on/off (opt-out; the one switch in /profile). */
export async function updateEmailOptIn(optIn: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile({ email_opt_in: optIn, email_prompted_at: new Date().toISOString() });
}

/** Local hour (0–23) reminder emails go out; stamps the timezone if it was never set. */
export async function updateEmailHour(hour: number, timezone: string | null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile({ email_hour: hour, ...(timezone ? { timezone } : {}) });
}

/**
 * A typed-in address for accounts without one (Lichess sign-ins). Turns
 * reminders on; the notifier Worker's next hourly run mails a confirmation
 * link, and nothing else is sent until it is clicked. The server clears
 * `contact_email_verified_at` whenever the address changes.
 */
export async function updateContactEmail(email: string, timezone: string | null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile({
    contact_email: email.trim(),
    email_opt_in: true,
    email_prompted_at: new Date().toISOString(),
    ...(timezone ? { timezone } : {}),
  });
}

/** Counts one app open (AppShell, once per tab session) and returns the new total. */
export async function bumpAppOpen(): Promise<number | null> {
  const data = await rpc<number | null>('profile.bumpAppOpen');
  return typeof data === 'number' ? data : null;
}

/** Records that a dashboard ask was answered or dismissed (src/lib/asks.ts). */
export async function markAskPrompted(ask: 'email' | 'course' | 'supporter'): Promise<void> {
  await rpc('profile.markAskPrompted', { ask });
}

/** US state for OTB events (`profiles.events_state`); null clears it. Read/write via `useEventsState`. */
export async function updateEventsState(state: string | null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await updateOwnProfile({ events_state: state });
}

/** The caller's coarse location from Cloudflare (events.locate): a first guess for the events card. */
export async function locateForEvents(): Promise<{ country: string | null; region: string | null }> {
  const data = await rpc<{ country: string | null; region: string | null } | null>('events.locate');
  return { country: data?.country ?? null, region: data?.region ?? null };
}
