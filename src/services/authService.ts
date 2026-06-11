import { supabase } from '../lib/supabase';
import { getAnonId } from '../lib/anonId';
import { ALL_TIME_CONTROLS } from './chessApiService';
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
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select()
      .eq('id', user.id)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return userProfileFromJson(data);
  },

  async getOrCreateProfile(): Promise<UserProfile> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
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
    prefs: { showEngineEvals?: boolean; revealBeforeSolve?: boolean },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (prefs.showEngineEvals !== undefined) patch.show_engine_evals = prefs.showEngineEvals;
    if (prefs.revealBeforeSolve !== undefined) patch.reveal_before_solve = prefs.revealBeforeSolve;
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
  },

  async claimAnonymousData(username: string): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return;

    await supabase
      .from('games')
      .update({ user_id: user.id })
      .eq('username', username)
      .is('user_id', null);

    // Claim blunders through the user's now-owned games. (Previously this went
    // through a `claim_blunders_for_user` RPC, but that function isn't deployed
    // and always 404'd straight into this path — so do it directly.)
    const { data: games } = await supabase.from('games').select('id').eq('user_id', user.id);
    const gameIds = (games ?? []).map((g: any) => g.id as string);
    if (gameIds.length > 0) {
      await supabase
        .from('blunders')
        .update({ user_id: user.id })
        .in('game_id', gameIds)
        .is('user_id', null);
    }
  },
};
