import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService, type SupporterStatus } from '../services/supabaseService';

/**
 * The player's supporter status: the single gate check for supporter perks
 * (flair, courses past the free days, articles, skipping unlock gates).
 * `null` = never started a checkout.
 */
export function useSupporter(): { status: SupporterStatus | null; isSupporter: boolean; isPending: boolean } {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['supporter', user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => supabaseService.getMySupporterStatus(),
  });
  const status = q.data ?? null;
  return { status, isSupporter: !!status?.active, isPending: q.isPending };
}
