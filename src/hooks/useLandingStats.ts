import { useQuery } from '@tanstack/react-query';
import { supabaseService } from '../services/supabaseService';

/**
 * Global social-proof stats for the landing page. No auth gate — landing
 * visitors are anonymous. Long client cache on top of the RPC's own 6h
 * server-side cache, so a session calls the RPC at most once.
 */
export function useLandingStats() {
  return useQuery({
    queryKey: ['landing', 'stats'],
    queryFn: () => supabaseService.getLandingStats(),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
