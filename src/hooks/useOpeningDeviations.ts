import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { summarizeDeviations } from '../chess/openingDeviation';
import { OPENING_DEVIATIONS_QUERY_KEY } from '../services/openingDeviationService';
import { supabaseService } from '../services/supabaseService';

/** Per-opening theory-exit summaries for /openings (refreshed by the scan as it writes). */
export function useOpeningDeviations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...OPENING_DEVIATIONS_QUERY_KEY, user?.id],
    queryFn: async () => summarizeDeviations(await supabaseService.getDeviations()),
    enabled: !!user,
    staleTime: 60_000,
  });
}
