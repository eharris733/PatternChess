import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { authService } from '../services/authService';
import { useAuth } from '../auth/useAuth';
import { BrandLockup } from '../components/BrandLogo';
import { useForceDefaultTheme } from '../state/themeStore';

export function LoginRoute() {
  const { session, loading } = useAuth();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useForceDefaultTheme();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  if (session) {
    const dest = location.state?.from?.pathname ?? '/dashboard';
    return <Navigate to={dest} replace />;
  }

  const onSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await authService.signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setSigningIn(false);
    }
  };

  const onSignInLichess = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await authService.signInWithLichess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md flex flex-col gap-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <BrandLockup size="xl" />
          <p className="text-text-secondary text-sm">
            Don't play the same blunder twice.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button className="btn-primary" onClick={onSignIn} disabled={signingIn}>
            {signingIn ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <button className="btn-outline" onClick={onSignInLichess} disabled={signingIn}>
            {signingIn ? 'Redirecting…' : 'Continue with Lichess'}
          </button>
        </div>
        {error && <p className="text-incorrect text-sm">{error}</p>}
        <p className="text-text-secondary text-xs">
          We only store your chess.com / lichess username and game data — no personal info used or shared.
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
    </div>
  );
}
