import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { useAuth } from '../auth/useAuth';
import { useHead } from '../seo/useHead';
import { breadcrumbJsonLd } from '../seo/jsonLd';
import { trackCtaClick } from '../services/funnelService';

// Served from public/video (same origin, so COEP require-corp is satisfied).
// Bump the -vN suffix when the cut changes: the files are cached immutably.
const VIDEO_SRC = '/video/patternchess-tour-v1.mp4';
const POSTER_SRC = '/video/patternchess-tour-v1-poster.jpg';

/**
 * Public: the one-minute product video. It lives on its own page so the
 * landing page never downloads it; `preload="none"` means even this page
 * fetches nothing past the poster until the visitor presses play.
 */
export function WatchRoute() {
  const { session } = useAuth();
  useHead({
    title: 'Watch PatternChess in a minute',
    description:
      'A one-minute tour of PatternChess: your blunders found by Stockfish, a daily plan to train them, openings, endgames and streaks.',
    canonical: '/watch',
    image: POSTER_SRC,
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Watch', url: '/watch' },
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: 'PatternChess in a minute',
        description:
          'A one-minute tour of PatternChess: your blunders found by Stockfish, a daily plan to train them, openings, endgames and streaks.',
        thumbnailUrl: `https://patternchess.com${POSTER_SRC}`,
        contentUrl: `https://patternchess.com${VIDEO_SRC}`,
        uploadDate: '2026-11-21',
        duration: 'PT1M5S',
      },
    ],
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-8">
          <header className="flex flex-col gap-3 max-w-2xl">
            <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">Watch</span>
            <h1 className="text-3xl font-bold tracking-tight">PatternChess in a minute</h1>
            <p className="text-base text-text-primary leading-relaxed">
              Stop procrastinating your improvement. Here's how a few minutes a day with your own
              blunders turns into better chess.
            </p>
          </header>

          <div className="border-2 border-text-primary bg-black shadow-card">
            <video
              className="block w-full h-auto"
              src={VIDEO_SRC}
              poster={POSTER_SRC}
              width={1920}
              height={1080}
              controls
              playsInline
              preload="none"
              data-testid="tour-video"
            >
              Your browser can't play this video.{' '}
              <a href={VIDEO_SRC} className="underline">
                Download it
              </a>{' '}
              instead.
            </video>
          </div>

          {!session && (
            <section className="border-2 border-text-primary bg-surface p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-text-primary max-w-xl">
                Connect your Chess.com or Lichess account and get today's plan from your own games. Free.
              </p>
              <Link
                to="/login"
                onClick={() => trackCtaClick('watch')}
                className="inline-block shrink-0 font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-5 py-3 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
              >
                Sign up free
              </Link>
            </section>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
