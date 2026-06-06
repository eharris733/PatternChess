import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

/**
 * Distribution of the user's positions across the spaced-repetition ladder.
 * Keyed under the shared ['blunders'] prefix so a finished drill session (which
 * invalidates ['blunders']) refreshes the timeline too.
 */
export function useCycleDistribution() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blunders', 'cycleDistribution', user?.id],
    queryFn: () => supabaseService.getCycleDistribution(),
    enabled: !!user,
    staleTime: 30_000,
  });
}
