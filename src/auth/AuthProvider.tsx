import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import { takeStoredReferral } from '../lib/referral';
import type { UserProfile } from '../models/userProfile';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import { hasStoredTheme, useThemeStore } from '../state/themeStore';
import { setCachedUserId } from '../services/db/currentUser';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

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
  window.history.replaceState({}, '', url.pathname + url.search);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const p = await authService.getProfile();
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The user whose profile is loaded (or loading). supabase-js emits
    // SIGNED_IN on every boot and every tab refocus (_recoverAndRefresh), not
    // just on a real sign-in, so profile/referral work is keyed on the user id
    // changing rather than on the event.
    let loadedUserId: string | null = null;

    const adoptSession = (next: Session | null) => {
      setCachedUserId(next?.user?.id ?? null);
      // Keep the old object when nothing meaningful changed, so the context
      // (and its ~60 consumers) don't re-render on every auth event.
      setSession((prev) =>
        prev?.user?.id === next?.user?.id && prev?.access_token === next?.access_token
          ? prev
          : next,
      );
      const nextUser = next?.user ?? null;
      if (!nextUser) {
        loadedUserId = null;
        setProfile(null);
        return;
      }
      if (nextUser.id === loadedUserId) return;
      loadedUserId = nextUser.id;
      // Deferred out of the auth callback: supabase calls started inside it
      // queue behind the gotrue lock the callback runs under.
      setTimeout(() => {
        void authService
          .getOrCreateProfile(nextUser)
          .then((p) => {
            if (cancelled || loadedUserId !== p.id) return;
            setProfile(p);
            const ref = takeStoredReferral();
            if (ref && ref !== p.referralCode) {
              void authService
                .claimReferral(ref)
                .catch((err) => console.warn('[auth] claim_referral failed', err));
            }
          })
          .catch((err) => {
            console.warn('[auth] getOrCreateProfile failed', err);
            // Let the next auth event retry.
            if (loadedUserId === nextUser.id) loadedUserId = null;
          });
      }, 0);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        adoptSession(data.session ?? null);
        scrubAuthFromUrl();
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      adoptSession(nextSession ?? null);
      scrubAuthFromUrl();
      if (event === 'SIGNED_OUT') {
        useSyncStore.getState().reset();
        useOnboardingStore.getState().reset();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

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

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, profile, loading, refreshProfile }),
    [session, profile, loading, refreshProfile],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
