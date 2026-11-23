import { useAuth } from '../auth/useAuth';
import { needsContactEmail } from '../lib/emailGate';
import type { GateState } from './useOnboardingGate';

/**
 * Whether the Lichess email step (`OnboardingEmail`) preempts the route: it
 * stays up until the address is confirmed (the "check your inbox" state
 * re-reads the profile while it waits). Lichess accounts wait on the profile
 * instead of flashing the app before the step appears.
 */
export function useEmailGate(): GateState {
  const { user, profile, loading } = useAuth();
  if (loading) return 'loading';
  if (!user || user.provider !== 'lichess') return 'hide';
  if (!profile) return 'loading';
  return needsContactEmail(user, profile) ? 'show' : 'hide';
}
