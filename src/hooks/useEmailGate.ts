import { useAuth } from '../auth/useAuth';
import { needsContactEmail } from '../lib/emailGate';
import { useOnboardingStore } from '../state/onboardingStore';
import type { GateState } from './useOnboardingGate';

/**
 * Whether the Lichess email step (`OnboardingEmail`) preempts the route. It
 * stays up after saving (the "check your inbox" note) until Continue clears
 * `savedEmail`. Lichess accounts wait on the profile instead of flashing the
 * app before the step appears.
 */
export function useEmailGate(): GateState {
  const { user, profile, loading } = useAuth();
  const savedEmail = useOnboardingStore((s) => s.savedEmail);
  if (loading) return 'loading';
  if (!user || user.provider !== 'lichess') return 'hide';
  if (!profile) return 'loading';
  if (savedEmail) return 'show';
  return needsContactEmail(user, profile) ? 'show' : 'hide';
}
