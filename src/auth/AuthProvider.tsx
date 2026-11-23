import { createContext, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authClient, isPlaceholderEmail } from '../lib/authClient';
import { queryClient } from '../lib/queryClient';
import { clearPersistedQueries, shouldPersistQuery } from '../lib/queryPersist';
import { authService } from '../services/authService';
import { takeStoredReferral } from '../lib/referral';
import { takeStoredSignupSource } from '../lib/signupSource';
import type { UserProfile } from '../models/userProfile';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import { hasStoredTheme, useThemeStore } from '../state/themeStore';
import { hasStoredPieceSet, usePieceSetStore } from '../state/pieceSetStore';
import { updateCosmetics } from '../services/db/cosmetics';
import { setCachedUserId } from '../services/db/currentUser';

export type AuthProviderId = 'google' | 'lichess' | 'email';

/**
 * The signed-in user. `email` is null for Lichess accounts (better-auth stores
 * a `<id>@lichess.invalid` placeholder, which never leaves this mapping).
 * `user_metadata` / `app_metadata` mirror the Supabase fields the app used to
 * read, so older readers keep working.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  provider: AuthProviderId;
  createdAt: string | null;
  user_metadata: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
    preferred_username?: string;
  };
  app_metadata: { provider: AuthProviderId };
}

export interface AuthSession {
  /** better-auth session id. */
  id: string;
  user: AuthUser;
  expiresAt: string | null;
}

export interface AuthContextValue {
  session: AuthSession | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  /** Re-read the session from the server (e.g. after a profile/email change). */
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  refreshSession: async () => {},
  signOut: async () => {},
});

interface RawUser {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean | null;
  createdAt?: Date | string | null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export function toAuthUser(raw: RawUser): AuthUser {
  const lichess = isPlaceholderEmail(raw.email);
  const provider: AuthProviderId = lichess ? 'lichess' : raw.emailVerified ? 'google' : 'email';
  const name = raw.name || undefined;
  const image = raw.image || undefined;
  return {
    id: raw.id,
    email: lichess ? null : (raw.email ?? null),
    name: raw.name ?? null,
    image: raw.image ?? null,
    emailVerified: !!raw.emailVerified,
    provider,
    createdAt: iso(raw.createdAt),
    user_metadata: {
      full_name: lichess ? undefined : name,
      name,
      avatar_url: image,
      picture: image,
      preferred_username: lichess ? name : undefined,
    },
    app_metadata: { provider },
  };
}

function scrubAuthFromUrl() {
  const url = new URL(window.location.href);
  const dirty =
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    url.searchParams.has('error_description') ||
    url.hash.includes('access_token');
  if (!dirty) return;
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.hash = '';
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}

/** Never leave one account's cached games/stats for the next sign-in. */
function clearUserState() {
  queryClient.removeQueries({ predicate: shouldPersistQuery });
  void clearPersistedQueries();
  useSyncStore.getState().reset();
  useOnboardingStore.getState().reset();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // The user whose profile is loaded (or loading). The session atom re-emits
  // on every refetch (window focus etc.), so profile/referral work is keyed on
  // the user id changing, not on the emission.
  const loadedUserId = useRef<string | null>(null);
  const prevUserId = useRef<string | null | undefined>(undefined);

  const rawUser = (data?.user ?? null) as RawUser | null;
  const rawSession = (data?.session ?? null) as { id: string; expiresAt?: Date | string | null } | null;
  const userKey = rawUser
    ? [rawUser.id, rawUser.email, rawUser.name, rawUser.image, rawUser.emailVerified].join('|')
    : '';
  const sessionKey = rawSession ? `${rawSession.id}|${iso(rawSession.expiresAt)}` : '';

  // Keep the same object while nothing meaningful changed, so the context (and
  // its ~80 consumers) don't re-render on every refetch.
  const session = useMemo<AuthSession | null>(
    () =>
      rawUser && rawSession
        ? { id: rawSession.id, user: toAuthUser(rawUser), expiresAt: iso(rawSession.expiresAt) }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userKey, sessionKey],
  );
  const userId = session?.user.id ?? null;
  const loading = isPending && !data;

