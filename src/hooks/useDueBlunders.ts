import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

/**
 * The training queue source: the due queue by default, a game's blunders
 * for `gameIds`, or specific drills (due or not) for `blunderIds`.
 */
export function useDueBlunders(gameIds?: string[], blunderIds?: string[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: blunderIds
      ? ['blunders', 'byIds', blunderIds]
      : gameIds
        ? ['blunders', 'forGames', gameIds]
        : ['blunders', 'due', user?.id],
    queryFn: async () => {
      if (blunderIds) return supabaseService.getBlundersByIds(blunderIds);
      if (gameIds && gameIds.length > 0) {
        return supabaseService.getBlundersForGames(gameIds);
      }
      return supabaseService.getDueBlunders({ userId: user?.id });
    },
    enabled: !!user,
    placeholderData: keepPreviousData,
  });
}
