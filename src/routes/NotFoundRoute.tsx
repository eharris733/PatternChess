import { Link } from 'react-router-dom';
import { LandingTopBar } from '../components/landing/LandingTopBar';
import { LandingFooter } from '../components/landing/LandingFooter';
import { useForceDefaultTheme } from '../state/themeStore';
import { useHead } from '../seo/useHead';

/**
 * Catch-all for unknown URLs. Cloudflare Pages serves the prerendered landing
 * page (HTTP 200) for any path via the SPA fallback, so this route at least
 * corrects the <head> (noindex, no landing canonical) and tells the visitor
 * what happened instead of silently bouncing them to /dashboard.
 */
export function NotFoundRoute() {
  useForceDefaultTheme();
  useHead({
    title: 'Page not found',
    description: 'That page does not exist on PatternChess.',
    robots: 'noindex,follow',
  });

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text-primary font-sans">
      <LandingTopBar />
      <main id="main" className="flex-1 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24 flex flex-col gap-6 max-w-2xl">
          <h1 className="font-mono uppercase tracking-tight text-3xl sm:text-4xl">
            Page not found
          </h1>
          <p className="text-base sm:text-lg leading-relaxed">
            There is nothing at this address. It may have moved, or the link was copied
            incompletely.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/" className="btn-primary">
              Home
            </Link>
            <Link to="/dashboard" className="btn-outline">
              Dashboard
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
