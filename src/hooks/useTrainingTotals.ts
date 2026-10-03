import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { supabaseService } from '../services/supabaseService';

/** Lifetime training minutes + distinct active days (training_totals RPC). */
export function useTrainingTotals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['training', 'totals', user?.id],
    queryFn: () => authService.getTrainingTotals(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}

/** Games where the user was still in theory at move 10 (opening achievements). */
export function useBookDepthGames() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['openings', 'bookDepth', user?.id],
    queryFn: () => supabaseService.countBookDepthGames(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}
