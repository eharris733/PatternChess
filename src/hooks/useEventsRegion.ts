import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAuth } from '../auth/useAuth';
import { guessStateFromTimezone, isUsStateCode } from '../lib/usStates';
import {
  US_COUNTRY,
  eventCountryFromTimezone,
  savedRegion,
  type EventsRegion,
} from '../lib/eventRegions';
import { locateForEvents, updateEventsRegion } from '../services/db/profiles';

/**
 * Where OTB events are listed for (dashboard card, /profile, the weekly
 * email): a country, plus a state in the US. Saved in
 * `profiles.events_country` / `events_state`; until the player saves one, the
 * region is a guess from their approximate location — Cloudflare's IP
 * country and US state (`events.locate`), else the timezone. A guess is never
 * written back, so the weekly email's "Events near you" only goes to players
 * who picked a place.
 *
 * Writes are optimistic through a module-level override so every reader
 * flips together; it clears once the refreshed profile carries the value.
 */
interface OverrideState {
  /** undefined = no pending write; null = cleared. */
  override: EventsRegion | null | undefined;
  error: string | null;
}

const useOverride = create<OverrideState>(() => ({ override: undefined, error: null }));

function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export interface EventsRegionView {
  /** The region to list events for; null = nothing known (pick one). */
  region: EventsRegion | null;
  /** True when `region` is the player's own pick (saved), false for a guess. */
  saved: boolean;
  /** Still working out the guess (location lookup in flight). */
  resolving: boolean;
  /** Last failed write, for an inline message. */
  error: string | null;
  setRegion: (region: EventsRegion | null) => void;
}

export function useEventsRegion(): EventsRegionView {
  const { profile, refreshProfile } = useAuth();
  const override = useOverride((s) => s.override);
  const error = useOverride((s) => s.error);

  const saved =
    override !== undefined ? override : savedRegion(profile?.eventsCountry ?? null, profile?.eventsState ?? null);

  const locate = useQuery({
    queryKey: ['eventsLocate'],
    queryFn: locateForEvents,
    enabled: !!profile && saved === null,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const tz = profile?.timezone ?? browserTimezone();
  const resolving = saved === null && !!profile && locate.isPending;
  const ipCountry = locate.data?.country ?? null;
  const ipGuess: EventsRegion | null = ipCountry
    ? { country: ipCountry, state: ipCountry === US_COUNTRY && isUsStateCode(locate.data?.region) ? locate.data.region : guessStateFromTimezone(tz) }
    : null;
  const tzState = guessStateFromTimezone(tz);
  const tzCountry = eventCountryFromTimezone(tz);
  const tzGuess: EventsRegion | null = tzState
    ? { country: US_COUNTRY, state: tzState }
    : tzCountry
      ? { country: tzCountry, state: null }
      : null;

  const setRegion = (region: EventsRegion | null) => {
    if (!profile) return;
    useOverride.setState({ override: region, error: null });
    void updateEventsRegion(region)
      .then(() => refreshProfile())
      .then(() => useOverride.setState((s) => (s.override === region ? { override: undefined } : s)))
      .catch((err) => {
        console.warn('[events-region] persist failed', err);
        useOverride.setState((s) =>
          s.override === region ? { override: undefined, error: 'Could not save your location. Try again.' } : s,
        );
      });
  };

  return {
    region: saved ?? ipGuess ?? (resolving ? null : tzGuess),
    saved: saved !== null,
    resolving,
    error,
    setRegion,
  };
}
