import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingHero } from '../components/landing/LandingHero';
import { LandingFooter } from '../components/landing/LandingFooter';
import { UsernameInput } from '../components/landing/UsernameInput';
import { DemoResult } from '../components/landing/DemoResult';
import { WhyYouAreStuck } from '../components/landing/WhyYouAreStuck';
import { HowItWorks } from '../components/landing/HowItWorks';
import { AboutCreator } from '../components/landing/AboutCreator';
import { useDemoAnalysis } from '../hooks/useDemoAnalysis';
import { useLandingView } from '../hooks/useLandingView';
import { trackDemoSubmit } from '../services/funnelService';
import { useForceDefaultTheme } from '../state/themeStore';

export function LandingRoute() {
  const { session, loading } = useAuth();
  const demo = useDemoAnalysis();
  useForceDefaultTheme();
  // Records a single (human-gated) landing_view per session. Safe to call before
  // the auth/session early-returns below — the effect no-ops for signed-in users
  // since they're redirected away, and it only fires once per browser session.
  useLandingView();

  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans">
      <LandingTopBar />
      <main>
        <LandingHero>
          <div className="flex flex-col gap-8 max-w-3xl">
            <UsernameInput
              loading={demo.status === 'loading'}
              onSubmit={(platform, username) => {
                trackDemoSubmit(platform, username);
                demo.run({ platform, username });
              }}
            />
            <DemoResult demo={demo} />
          </div>
        </LandingHero>
        <WhyYouAreStuck />
        <HowItWorks />
        <AboutCreator />
      </main>
      <LandingFooter />
    </div>
  );
}
