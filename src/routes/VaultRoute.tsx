import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useGames } from '../hooks/useGames';
import type { GameRecord } from '../models/gameRecord';

export function VaultRoute() {
  const navigate = useNavigate();
  const { data: games, isLoading } = useGames();

  if (isLoading) {
    return <div className="text-text-secondary text-sm">Loading…</div>;
  }

  if (!games || games.length === 0) {
    return (
      <div className="max-w-xl mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">No games yet</h1>
        <p className="text-text-secondary text-sm">Import your recent games to get started.</p>
        <button className="btn-primary" onClick={() => navigate('/import')}>
          Import games
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <header>
        <h1 className="heading-xl">Vault</h1>
        <p className="text-text-secondary text-sm mt-1">
          {games.length} game{games.length === 1 ? '' : 's'} imported.
        </p>
      </header>

      <ul className="card divide-y divide-surface-2 p-0 overflow-hidden">
        {games.map((g) => (
          <li
            key={g.id}
            className="px-5 py-3 flex items-center justify-between hover:bg-surface-2/50 transition cursor-pointer"
            onClick={() => navigate(`/review/${g.id}`)}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {g.username} <span className="text-text-secondary">vs</span> {g.opponent}
              </span>
              <span className="text-xs text-text-secondary mt-0.5">
                {g.platform} · {g.timeControl ?? '—'} ·{' '}
                {g.playedAt ? formatDate(g.playedAt) : 'unknown date'}
              </span>
            </div>
            <ResultBadge result={g.result} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultBadge({ result }: { result: GameRecord['result'] }) {
  const tone =
    result === 'win' || result === '1-0' || result === '0-1'
      ? 'text-correct'
      : result === 'loss' || result === 'lose'
        ? 'text-incorrect'
        : 'text-text-secondary';
  return (
    <span className={clsx('font-mono text-xs uppercase tracking-wider', tone)}>
      {result ?? '—'}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
