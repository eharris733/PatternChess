import { useQuery } from '@tanstack/react-query';
import { fetchUpcomingEvents } from '../services/eventsApiService';
import { regionHasListings, type EventsRegion } from '../lib/eventRegions';

/** Upcoming OTB tournaments for a region (a US state or a country) from
 * events.patternchess.com. The listing changes twice a week (scrape cadence),
 * so cache aggressively. Nothing is fetched for a region without listings. */
export function useUpcomingEvents(region: EventsRegion | null) {
  const listed = regionHasListings(region);
  return useQuery({
    queryKey: ['otbEvents', region?.country ?? null, region?.state ?? null],
    queryFn: () => fetchUpcomingEvents(region as EventsRegion),
    enabled: listed,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
