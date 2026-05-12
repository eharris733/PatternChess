import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { useOnboardingStore } from '../state/onboardingStore';

export type GateState = 'loading' | 'show' | 'hide';

/**
 * Returns whether the new-user onboarding screen should preempt the route.
 *
 * Fires when: a profile is loaded, has a connected lichess/chess.com username,
 * the user has zero games in the DB, and they haven't already dismissed
 * onboarding this session. Latched: once we decide to show it, we keep
 * showing it until the user clicks "Continue" — so games landing mid-sync
 * don't flip the gate off underneath them.
 */
export function useOnboardingGate(): GateState {
  const { profile, loading: authLoading } = useAuth();
  const active = useOnboardingStore((s) => s.active);
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const setActive = useOnboardingStore((s) => s.setActive);

  const hasUsername = !!(profile?.lichessUsername || profile?.chesscomUsername);

  const gameCountQuery = useQuery({
    queryKey: ['games', 'totalCount', profile?.id ?? null],
    queryFn: () => supabaseService.getTotalGameCount(),
    enabled: !!profile && hasUsername && !dismissed && !active,
    staleTime: 60_000,
  });

  // Latch the gate to "show" as soon as we observe count === 0 with a
  // connected username. Subsequent re-renders read from `active`, so games
  // landing mid-import don't flip us off the screen.
  useEffect(() => {
    if (dismissed || active) return;
    if (!profile || !hasUsername) return;
    if (gameCountQuery.data === 0) setActive();
  }, [dismissed, active, profile, hasUsername, gameCountQuery.data, setActive]);

  if (authLoading) return 'loading';
  if (!profile || !hasUsername) return 'hide';
  if (dismissed) return 'hide';
  if (active) return 'show';
  if (gameCountQuery.isLoading) return 'loading';
  return 'hide';
}
