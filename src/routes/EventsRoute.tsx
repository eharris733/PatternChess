import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { useHead } from '../seo/useHead';
import { breadcrumbJsonLd } from '../seo/jsonLd';

const EVENTS_URL = 'https://events.patternchess.com';

// What the directory offers, phrased around what a player actually gets.
const FEATURES: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: 'Every state, one calendar',
    body: 'USCF-rated tournaments and club nights across all 50 states and DC, aggregated from real club calendars plus the official US Chess listings — including the weekly club events that never get a paid TLA. Updated twice a week.',
    href: EVENTS_URL,
    cta: 'Browse upcoming events',
  },
  {
    title: 'Find a club near you',
    body: 'A map and directory of active chess clubs with their regular schedules — casual nights, weekly Swisses, blitz — so you know where people are actually playing in your area.',
    href: `${EVENTS_URL}/clubs`,
    cta: 'Find a club',
  },
  {
    title: 'Subscribe, never check back',
    body: 'Free iCal feeds for any state or club drop every event straight into Google Calendar or Apple Calendar, and a free JSON API serves the same data for anything you want to build.',
    href: `${EVENTS_URL}/about`,
    cta: 'Get the feeds & API',
  },
];

const externalLinkClasses =
  'inline-block font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-surface text-text-primary px-4 py-2.5 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all';

export function EventsRoute() {
  useHead({
    title: 'Find over-the-board chess tournaments near you',
    description:
      'PatternChess Events is a free directory of USCF chess tournaments and club nights across all 50 states, built from real club calendars — with iCal feeds and a free JSON API.',
    canonical: '/events',
    jsonLd: breadcrumbJsonLd([
      { name: 'PatternChess', url: '/' },
      { name: 'OTB tournaments', url: '/events' },
    ]),
  });

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="font-mono uppercase text-xs tracking-tight text-text-primary/60 hover:text-gold-dark transition-colors"
          >
            ← Back home
          </Link>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">
            Find over-the-board tournaments near you
          </h1>

          <div className="mt-8 space-y-6 leading-relaxed text-text-primary/90">
            <p>
              Training on your blunders is half the loop — the other half is playing real games.{' '}
              <a
                href={EVENTS_URL}
                className="font-semibold text-gold-dark hover:underline"
              >
                PatternChess Events
              </a>{' '}
              is our free directory of over-the-board chess: USCF-rated tournaments and weekly club
              nights across the whole US, gathered from the clubs&apos; own calendars so it stays
              current without anyone submitting anything.
            </p>
            <p>
              The official US Chess listing only shows events whose organizers paid for a TLA —
              often a handful per state, while local clubs run rated tournaments every week. The
              directory aggregates what clubs actually publish.
            </p>
          </div>

          <div className="mt-10 flex flex-col gap-3">
            {FEATURES.map((f) => (
              <section key={f.title} className="border-2 border-text-primary bg-surface p-5">
                <h2 className="font-mono uppercase tracking-tight text-sm sm:text-base text-text-primary">
                  {f.title}
                </h2>
                <p className="mt-2 text-base text-text-primary/85 leading-relaxed">{f.body}</p>
                <a href={f.href} className={`${externalLinkClasses} mt-4`}>
                  {f.cta}
                </a>
              </section>
            ))}
          </div>

          <div className="mt-12 border-t-2 border-text-primary/10 pt-8">
            <p className="text-base text-text-primary/85 leading-relaxed">
              Then bring the games back: import them from Chess.com or Lichess and drill the
              positions where they went wrong.
            </p>
            <Link
              to="/login"
              className="mt-4 inline-block font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-5 py-3 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
            >
              Train your own blunders — free
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
