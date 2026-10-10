import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

/** Count of positions due now — for surfaces that only show the number. */
export function useDueCount(opts?: { excludeKind?: 'opening' | 'endgame' | 'tactic' }) {
  const { user } = useAuth();
  const excludeKind = opts?.excludeKind ?? null;
  return useQuery({
    queryKey: ['blunders', 'dueCount', user?.id, excludeKind],
    queryFn: () =>
      supabaseService.getDueCount({ userId: user?.id, excludeKind: excludeKind ?? undefined }),
    enabled: !!user,
  });
}
