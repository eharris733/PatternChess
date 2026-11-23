import { authClient } from '../lib/authClient';
import { rpc } from '../lib/api';
import type { AuthUser } from '../auth/AuthProvider';
import { getAnonId } from '../lib/anonId';
import type { Tables, TablesUpdate } from '../lib/database.types';
import { currentUserId } from './db/currentUser';
import { loginUrlWithNext, safeNextPath } from '../lib/nextPath';
import { updateOwnProfile } from './db/profiles';
import { UserProfile, userProfileFromJson, userProfileToUpdate } from '../models/userProfile';

/** A readable message for a failed sign-in redirect request. */
function signInErrorMessage(provider: string, error: { status?: number; message?: string }): string {
  if (error.status === 404 || /provider not found/i.test(error.message ?? '')) {
    return `${provider} sign-in isn't available right now.`;
  }
  return error.message || `${provider} sign-in failed`;
}

/** OAuth success/error landing URLs; a failed sign-in keeps `next` for the retry. */
function callbackUrls(next?: string | null): { callbackURL: string; errorCallbackURL: string } {
  const origin = window.location.origin;
  const safe = safeNextPath(next);
  return {
    callbackURL: `${origin}${safe ?? '/'}`,
    errorCallbackURL: `${origin}${safe ? loginUrlWithNext(safe) : '/login'}`,
  };
}

export const authService = {
  /**
   * `next` (a path vetted by safeNextPath) is where the OAuth callback lands,
   * e.g. `/supporter?checkout=1` to resume checkout once signed in. Without
   * it the player lands on `/`, which forwards to the dashboard.
   */
  async signInWithGoogle(next?: string | null): Promise<void> {
    const { error } = await authClient.signIn.social({ provider: 'google', ...callbackUrls(next) });
    if (error) throw new Error(signInErrorMessage('Google', error));
  },

  async signInWithLichess(next?: string | null): Promise<void> {
    // better-auth 1.7 serves genericOAuth providers through signIn.social.
    const { error } = await authClient.signIn.social({ provider: 'lichess', ...callbackUrls(next) });
    if (error) throw new Error(signInErrorMessage('Lichess', error));
  },

  async signOut(): Promise<void> {
    const { error } = await authClient.signOut();
    if (error) throw new Error(error.message || 'Sign-out failed');
  },

  async getProfile(): Promise<UserProfile | null> {
    // Cached session id: refreshProfile runs often (flair, prefs,
    // achievements); the server scopes the read to the session user.
    const userId = await currentUserId();
    if (!userId) return null;
    try {
      const data = await rpc<Tables<'profiles'> | null>('profile.get');
      return data ? userProfileFromJson(data) : null;
    } catch {
      return null;
    }
  },

  /**
   * The signed-in user's profile. The server creates it when better-auth
   * creates the user (functions/_shared/auth.ts databaseHooks) and
   * `profile.getOrCreate` covers the case where that hook failed. Also stamps
   * the landing-page visitor id (if this browser ever hit the landing page) so
   * the funnel can link anonymous view/demo events to this account; anon_id is
   * analytics metadata, never read back into the app.
   */
  async getOrCreateProfile(_user: AuthUser): Promise<UserProfile> {
    const data = await rpc<Tables<'profiles'>>('profile.getOrCreate', { anonId: getAnonId() || null });
    return userProfileFromJson(data);
  },

  async updateProfile(profile: UserProfile): Promise<void> {
    await updateOwnProfile(userProfileToUpdate(profile));
  },

  /**
   * Writes only the training-preference columns. Kept out of
   * userProfileToUpdate so every other profile save keeps working until the
   * 20260610 profiles migration is applied.
   */
  async updateTrainingPrefs(
    _userId: string, // the server writes the session user's row
    prefs: {
      showEngineEvals?: boolean;
      revealBeforeSolve?: boolean;
      autoplayRefutation?: boolean;
      showAnswerOnMiss?: boolean;
      soundsEnabled?: boolean;
      leaderboardOptOut?: boolean;
    },
  ): Promise<void> {
    const patch: TablesUpdate<'profiles'> = {};
    if (prefs.showEngineEvals !== undefined) patch.show_engine_evals = prefs.showEngineEvals;
    if (prefs.revealBeforeSolve !== undefined) patch.reveal_before_solve = prefs.revealBeforeSolve;
    if (prefs.autoplayRefutation !== undefined) patch.autoplay_refutation = prefs.autoplayRefutation;
    if (prefs.showAnswerOnMiss !== undefined) patch.show_answer_on_miss = prefs.showAnswerOnMiss;
    if (prefs.soundsEnabled !== undefined) patch.sounds_enabled = prefs.soundsEnabled;
    if (prefs.leaderboardOptOut !== undefined) patch.leaderboard_opt_out = prefs.leaderboardOptOut;
    if (Object.keys(patch).length === 0) return;
    await updateOwnProfile(patch);
  },

  /**
   * One-time milestone flag (not a user preference) set the first time a
   * /training session starts with a picked focus — backs the "Focused
   * Training" achievement. Fire-and-forget from the caller; safe to call
   * repeatedly since it's a flat `true` write.
   */
  async markUsedTrainingFilter(_userId: string): Promise<void> {
    await updateOwnProfile({ used_training_filter: true });
  },

  /** Same shape as markUsedTrainingFilter — set when the user clicks through to Instagram. */
  async markFollowedInstagram(_userId: string): Promise<void> {
    await updateOwnProfile({ followed_instagram: true });
  },

  /** Selected flair id, or null to clear. Unlock is checked by the caller (cosmetic). */
  async setFlair(_userId: string, flair: string | null): Promise<void> {
    await updateOwnProfile({ flair });
  },

  /** Atomic bump when an /openings review is opened. Returns the new count. */
  async incrementOpeningReviews(): Promise<number> {
    const data = await rpc<number | null>('profile.incrementOpeningReviews');
    return typeof data === 'number' ? data : 0;
  },

  /** Record a Learn chapter as done (idempotent server-side). Returns the distinct count. */
  async markLearnChapterDone(key: string): Promise<number> {
    const data = await rpc<number | null>('profile.markLearnChapterDone', { key });
    return typeof data === 'number' ? data : 0;
  },

  /**
   * Lifetime training totals: minutes (finished sessions, each capped at 120)
   * and distinct active days (≥1 correct drill).
   */
  async getTrainingTotals(): Promise<{ minutes: number; activeDays: number }> {
    const data = await rpc<unknown>('profile.trainingTotals');
    const o = (data ?? {}) as { minutes?: unknown; activeDays?: unknown };
    return {
      minutes: typeof o.minutes === 'number' ? o.minutes : 0,
      activeDays: typeof o.activeDays === 'number' ? o.activeDays : 0,
    };
  },

  /** Atomic server-side bump (no read-modify-write race). Returns the new count. */
  async incrementSharesCount(): Promise<number> {
    const data = await rpc<number | null>('profile.incrementShares');
    return typeof data === 'number' ? data : 0;
  },

  /** Credit the friend whose invite link brought this user here (no-op if not eligible). */
  async claimSignupSource(source: string): Promise<boolean> {
    return (await rpc<boolean>('profile.claimSignupSource', { source })) === true;
  },

  async claimReferral(code: string): Promise<boolean> {
    return (await rpc<boolean>('profile.claimReferral', { code })) === true;
  },

  /**
   * Claim ownerless games played under `username`, then the ownerless
   * blunders of the user's games (one server-side batch).
   */
  async claimAnonymousData(username: string): Promise<void> {
    const userId = await currentUserId();
    if (!userId) return;
    await rpc('profile.claimAnonymousData', { username });
  },
};
