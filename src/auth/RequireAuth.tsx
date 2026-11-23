import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useOnboardingGate } from '../hooks/useOnboardingGate';
import { OnboardingFlow } from '../components/OnboardingFlow';
import { OnboardingEmail } from '../components/OnboardingEmail';
import { useEmailGate } from '../hooks/useEmailGate';
import { useT } from '../i18n/useT';

// Routes that bypass the onboarding gate even when it would otherwise fire.
// /profile is essential so the user can fix a typo in their username; the
// dev-only routes shouldn't be blocked by application state.
const ONBOARDING_BYPASS = new Set(['/profile', '/__sandbox', '/__engine-test']);
// The Lichess email step is required, so only the dev routes skip it.
const EMAIL_GATE_BYPASS = new Set(['/__sandbox', '/__engine-test']);

export function RequireAuth() {
  const { session, loading } = useAuth();
  const t = useT();
  const location = useLocation();
  const gate = useOnboardingGate();
  const emailGate = useEmailGate();
  const emailGated = !EMAIL_GATE_BYPASS.has(location.pathname);

  if (loading || (session && emailGated && emailGate === 'loading')) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-text-secondary text-sm">{t('common.loading')}</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Lichess sign-ins add an email first (new accounts: before the import
  // screen; existing ones: once, on their next visit).
  if (emailGated && emailGate === 'show') {
    return <OnboardingEmail />;
  }

  if (gate === 'show' && !ONBOARDING_BYPASS.has(location.pathname)) {
    return <OnboardingFlow />;
  }

  return <Outlet />;
}
