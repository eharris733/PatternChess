import { useAuth } from '../auth/useAuth';
import { featureVisible, type Feature } from '../lib/features';

/** Whether the signed-in user may see an unreleased feature (see src/lib/features.ts). */
export function useFeature(feature: Feature): boolean {
  const { user } = useAuth();
  return featureVisible(feature, user?.email);
}
