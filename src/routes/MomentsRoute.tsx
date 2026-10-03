import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { useAuth } from '../auth/useAuth';
import { useHead } from '../seo/useHead';
import { breadcrumbJsonLd } from '../seo/jsonLd';

// The tool (chess.js + canvas renderer) loads after the static shell, so the
// prerendered page stays light and indexable.
const MomentsTool = lazy(() =>
  import('../components/moments/MomentsTool').then((m) => ({ default: m.MomentsTool })),
);

/** Public: turn a move sequence into a PatternChess-branded GIF. */
export function MomentsRoute() {
  const { session } = useAuth();
  useHead({
    title: 'Chess GIF maker: share a move sequence',
    description:
      'Paste a PGN, pick the moves, and download an animated chess GIF or a board screenshot. Share a combination without sharing the whole game. Free, no sign-up.',
    canonical: '/moments',
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Moments', url: '/moments' },
      ]),
    ],
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col gap-10">
          <header className="flex flex-col gap-3 max-w-2xl">
            <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">Moments</span>
            <h1 className="text-3xl font-bold tracking-tight">Turn a chess moment into a GIF</h1>
            <p className="text-base text-text-primary leading-relaxed">
              Paste a game, pick the moves that matter, and download an animated GIF or a screenshot of
              any position. Share the combination, not the whole game. Free, no account needed.
            </p>
          </header>

          <Suspense fallback={<p className="text-text-primary text-sm">Loading the board…</p>}>
            <MomentsTool />
          </Suspense>

          {!session && (
            <section className="border-2 border-text-primary bg-surface p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1 max-w-xl">
                <h2 className="font-mono uppercase tracking-tight text-base">Your blunders are moments too</h2>
                <p className="text-text-primary">
                  PatternChess imports your Chess.com or Lichess games, finds the positions where you went
                  wrong, and drills them until the right move is automatic.
                </p>
              </div>
              <Link
                to="/login"
                className="inline-block shrink-0 font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-5 py-3 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
              >
                Train your own blunders — free
              </Link>
            </section>
          )}

          <section className="grid gap-6 sm:grid-cols-3">
            <div>
              <h2 className="font-mono uppercase tracking-tight text-sm">Paste anything</h2>
              <p className="mt-1 text-text-primary">
                A full PGN from Chess.com or Lichess, a plain move list like "1. e4 e5 2. Nf3", or a FEN
                for a single position.
              </p>
            </div>
            <div>
              <h2 className="font-mono uppercase tracking-tight text-sm">Pick the sequence</h2>
              <p className="mt-1 text-text-primary">
                Choose where the moment starts and ends, flip the board, set the speed and add a caption.
                The preview is the exact GIF you'll get.
              </p>
            </div>
            <div>
              <h2 className="font-mono uppercase tracking-tight text-sm">Share it</h2>
              <p className="mt-1 text-text-primary">
                GIFs play inline almost everywhere: group chats, Discord, Reddit and X. Screenshots work
                anywhere a picture does.
              </p>
            </div>
          </section>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
