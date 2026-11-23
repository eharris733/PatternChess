import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { authService } from '../services/authService';
import { useAuth } from '../auth/useAuth';
import { BrandLockup } from '../components/BrandLogo';
import { DevSignInForm } from '../components/DevSignInForm';
import { useForceDefaultTheme } from '../state/themeStore';
import { useHead } from '../seo/useHead';
import { trackLeadReturn } from '../services/funnelService';
import { readSourceParam, stripWinBackParams } from '../lib/winBack';
import { safeNextPath } from '../lib/nextPath';
import { LichessLogo } from '../components/icons/PlatformLogos';

/** A readable line for better-auth's `?error=` callback codes. */
function oauthErrorMessage(search: string): string | null {
  const code = new URLSearchParams(search).get('error');
  if (!code) return null;
  if (/access_denied|cancel/i.test(code)) return 'Sign-in was cancelled.';
  return 'Sign-in did not finish. Please try again.';
}

export function LoginRoute() {
  const { session, loading } = useAuth();
  const location = useLocation() as {
    search: string;
    state?: { from?: { pathname: string; search?: string } };
  };
  // Where to go once signed in: `?next=` (e.g. /supporter?checkout=1 from the
  // signed-out supporter page) or the protected page RequireAuth bounced from.
  // Read once so stripping win-back params from the URL can't drop it.
  const [next] = useState<string | null>(
    () =>
      safeNextPath(new URLSearchParams(location.search).get('next')) ??
      safeNextPath(location.state?.from ? location.state.from.pathname + (location.state.from.search ?? '') : null),
  );
  const resumingCheckout = !!next && next.startsWith('/supporter');
  const [signingIn, setSigningIn] = useState(false);
  // better-auth sends a failed OAuth callback back here as `?error=<code>`.
  const [error, setError] = useState<string | null>(() => oauthErrorMessage(window.location.search));
  useForceDefaultTheme();
  // Not prerendered with its own content before this hook existed, so /login
  // used to inherit the landing page's canonical + JSON-LD from the SPA
  // fallback. Keep it out of search: it is a pure sign-in surface.
  useHead({
    title: 'Log in',
    description: 'Sign in to PatternChess with Google or Lichess and get your daily chess plan.',
    canonical: '/login',
    robots: 'noindex,follow',
  });

  // Win-back link for leads who already have an account (`/login?src=wb`).
  // Deferred + cancelled on cleanup so StrictMode counts it once.
  useEffect(() => {
    const source = readSourceParam(window.location.search);
    if (!source) return;
    const t = window.setTimeout(() => {
      stripWinBackParams();
      trackLeadReturn(source, null, null);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  if (session) {
    return <Navigate to={next ?? '/dashboard'} replace />;
  }

  const onSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await authService.signInWithGoogle(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setSigningIn(false);
    }
  };

  const onSignInLichess = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await authService.signInWithLichess(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setSigningIn(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md flex flex-col gap-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="sr-only">Log in to PatternChess</h1>
          <BrandLockup size="xl" />
          <p className="text-text-primary text-sm" data-testid="login-lede">
            {resumingCheckout
              ? 'Sign in and we\'ll take you straight to checkout.'
              : 'Your daily plan is one click away.'}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button className="btn-primary" onClick={onSignIn} disabled={signingIn}>
            {signingIn ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <p className="-mt-1 text-xs text-text-primary" data-testid="google-email-notice">
            Signing in with Google turns on training reminders by email. You can switch them off any
            time in your profile or from any email.
          </p>
          <button className="btn-outline gap-2" onClick={onSignInLichess} disabled={signingIn}>
            <LichessLogo className="h-5 w-5 shrink-0" />
            <span>{signingIn ? 'Redirecting…' : 'Continue with Lichess'}</span>
          </button>
        </div>
        {import.meta.env.DEV && <DevSignInForm />}
        {error && (
          <p role="alert" className="text-incorrect text-sm">
            {error}
          </p>
        )}
        <p className="text-text-secondary text-xs">
          We store your chess usernames and games. Your email is used only for reminders and
          motivation, which you can turn off any time, and we never share it.
        </p>
        <p className="text-text-secondary text-xs">
          By continuing, you agree to our{' '}
          <Link to="/terms" className="underline hover:text-text-primary">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="underline hover:text-text-primary">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
