import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { useSyncStore } from '../state/syncStore';
import { queryClient } from '../lib/queryClient';
import { supabaseService } from '../services/supabaseService';
import { analyzeGames, type AnalysisProgress } from '../services/analysisService';
import type { GameRecord } from '../models/gameRecord';

export function VaultRoute() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: games, isLoading } = useGames();
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);

  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  const onReanalyze = async (game: GameRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    if (analyzingId) return;
    setAnalyzingId(game.id);
    setProgress(null);
    try {
      await supabaseService.deleteBlundersForGame(game.id);
      await supabaseService.resetGameAnalyzed(game.id);
      await analyzeGames([game.id], game.username, setProgress);
      void queryClient.invalidateQueries({ queryKey: ['blunders'] });
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    } catch (err) {
      console.error('[vault] re-analyze failed', err);
    } finally {
      setAnalyzingId(null);
      setProgress(null);
    }
  };

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
          const isAnalyzingThis = analyzingId === g.id;
          const label =
            isAnalyzingThis && progress
              ? progress.positionsTotal > 0
                ? `${progress.positionIndex}/${progress.positionsTotal}`
                : 'starting…'
              : isAnalyzingThis
                ? 'starting…'
                : g.analyzedAt
                  ? 'Re-analyze'
                  : 'Analyze';
          return (
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={!!analyzingId}
                  onClick={(e) => void onReanalyze(g, e)}
                >
                  {label}
                </button>
                <ResultBadge result={g.result} />
              </div>
            </li>
          );
        })}
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
