import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { useSyncStore } from '../state/syncStore';
import { supabaseService } from '../services/supabaseService';
import { platformGameUrl } from '../services/externalAnalysisUrlService';
import { extractHeaders } from '../services/pgnParserService';
import type { GameRecord } from '../models/gameRecord';

type Outcome = 'win' | 'loss' | 'draw';

const CHESS_COM_DRAW_TERMS = new Set([
  'stalemate',
  'agreed',
  'repetition',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

function gameOutcome(game: GameRecord): Outcome | null {
  const result = game.result;
  if (!result) return null;

  if (game.platform === 'chess.com') {
    if (result === 'win') return 'win';
    if (CHESS_COM_DRAW_TERMS.has(result)) return 'draw';
    return 'loss';
  }

  if (game.platform === 'lichess') {
    if (result === '1/2-1/2') return 'draw';
    if (result === '*') return null;
    const isWhite =
      extractHeaders(game.pgn).White?.toLowerCase() === game.username.toLowerCase();
    if (result === '1-0') return isWhite ? 'win' : 'loss';
    if (result === '0-1') return isWhite ? 'loss' : 'win';
    return null;
  }

  if (result === 'win') return 'win';
  if (result === 'loss' || result === 'lose') return 'loss';
  if (result === 'draw' || result === '1/2-1/2') return 'draw';
  return null;
}

export function VaultRoute() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { data: games, isLoading } = useGames();
  const { data: blunderCounts } = useQuery({
    queryKey: ['blunderCounts', user?.id],
    queryFn: () => supabaseService.getBlunderCountsByGame({ userId: user?.id }),
    enabled: !!user,
  });
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);

  if (isLoading) {
    return <div className="text-text-secondary text-sm">Loading…</div>;
  }

  if (!games || games.length === 0) {
    return (
      <div className="max-w-xl mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">No games yet</h1>
        <p className="text-text-secondary text-sm">
          {hasAccount
            ? 'Sync your latest games to populate the vault.'
            : 'Link a Lichess or Chess.com account to start.'}
        </p>
        {hasAccount ? (
          <button
            className="btn-primary"
            disabled={isSyncing || !profile}
            onClick={() => profile && void triggerNow(profile)}
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        ) : (
          <button className="btn-primary" onClick={() => navigate('/profile')}>
            Go to Profile
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <header>
        <h1 className="heading-xl">Vault</h1>
        <p className="text-text-secondary text-sm mt-1">
          {games.length} game{games.length === 1 ? '' : 's'} synced.
        </p>
      </header>

      <ul className="card divide-y divide-surface-2 p-0 overflow-hidden">
        {games.map((g) => {
          const externalUrl = platformGameUrl(g);
          const outcome = gameOutcome(g);
          const blunderCount = blunderCounts?.[g.id] ?? 0;
          const blunderLabel = !g.analyzedAt
            ? 'Not analyzed'
            : blunderCount === 0
              ? 'No blunders'
              : `${blunderCount} blunder${blunderCount === 1 ? '' : 's'}`;
          return (
            <li key={g.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {g.username} <span className="text-text-secondary">vs</span> {g.opponent}
                </span>
                <span className="text-xs text-text-secondary mt-0.5">
                  {g.platform} · {g.timeControl ?? '—'} ·{' '}
                  {g.playedAt ? formatDate(g.playedAt) : 'unknown date'}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={clsx(
                    'text-xs',
                    blunderCount > 0 ? 'text-mistake' : 'text-text-secondary',
                  )}
                >
                  {blunderLabel}
                </span>
                <ResultBadge outcome={outcome} />
                {externalUrl ? (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost text-xs gap-1"
                    title={`Open analysis on ${g.platform}`}
                  >
                    Analyze <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <span
                    className="btn-ghost text-xs gap-1 opacity-40 cursor-not-allowed"
                    title="No external link available"
                  >
                    Analyze <span aria-hidden>↗</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResultBadge({ outcome }: { outcome: Outcome | null }) {
  const map = {
    win: { letter: 'W', cls: 'bg-correct/20 text-correct border-correct/40' },
    loss: { letter: 'L', cls: 'bg-incorrect/20 text-incorrect border-incorrect/40' },
    draw: { letter: 'D', cls: 'bg-surface-2 text-text-secondary border-surface-2' },
  } as const;
  const meta = outcome ? map[outcome] : null;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center w-6 h-6 rounded-md border font-mono text-xs font-bold',
        meta?.cls ?? 'bg-surface-2 text-text-secondary border-surface-2',
      )}
      title={outcome ?? 'unknown result'}
    >
      {meta?.letter ?? '–'}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
