import { useQuery } from '@tanstack/react-query';
import {
  getPublicLeaderboard,
  publicLeaderboardFromJson,
  type PublicLeaderboard,
} from '../services/db/leaderboard';
import snapshot from '../generated/landingLeaderboard.json';

/**
 * Build-time snapshot of `public_leaderboard` (scripts/fetch-landing-stats.mjs),
 * used as placeholder data so the landing board is in the prerendered HTML.
 */
export const PUBLIC_LEADERBOARD_SNAPSHOT: PublicLeaderboard = publicLeaderboardFromJson(snapshot);

/** Landing-page weekly top 5. No auth gate — landing visitors are anonymous. */
export function usePublicLeaderboard() {
  return useQuery({
    queryKey: ['landing', 'leaderboard'],
    queryFn: getPublicLeaderboard,
    placeholderData: PUBLIC_LEADERBOARD_SNAPSHOT,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
