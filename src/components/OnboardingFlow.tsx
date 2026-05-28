import { useAuth } from '../auth/useAuth';
import { OnboardingConnect } from './OnboardingConnect';
import { OnboardingImport } from './OnboardingImport';

/**
 * New-user onboarding flow. Picks the sub-step from live profile state:
 * - no linked account yet  → connect step (enter usernames + game-type prefs)
 * - account linked         → import-progress step (sync is already running)
 */
export function OnboardingFlow() {
  const { profile } = useAuth();
  const hasUsername = !!(profile?.lichessUsername || profile?.chesscomUsername);
  return hasUsername ? <OnboardingImport /> : <OnboardingConnect />;
}
