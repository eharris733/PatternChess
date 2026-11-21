import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { detectTimezone, localDate } from '../services/streakService';

/**
 * Synced games played today (profile timezone), for the daily plan's Play
 * step. Keyed under ['games'] so a sync that inserts games refreshes it.
 */
export function useGamesPlayedToday() {
  const { user, profile } = useAuth();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  return useQuery({
    queryKey: ['games', 'playedToday', user?.id, today],
    queryFn: async () => {
      // 36h covers every timezone's "today"; the local-date filter does the rest.
      const since = new Date(Date.now() - 36 * 3_600_000);
      const played = await supabaseService.getGamesPlayedSince(since);
      return played.filter((d) => localDate(tz, d) === today).length;
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