  const refreshProfile = useCallback(async () => {
    try {
      const p = await authService.getProfile();
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const signOut = useCallback(async () => {
    await authService.signOut();
  }, []);

  // Session changes: cache the id, clear state on sign-out / account switch,
  // and load (or create) the profile for a newly signed-in user.
  useEffect(() => {
    if (loading) return;
    setCachedUserId(userId);
    scrubAuthFromUrl();
    const prev = prevUserId.current;
    prevUserId.current = userId;
    if (prev && prev !== userId) clearUserState();

    const user = session?.user ?? null;
    if (!user) {
      loadedUserId.current = null;
      setProfile(null);
      return;
    }
    if (user.id === loadedUserId.current) return;
    loadedUserId.current = user.id;
    let cancelled = false;
    void authService
      .getOrCreateProfile(user)
      .then((p) => {
        if (cancelled || loadedUserId.current !== p.id) return;
        setProfile(p);
        const ref = takeStoredReferral();
        if (ref && ref !== p.referralCode) {
          void authService
            .claimReferral(ref)
            .catch((err) => console.warn('[auth] claim_referral failed', err));
        }
        const source = takeStoredSignupSource();
        if (source) {
          void authService
            .claimSignupSource(source)
            .catch((err) => console.warn('[auth] claim_signup_source failed', err));
        }
      })
      .catch((err) => {
        console.warn('[auth] getOrCreateProfile failed', err);
        // Let the next session emission retry.
        if (loadedUserId.current === user.id) loadedUserId.current = null;
      });
    return () => {
      cancelled = true;
      // StrictMode/unmount: allow the re-run to load again.
      if (loadedUserId.current === user.id) loadedUserId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, userId]);

  const timeControlsKey = profile
    ? [...profile.preferredTimeControls].sort().join(',')
    : '';
  useEffect(() => {
    if (profile) {
      void useSyncStore.getState().startForProfile(profile);
    }
  }, [
    profile?.id,
    profile?.lichessUsername,
    profile?.chesscomUsername,
    profile?.preferredRatedOnly,
    timeControlsKey,
  ]);

  // Reconcile the signed-in profile's board theme with this device once per
  // profile load. The device's own choice is authoritative: a device that has
  // already picked a theme keeps it (so a stale/default server value can't
  // revert it across sessions), and we sync that choice back up so the server
  // converges. Only a device with no local choice adopts the server theme.
  useEffect(() => {
    if (!profile) return;
    const localTheme = useThemeStore.getState().theme;
    if (!hasStoredTheme()) {
      if (profile.boardTheme && profile.boardTheme !== localTheme) {
        useThemeStore.getState().setTheme(profile.boardTheme);
      }
      return;
    }
    if (profile.boardTheme !== localTheme) {
      const next = { ...profile, boardTheme: localTheme };
      setProfile(next);
      void authService
        .updateProfile(next)
        .catch((err) => console.warn('[auth] sync boardTheme failed', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Same reconciliation for the piece set (profiles.piece_set, migration 0005).
  useEffect(() => {
    if (!profile) return;
    const local = usePieceSetStore.getState().pieceSet;
    if (!hasStoredPieceSet()) {
      if (profile.pieceSet !== local) usePieceSetStore.getState().setPieceSet(profile.pieceSet);
      return;
    }
    if (profile.pieceSet !== local) {
      setProfile((p) => (p ? { ...p, pieceSet: local } : p));
      void updateCosmetics({ pieceSet: local }).catch((err) => console.warn('[auth] sync pieceSet failed', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile,
      refreshSession,
      signOut,
    }),
    [session, profile, loading, refreshProfile, refreshSession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
