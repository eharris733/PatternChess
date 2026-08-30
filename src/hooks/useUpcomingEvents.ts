import { useQuery } from '@tanstack/react-query';
import { fetchUpcomingEvents } from '../services/eventsApiService';

/** Upcoming OTB tournaments from events.patternchess.com. The listing
 * changes twice a week (scrape cadence), so cache aggressively. */
export function useUpcomingEvents() {
  return useQuery({
    queryKey: ['otbEvents'],
    queryFn: fetchUpcomingEvents,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
