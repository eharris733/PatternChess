import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import type { LeaderboardMetric, LeaderboardWindow } from '../services/db/leaderboard';

export function useLeaderboard(metric: LeaderboardMetric, window: LeaderboardWindow) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['leaderboard', metric, window, user?.id],
    queryFn: () => supabaseService.getLeaderboard(metric, window),
    enabled: !!user,
    staleTime: 60_000,
  });
}
