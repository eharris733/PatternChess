import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { useGames } from './useGames';
import { scanForScenarios } from '../services/endgameScenarioService';

/**
 * Dropped-endgame scenarios, shared between /endgames and the dashboard card
 * (same query key = one scan feeds both). The scan upserts to Supabase, so the
 * staleTime keeps remounts from re-running it back to back.
 */
export function useEndgameScenarios() {
  const { user } = useAuth();
  const games = useGames().data;
  return useQuery({
    queryKey: ['endgameScenarios', user?.id],
    queryFn: () => scanForScenarios(games ?? []),
    enabled: !!user && !!games,
    staleTime: 5 * 60_000,
  });
}
