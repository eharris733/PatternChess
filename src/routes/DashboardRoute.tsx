import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { useGames } from '../hooks/useGames';

export function DashboardRoute() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const dueQuery = useDueBlunders();
  const gamesQuery = useGames();

  const dueCount = dueQuery.data?.length ?? 0;
  const gamesCount = gamesQuery.data?.length ?? 0;
  const greeting =
    profile?.displayName ??
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'there';

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8">
      <header>
        <p className="text-text-secondary text-sm">Welcome back</p>
        <h1 className="heading-xl mt-1">Hey {greeting}.</h1>
      </header>

      <section className="card flex flex-col items-start gap-4">
        <span className="label">Due now</span>
        <div className="flex items-end gap-3">
          <span className="text-6xl font-bold tabular-nums tracking-tight text-text-primary">
            {dueCount}
          </span>
          <span className="text-text-secondary mb-2">
            blunder{dueCount === 1 ? '' : 's'} ready to drill
          </span>
        </div>
        <div className="flex gap-3 mt-2">
          <button
            className="btn-primary"
            onClick={() => navigate('/training')}
            disabled={dueCount === 0}
          >
            Start training
          </button>
          <button className="btn-outline" onClick={() => navigate('/import')}>
            Import games
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          className="card text-left hover:border-accent transition"
          onClick={() => navigate('/vault')}
        >
          <span className="label">Vault</span>
          <p className="heading-md mt-2">{gamesCount} games</p>
          <p className="text-text-secondary text-sm mt-1">Browse and review your imports.</p>
        </button>
        <button
          className="card text-left hover:border-accent transition"
          onClick={() => navigate('/profile')}
        >
          <span className="label">Profile</span>
          <p className="heading-md mt-2">Linked accounts</p>
          <p className="text-text-secondary text-sm mt-1">
            {[profile?.lichessUsername, profile?.chesscomUsername].filter(Boolean).join(' · ') ||
              'Add your Lichess or Chess.com username'}
          </p>
        </button>
      </section>
    </div>
  );
}
