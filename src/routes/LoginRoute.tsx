import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authService } from '../services/authService';
import { useAuth } from '../auth/useAuth';

export function LoginRoute() {
  const { session, loading } = useAuth();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary text-sm">Loading…</div>
      </div>
    );
  }

  if (session) {
    const dest = location.state?.from?.pathname ?? '/';
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md flex flex-col gap-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="text-accent text-3xl">♞</span>
          <h1 className="heading-xl">PatternChess</h1>
          <p className="text-text-secondary text-sm">
            Drill the blunders from your own games. Woodpecker method.
          </p>
        </div>
        <button className="btn-primary" onClick={onSignIn} disabled={signingIn}>
          {signingIn ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error && <p className="text-incorrect text-sm">{error}</p>}
        <p className="text-text-secondary text-xs">
          We only store your chess.com / lichess username and game data — no posting on your behalf.
        </p>
      </div>
    </div>
  );
}
