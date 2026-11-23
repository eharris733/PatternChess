import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { HeartIcon } from '../components/icons/HeartIcon';
import { useAuth } from '../auth/useAuth';
import { LANDING_STATS_SNAPSHOT, useLandingStats } from '../hooks/useLandingStats';
import { useSupporter } from '../hooks/useSupporter';
import { useSupporterCheckout } from '../hooks/useSupporterCheckout';
import { useHead } from '../seo/useHead';
import { breadcrumbJsonLd } from '../seo/jsonLd';
import { SUPPORTER_CHECKOUT_RESUME, loginUrlWithNext } from '../lib/nextPath';

const PERKS: { title: string; body: string }[] = [
  { title: 'Flair', body: 'A badge next to your name on your profile and on the leaderboards.' },
  { title: 'Mobile app', body: 'First in line for the beta when it opens.' },
  { title: 'Thanks', body: "You're the reason this exists." },
];

const CTA =
  'inline-block font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-gold-dark text-bg px-5 py-3 rounded-none shadow-card hover:shadow-card-hover hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-60';

/**
 * Public: the $5/month supporter tier. Checkout and the Customer Portal are
 * Stripe-hosted (functions/api/stripe/*); perks switch on from the webhook,
 * so the thank-you state polls until the `supporters` row turns active.
 */
export function SupporterRoute() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const thanks = params.get('thanks') === '1';
  const resumeCheckout = params.get('checkout') === '1';
  const { status, isSupporter, isPending: supporterPending } = useSupporter();
  const { checkout, manage, pending, error } = useSupporterCheckout();
  const resumed = useRef(false);
  const { data: stats } = useLandingStats();
  const elo = (stats ?? LANDING_STATS_SNAPSHOT).eloGained;
  const queryClient = useQueryClient();

  useHead({
    title: 'Support PatternChess',
    description:
      'PatternChess is a free daily chess-training plan. Supporters chip in $5 a month to keep it running and get flair and early access to the mobile app.',
    canonical: '/supporter',
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Support', url: '/supporter' },
      ]),
    ],
  });

  // Back from sign-in (`/login?next=/supporter?checkout=1`): start checkout
  // once, as soon as we know this player isn't a supporter already. The param
  // is dropped first so a Back from Stripe doesn't bounce straight there again.
  useEffect(() => {
    if (!resumeCheckout || !session || supporterPending || resumed.current) return;
    resumed.current = true;
    setParams(
      (p) => {
        const nextParams = new URLSearchParams(p);
        nextParams.delete('checkout');
        return nextParams;
      },
      { replace: true },
    );
    if (!isSupporter) checkout();
  }, [resumeCheckout, session, supporterPending, isSupporter, checkout, setParams]);

  // Back from Checkout: the webhook usually lands within seconds.
  useEffect(() => {
    if (!thanks || isSupporter || !session) return;
    const id = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: ['supporter'] }), 2000);
    const stop = window.setTimeout(() => window.clearInterval(id), 60_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [thanks, isSupporter, session, queryClient]);

  return (
    <div className="min-h-screen bg-bg text-text-primary font-sans flex flex-col">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-10">
          <header className="flex flex-col gap-3">
            <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">Support PatternChess</span>
            <h1 className="text-3xl font-bold tracking-tight">Back the thing that's backing your chess.</h1>
            <p className="text-lg text-text-primary leading-relaxed">
              Daily training on PatternChess is free for everyone. Supporters chip in $5 a month because
              they want it to keep existing, and we're grateful.
            </p>
            {elo > 0 && (
              <p className="text-text-primary">
                PatternChess players have gained +{elo.toLocaleString()} Elo between them so far.
              </p>
            )}
          </header>

          <section className="border-2 border-text-primary bg-surface p-6 flex flex-col gap-4" data-testid="supporter-cta">
            {thanks && !isSupporter && session ? (
              <p className="text-text-primary" role="status">
                Thank you! Your supporter perks switch on in a few seconds.
              </p>
            ) : isSupporter ? (
              <>
                <p className="flex items-center gap-2 text-lg font-semibold">
                  <HeartIcon className="h-5 w-5" /> You're a supporter. Thank you.
                </p>
                <p className="text-sm text-text-primary">
                  {status?.cancelAtPeriodEnd && status.currentPeriodEnd
                    ? `Your support ends on ${status.currentPeriodEnd.toLocaleDateString()}. You keep the Early Supporter flair after that.`
                    : 'Pick your supporter flair from your profile.'}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link to="/profile" className="btn-outline">
                    Choose flair
                  </Link>
                  <button type="button" className="btn-ghost" disabled={pending != null} onClick={manage}>
                    {pending === 'portal' ? 'Opening…' : 'Manage subscription'}
                  </button>
                </div>
              </>
            ) : session ? (
              <>
                <div>
                  <button type="button" className={CTA} disabled={pending != null} onClick={checkout} data-testid="supporter-checkout">
                    {pending === 'checkout' ? 'Opening checkout…' : 'Become a supporter, $5/mo'}
                  </button>
                </div>
                <p className="text-sm text-text-primary">Cancel any time. Your daily training stays free either way.</p>
              </>
            ) : (
              <>
                <p className="text-text-primary">Sign in and we'll take you straight to checkout.</p>
                <div>
                  <Link to={loginUrlWithNext(SUPPORTER_CHECKOUT_RESUME)} className={CTA} data-testid="supporter-sign-in">
                    Sign in to support
                  </Link>
                </div>
              </>
            )}
            {error && <p className="text-incorrect text-sm">{error}</p>}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-mono uppercase tracking-tight text-xl">What supporters get</h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {PERKS.map((p) => (
                <li key={p.title} className="border-2 border-text-primary bg-surface p-4 flex flex-col gap-1">
                  <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">{p.title}</span>
                  <span className="text-sm text-text-primary">{p.body}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-mono uppercase tracking-tight text-xl">Where the money goes</h2>
            <p className="text-text-primary">
              Hosting, the database, and the email reminders. Stockfish runs in your own browser, so your
              games never cost us a server.
            </p>
            <p className="text-sm text-text-primary">
              Payments are handled by Stripe for EH Solutions LLC. See the{' '}
              <Link to="/terms#supporter" className="underline">
                terms
              </Link>{' '}
              for cancellation and refunds.
            </p>
          </section>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
