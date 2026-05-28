import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useOnboardingGate } from '../hooks/useOnboardingGate';
import { OnboardingFlow } from '../components/OnboardingFlow';

// Routes that bypass the onboarding gate even when it would otherwise fire.
// /profile is essential so the user can fix a typo in their username; the
// dev-only routes shouldn't be blocked by application state.
const ONBOARDING_BYPASS = new Set(['/profile', '/__sandbox', '/__engine-test']);

export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const gate = useOnboardingGate();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (gate === 'show' && !ONBOARDING_BYPASS.has(location.pathname)) {
    return <OnboardingFlow />;
  }

  return <Outlet />;
}
