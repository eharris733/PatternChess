import { createContext, ReactNode, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import type { UserProfile } from '../models/userProfile';
import { useSyncStore } from '../state/syncStore';
import { useOnboardingStore } from '../state/onboardingStore';
import { useThemeStore } from '../state/themeStore';

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

  const refreshProfile = async () => {
    try {
      const p = await authService.getProfile();
      setProfile(p);
    } catch {
      setProfile(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        scrubAuthFromUrl();
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null);
      scrubAuthFromUrl();
      if (event === 'SIGNED_IN' && nextSession) {
        void authService
          .getOrCreateProfile()
          .then((p) => {
            setProfile(p);
            void useSyncStore.getState().startForProfile(p);
          })
          .catch((err) => console.warn('[auth] getOrCreateProfile failed', err));
      }
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        useSyncStore.getState().reset();
        useOnboardingStore.getState().reset();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user) {
      void refreshProfile();
    } else {
      setProfile(null);
    }
  }, [session?.user?.id]);

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

  useEffect(() => {
    if (profile?.boardTheme && profile.boardTheme !== useThemeStore.getState().theme) {
      useThemeStore.getState().setTheme(profile.boardTheme);
    }
  }, [profile?.boardTheme]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
