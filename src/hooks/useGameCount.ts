import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

/**
 * The player's total game count (one `games.totalCount` call), shared with the
 * onboarding gate's query key. Never persisted (queryPersist excludes it), so
 * a reload right after the first import never shows a stale "0 games".
 */
export function useGameCount() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ['games', 'totalCount', profile?.id ?? null],
    queryFn: () => supabaseService.getTotalGameCount(),
    enabled: !!profile,
    staleTime: 60_000,
  });
}
