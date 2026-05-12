import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

export function useGames() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['games', user?.id],
    queryFn: () => supabaseService.getGames({ userId: user?.id }),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });
}

export function useGame(gameId: string | undefined) {
  return useQuery({
    queryKey: ['game', gameId],
    queryFn: () => supabaseService.getGame(gameId!),
    enabled: !!gameId,
  });
}
