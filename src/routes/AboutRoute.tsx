import { Link } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { AboutCreator } from '../components/landing/AboutCreator';
import { useHead } from '../seo/useHead';
import { organizationJsonLd, breadcrumbJsonLd } from '../seo/jsonLd';

// Definitional content that maps directly to the queries people ask search and
// AI answer engines ("what is the woodpecker method", "what is a blunder").
const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'Blunder',
    def: 'A move that sharply worsens your position. PatternChess flags a move as a blunder when it loses roughly 15% or more of your winning chances, measured with the Lichess winning-chances model, which tracks practical chances more closely than raw centipawns.',
  },
  {
    term: 'Woodpecker Method',
    def: 'A training technique from the book by Axel Smith and Hans Tikkanen: solve the same set of tactical positions over and over, each pass faster than the last, until the patterns are recognized instantly.',
  },
  {
    term: 'Spaced repetition',
    def: 'Reviewing the same material at widening intervals so it settles into long-term memory. PatternChess reschedules each blunder you drill on an expanding ladder of days.',
  },
  {
    term: 'Winning chances',
    def: 'A 0–100% estimate of practical winning chances derived from the engine evaluation using the Lichess formula. It captures how costly a move really was better than centipawns, because the difference between +2 and +4 matters far less than the difference between 0 and +2.',
  },
  {
    term: 'Daily plan',
    def: 'Your to-do list for the day on PatternChess: games to play and positions to train, sized to the commitment level you pick.',
  },
  {
    term: 'Streak',
    def: "The number of days in a row you've trained. Streak freezes, earned every 7 days, cover a missed day.",
  },
];

export function AboutRoute() {
  useHead({
    title: 'About PatternChess',
    description:
      'What PatternChess is, the Woodpecker Method it is built on, and a glossary of the chess-training terms it uses.',
    canonical: '/about',
    jsonLd: [
      organizationJsonLd(),
      breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'About', url: '/about' },
      ]),
    ],
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <BackLink to="/" label="Back home" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight">About PatternChess</h1>

          <div className="legal-body mt-8 space-y-6 leading-relaxed text-text-primary/90">
            <p>
              PatternChess is a free chess-training app that turns the blunders from your own games
              into a daily plan of spaced-repetition drills. It trains the exact positions where you
              went wrong, a few each day, so the right move becomes automatic.
            </p>
            <p>
              You connect a Chess.com or Lichess username, and PatternChess imports your games and
              runs the Stockfish engine over every position to find the moves that cost you the
              game. Those moments become a personal training set, scheduled for repetition in the
              spirit of the <strong>Woodpecker Method</strong>: you re-solve the same positions on
              days 1, 3, 7 and 21 until the right move is automatic.
            </p>
          </div>

          <section className="mt-14">
            <h2 className="font-mono uppercase tracking-tight text-2xl text-text-primary border-b-2 border-text-primary pb-3">
              Chess training glossary
            </h2>
            <dl className="mt-6 space-y-6">
              {GLOSSARY.map((entry) => (
                <div key={entry.term} className="grid sm:grid-cols-[160px_1fr] gap-2 sm:gap-6">
                  <dt className="font-mono uppercase text-sm tracking-tight text-gold-dark">
                    {entry.term}
                  </dt>
                  <dd className="text-base text-text-primary/85 leading-relaxed">{entry.def}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <AboutCreator />
      </main>
      <LandingFooter />
    </div>
  );
}
