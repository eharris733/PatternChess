import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { useSyncStore } from '../state/syncStore';
import { usePgnUploadStore } from '../state/pgnUploadStore';
import { supabaseService } from '../services/supabaseService';
import { platformGameUrl } from '../services/externalAnalysisUrlService';
import { extractHeaders } from '../services/pgnParserService';
import { resolveOutcome, type GameOutcome } from '../models/gameRecord';
import type { GameRecord } from '../models/gameRecord';

type Outcome = GameOutcome;

const ANALYZED_STORAGE_PREFIX = 'pc:analyzed-externally:';

function loadAnalyzedSet(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = localStorage.getItem(ANALYZED_STORAGE_PREFIX + userId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function persistAnalyzedSet(userId: string, set: Set<string>): void {
  try {
    localStorage.setItem(ANALYZED_STORAGE_PREFIX + userId, JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function gameOutcome(game: GameRecord): Outcome | null {
  // Prefer the stored color; fall back to PGN headers for older rows where
  // user_color was never parsed.
  let color = game.userColor;
  if (!color && (game.platform === 'lichess' || game.platform === 'pgn')) {
    const isWhite =
      extractHeaders(game.pgn).White?.toLowerCase() === game.username.toLowerCase();
    color = isWhite ? 'white' : 'black';
  }
  return resolveOutcome(game.platform, game.result, color);
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
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(() => loadAnalyzedSet(user?.id));
  const markAnalyzed = useCallback(
    (gameId: string) => {
      if (!user?.id) return;
      setAnalyzedIds((prev) => {
        if (prev.has(gameId)) return prev;
        const next = new Set(prev);
        next.add(gameId);
        persistAnalyzedSet(user.id, next);
        return next;
      });
    },
    [user?.id],
  );
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });
  const openUpload = usePgnUploadStore((s) => s.openModal);
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
            ? 'Sync your latest games, or upload your own PGNs to populate the vault.'
            : 'Connect a Lichess or Chess.com account, or upload your own PGNs to start.'}
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
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
          <button className="btn-outline" onClick={openUpload}>
            Upload PGNs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="heading-xl">Vault</h1>
          <p className="text-text-secondary text-sm mt-1">
            {games.length} game{games.length === 1 ? '' : 's'} synced. New games
            are added automatically each time you visit.
          </p>
        </div>
        <button className="btn-outline shrink-0" onClick={openUpload}>
          Upload PGNs
        </button>
      </header>

      <ul className="card divide-y divide-[#1A1A1A]/15 p-0 overflow-hidden">
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
                    className={clsx(
                      'btn-ghost text-xs gap-1',
                      analyzedIds.has(g.id) && 'text-text-secondary/70',
                    )}
                    title={`Open analysis on ${g.platform}`}
                    onClick={() => markAnalyzed(g.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) markAnalyzed(g.id);
                    }}
                  >
                    {analyzedIds.has(g.id) ? 'Re-analyze' : 'Analyze'}{' '}
                    <span aria-hidden>↗</span>
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
    win: { letter: 'W', cls: 'bg-correct/20 text-correct border-correct/50' },
    loss: { letter: 'L', cls: 'bg-incorrect/20 text-incorrect border-incorrect/50' },
    draw: { letter: 'D', cls: 'bg-surface-3 text-text-secondary border-[#1A1A1A]' },
  } as const;
  const meta = outcome ? map[outcome] : null;
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center w-6 h-6 rounded-none border-2 font-mono text-xs font-bold',
        meta?.cls ?? 'bg-surface-3 text-text-secondary border-[#1A1A1A]',
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
