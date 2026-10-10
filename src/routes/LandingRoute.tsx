import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingHero } from '../components/landing/LandingHero';
import { LandingFooter } from '../components/landing/LandingFooter';
import { UsernameInput } from '../components/landing/UsernameInput';
import { DemoResult } from '../components/landing/DemoResult';
import { SocialProofBadge } from '../components/landing/SocialProofBadge';
import { WhyYouAreStuck } from '../components/landing/WhyYouAreStuck';
import { HowItWorks, HOW_IT_WORKS_STEPS } from '../components/landing/HowItWorks';
import { AboutCreator } from '../components/landing/AboutCreator';
import { Testimonials } from '../components/landing/Testimonials';
import { WeeklyLeaderboard } from '../components/landing/WeeklyLeaderboard';
import { useDemoAnalysis } from '../hooks/useDemoAnalysis';
import { useLandingView } from '../hooks/useLandingView';
import { trackDemoSubmit, trackLeadReturn } from '../services/funnelService';
import { readWinBackParams, stripWinBackParams } from '../lib/winBack';
import { useForceDefaultTheme } from '../state/themeStore';
import { useHead } from '../seo/useHead';
import { SITE_DESCRIPTION } from '../seo/siteMeta';
import {
  organizationJsonLd,
  websiteJsonLd,
  softwareApplicationJsonLd,
  howToJsonLd,
} from '../seo/jsonLd';

export function LandingRoute() {
  const { session, loading } = useAuth();
  const demo = useDemoAnalysis();
  useForceDefaultTheme();
  useHead({
    title: 'PatternChess — Train the blunders from your own chess games',
    description: SITE_DESCRIPTION,
    canonical: '/',
    jsonLd: [
      organizationJsonLd(),
      websiteJsonLd(),
      softwareApplicationJsonLd(),
      howToJsonLd(
        'How PatternChess trains the blunders from your own games',
        'Import your games, let Stockfish find the blunders, then drill them on a four-rep spaced-repetition ladder until the right move is automatic.',
        HOW_IT_WORKS_STEPS.map((s) => ({ name: s.title, text: s.body })),
      ),
    ],
  });
  // Records a single (human-gated) landing_view per session. Safe to call before
  // the auth/session early-returns below — the effect no-ops for signed-in users
  // since they're redirected away, and it only fires once per browser session.
  useLandingView();

  // Win-back link (`?u=&p=&src=`, see src/lib/winBack.ts): prefill the
  // username and re-run the demo so the returning lead lands on their own
  // blunders. Deferred a tick and cancelled on cleanup so StrictMode's
  // mount/unmount/mount runs it once (the demo hook aborts on unmount).
  const [winBack] = useState(() =>
    typeof window === 'undefined' ? null : readWinBackParams(window.location.search),
  );
  const runDemo = demo.run;
  useEffect(() => {
    if (!winBack || loading || session) return;
    const t = window.setTimeout(() => {
      stripWinBackParams();
      trackLeadReturn(winBack.source, winBack.platform, winBack.username);
      trackDemoSubmit(winBack.platform, winBack.username);
      runDemo({ platform: winBack.platform, username: winBack.username });
    }, 0);
    return () => window.clearTimeout(t);
  }, [winBack, loading, session, runDemo]);

  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans">
      <LandingTopBar />
      <main id="main" className="scroll-mt-20">
        <LandingHero>
          <div className="flex flex-col gap-8 max-w-3xl">
            <UsernameInput
              loading={demo.status === 'loading'}
              initialPlatform={winBack?.platform}
              initialUsername={winBack?.username}
              onSubmit={(platform, username) => {
                trackDemoSubmit(platform, username);
                demo.run({ platform, username });
              }}
            />
            <DemoResult demo={demo} />
          </div>
        </LandingHero>
        <SocialProofBadge />
        <Testimonials />
        <WeeklyLeaderboard />
        <HowItWorks />
        <WhyYouAreStuck />
        <AboutCreator />
      </main>
      <LandingFooter />
    </div>
  );
}
