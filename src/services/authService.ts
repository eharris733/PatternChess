import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getAnonId } from '../lib/anonId';
import type { TablesUpdate } from '../lib/database.types';
import { ALL_TIME_CONTROLS } from './chessApiService';
import { fetchAllRows, fetchInChunks } from './db/paginate';
import { currentUserId } from './db/currentUser';
import {
  UserProfile,
  userProfileFromJson,
  userProfileToInsert,
  userProfileToUpdate,
} from '../models/userProfile';

export const authService = {
  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw error;
  },

  async signInWithLichess(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      // 'custom:lichess' isn't in supabase-js's Provider union yet.
      provider: 'custom:lichess' as any,
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw error;
  },

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getProfile(): Promise<UserProfile | null> {
    // Cached session id, not getUser(): refreshProfile runs often (flair,
    // prefs, achievements) and getUser() is a network call held under the
    // gotrue lock — see currentUserId. RLS scopes the read either way.
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select()
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return userProfileFromJson(data);
  },

  /**
   * Pass the session's user when you have it: getUser() is a network round
   * trip held under the gotrue lock, and RLS verifies auth.uid() server-side
   * anyway.
   */
  async getOrCreateProfile(sessionUser?: User): Promise<UserProfile> {
    const user = sessionUser ?? (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error('Not authenticated');

    const { data: existing } = await supabase
      .from('profiles')
      .select()
      .eq('id', user.id)
      .maybeSingle();

    if (existing) return userProfileFromJson(existing);

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const isLichess =
      (user.app_metadata as Record<string, unknown> | undefined)?.provider === 'custom:lichess';
    // Lichess userinfo (/api/account) carries the username under a non-standard
    // key; try the likely candidates. Confirmed against the live user object.
    const lichessUsername = isLichess
      ? ((meta.preferred_username as string | undefined) ??
          (meta.user_name as string | undefined) ??
          (meta.username as string | undefined) ??
          (meta.name as string | undefined) ??
          null)
      : null;
    const profile: UserProfile = {
      id: user.id,
      displayName:
        (meta.full_name as string | undefined) ??
        (meta.name as string | undefined) ??
        lichessUsername ??
        user.email?.split('@')[0] ??
        null,
      avatarUrl:
        (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined) ?? null,
      lichessUsername,
      chesscomUsername: null,
      preferredRatedOnly: false,
      preferredTimeControls: [...ALL_TIME_CONTROLS],
      lastSyncedLichessAt: null,
      lastSyncedChesscomAt: null,
      createdAt: new Date(),
      currentStreakDays: 0,
      longestStreakDays: 0,
      lastDrillLocalDate: null,
      timezone: null,
      boardTheme: 'default',
      showEngineEvals: false,
      revealBeforeSolve: false,
      autoplayRefutation: true,
      showAnswerOnMiss: false,
      usedTrainingFilter: false,
      soundsEnabled: true,
      leaderboardOptOut: false,
      followedInstagram: false,
      sharesCount: 0,
      referralCode: null,
      referralsCount: 0,
      openingReviewsOpened: 0,
      learnChaptersDone: [],
      flair: null,
    };
    // Stamp the landing-page visitor id (if this browser ever hit the landing
    // page) so the funnel can link anonymous view/demo events to this account.
    // anon_id lives only in the DB, not on the UserProfile model — it's
    // analytics metadata, never read back into the app.
    const anonId = getAnonId();
    const { error: insertError } = await supabase
      .from('profiles')
      .insert({ ...userProfileToInsert(profile), anon_id: anonId || null });
    if (insertError) throw insertError;
    return profile;
  },

  async updateProfile(profile: UserProfile): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update(userProfileToUpdate(profile))
      .eq('id', profile.id);
    if (error) throw error;
  },

  /**
   * Writes only the training-preference columns. Kept out of
   * userProfileToUpdate so every other profile save keeps working until the
   * 20260610 profiles migration is applied.
   */
  async updateTrainingPrefs(
    userId: string,
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
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
  },

  /**
   * One-time milestone flag (not a user preference) set the first time a
   * /training session starts with a picked focus — backs the "Focused
   * Training" achievement. Fire-and-forget from the caller; safe to call
   * repeatedly since it's a flat `true` write.
   */
  async markUsedTrainingFilter(userId: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ used_training_filter: true })
      .eq('id', userId);
    if (error) throw error;
  },

  /** Same shape as markUsedTrainingFilter — set when the user clicks through to Instagram. */
  async markFollowedInstagram(userId: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ followed_instagram: true })
      .eq('id', userId);
    if (error) throw error;
  },

  /** Selected flair id, or null to clear. Unlock is checked by the caller (cosmetic). */
  async setFlair(userId: string, flair: string | null): Promise<void> {
    const { error } = await supabase.from('profiles').update({ flair }).eq('id', userId);
    if (error) throw error;
  },

  /** Atomic bump when an /openings review is opened. Returns the new count. */
  async incrementOpeningReviews(): Promise<number> {
    const { data, error } = await supabase.rpc('increment_opening_reviews');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  /** Record a Learn chapter as done (idempotent server-side). Returns the distinct count. */
  async markLearnChapterDone(key: string): Promise<number> {
    const { data, error } = await supabase.rpc('mark_learn_chapter_done', { key });
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  /**
   * Lifetime training totals: minutes (finished sessions, each capped at 120)
   * and distinct active days (≥1 correct drill).
   */
  async getTrainingTotals(): Promise<{ minutes: number; activeDays: number }> {
    const { data, error } = await supabase.rpc('training_totals');
    if (error) throw error;
    const o = (data ?? {}) as { minutes?: unknown; activeDays?: unknown };
    return {
      minutes: typeof o.minutes === 'number' ? o.minutes : 0,
      activeDays: typeof o.activeDays === 'number' ? o.activeDays : 0,
    };
  },

  /** Atomic server-side bump (no read-modify-write race). Returns the new count. */
  async incrementSharesCount(): Promise<number> {
    const { data, error } = await supabase.rpc('increment_shares_count');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  },

  /** Credit the friend whose invite link brought this user here (no-op if not eligible). */
  async claimSignupSource(source: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('claim_signup_source', { source });
    if (error) throw error;
    return data === true;
  },

  async claimReferral(code: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('claim_referral', { code });
    if (error) throw error;
    return data === true;
  },

  async claimAnonymousData(username: string): Promise<void> {
    const userId = await currentUserId();
    if (!userId) return;
    const user = { id: userId };

    await supabase
      .from('games')
      .update({ user_id: user.id })
      .eq('username', username)
      .is('user_id', null);

    // Claim blunders through the user's now-owned games. (Previously this went
    // through a `claim_blunders_for_user` RPC, but that function isn't deployed
    // and always 404'd straight into this path — so do it directly.)
    // Paged + chunked: a big history overflows both the 1000-row read cap
    // and the URL length of one `.in()` list.
    const games = await fetchAllRows(() =>
      supabase.from('games').select('id').eq('user_id', user.id).order('id'),
    );
    await fetchInChunks(
      games.map((g) => g.id),
      async (chunk) => {
        await supabase
          .from('blunders')
          .update({ user_id: user.id })
          .in('game_id', chunk)
          .is('user_id', null);
        return [];
      },
    );
  },
};
