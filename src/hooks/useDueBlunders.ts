import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

export function useDueBlunders(gameIds?: string[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: gameIds ? ['blunders', 'forGames', gameIds] : ['blunders', 'due', user?.id],
    queryFn: async () => {
      if (gameIds && gameIds.length > 0) {
        return supabaseService.getBlundersForGames(gameIds);
      }
      return supabaseService.getDueBlunders({ userId: user?.id });
    },
    enabled: !!user,
  });
}
