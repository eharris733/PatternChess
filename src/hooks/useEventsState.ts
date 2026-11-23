import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { useAuth } from '../auth/useAuth';
import { isUsStateCode, guessStateFromTimezone, type UsStateCode } from '../lib/usStates';
import { locateForEvents, updateEventsState } from '../services/db/profiles';

/**
 * The US state OTB events are listed for (dashboard card; /profile may add a
 * picker). Saved in `profiles.events_state`; until the player saves one, the
 * state is a guess: Cloudflare's IP region (`events.locate`), else the
 * timezone (`guessStateFromTimezone`). A guess is never written back, so the
 * weekly email's "Events near you" only goes to players who picked a state.
 *
 * Writes are optimistic through a module-level override so every reader
 * flips together; it clears once the refreshed profile carries the value.
 */
interface OverrideState {
  /** undefined = no pending write; null = cleared. */
  override: string | null | undefined;
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

export interface EventsStateView {
  /** The state to list events for; null = none (outside the US with nothing saved). */
  state: UsStateCode | null;
  /** True when `state` is the player's own pick (saved), false for a guess. */
  saved: boolean;
  /** Still working out the guess (location lookup in flight). */
  resolving: boolean;
  /** Last failed write, for an inline message. */
  error: string | null;
  setState: (state: UsStateCode | null) => void;
}

export function useEventsState(): EventsStateView {
  const { profile, refreshProfile } = useAuth();
  const override = useOverride((s) => s.override);
  const error = useOverride((s) => s.error);

  const savedRaw = override !== undefined ? override : (profile?.eventsState ?? null);
  const saved = isUsStateCode(savedRaw) ? savedRaw : null;

  const locate = useQuery({
    queryKey: ['eventsLocate'],
    queryFn: locateForEvents,
    enabled: !!profile && saved === null,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const tzGuess = guessStateFromTimezone(profile?.timezone ?? browserTimezone());
  const ipGuess = isUsStateCode(locate.data?.region) ? locate.data.region : null;
  const resolving = saved === null && !!profile && locate.isPending;

  const setState = (state: UsStateCode | null) => {
    if (!profile) return;
    useOverride.setState({ override: state, error: null });
    void updateEventsState(state)
      .then(() => refreshProfile())
      .then(() => useOverride.setState((s) => (s.override === state ? { override: undefined } : s)))
      .catch((err) => {
        console.warn('[events-state] persist failed', err);
        useOverride.setState((s) =>
          s.override === state ? { override: undefined, error: 'Could not save your state. Try again.' } : s,
        );
      });
  };

  return {
    state: saved ?? ipGuess ?? (resolving ? null : tzGuess),
    saved: saved !== null,
    resolving,
    error,
    setState,
  };
}
