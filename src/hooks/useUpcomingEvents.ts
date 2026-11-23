import { useQuery } from '@tanstack/react-query';
import { fetchUpcomingEvents } from '../services/eventsApiService';

/** Upcoming OTB tournaments in `state` from events.patternchess.com. The
 * listing changes twice a week (scrape cadence), so cache aggressively.
 * `state` null = nothing to fetch (no saved state and no guess). */
export function useUpcomingEvents(state: string | null) {
  return useQuery({
    queryKey: ['otbEvents', state],
    queryFn: () => fetchUpcomingEvents(state as string),
    enabled: state !== null,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
