import { useQuery } from '@tanstack/react-query';
import { supabaseService, type LandingStats } from '../services/supabaseService';
import snapshot from '../generated/landingStats.json';

/**
 * Build-time snapshot of the same RPC (scripts/fetch-landing-stats.mjs). Used
 * as placeholder data so the social-proof card renders on first paint — and
 * in the prerendered HTML — instead of popping in when the network returns.
 */
export const LANDING_STATS_SNAPSHOT: LandingStats = snapshot;

/**
 * Global social-proof stats for the landing page. No auth gate — landing
 * visitors are anonymous. Long client cache on top of the RPC's own 6h
 * server-side cache, so a session calls the RPC at most once.
 */
export function useLandingStats() {
  return useQuery({
    queryKey: ['landing', 'stats'],
    queryFn: () => supabaseService.getLandingStats(),
    placeholderData: LANDING_STATS_SNAPSHOT,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
