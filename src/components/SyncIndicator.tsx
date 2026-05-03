import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { retryWithProfile, useSyncStore } from '../state/syncStore';
import type { ProviderProgress } from '../services/syncService';

type Aggregate = 'hidden' | 'idle' | 'syncing' | 'done' | 'error';

function aggregate(
  hasLichess: boolean,
  hasChesscom: boolean,
  l: ProviderProgress,
  c: ProviderProgress,
): Aggregate {
  if (!hasLichess && !hasChesscom) return 'hidden';
  const states = [
    hasLichess ? l.phase : 'idle',
    hasChesscom ? c.phase : 'idle',
  ];
  if (states.includes('fetching') || states.includes('inserting')) return 'syncing';
  if (states.includes('error')) return 'error';
  if (states.includes('done')) return 'done';
  return 'idle';
}

function progressLabel(p: ProviderProgress): string {
  if (p.phase === 'fetching') return 'fetching…';
  if (p.phase === 'inserting') return `${p.inserted}/${p.total ?? '?'} new`;
  if (p.phase === 'done') return p.inserted > 0 ? `+${p.inserted} new` : 'up to date';
  if (p.phase === 'error') return p.error ?? 'failed';
  return 'idle';
}

export function SyncIndicator() {
  const { profile } = useAuth();
  const providers = useSyncStore((s) => s.providers);
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const [open, setOpen] = useState(false);
  const [collapseDone, setCollapseDone] = useState(false);

  const hasLichess = !!profile?.lichessUsername;
  const hasChesscom = !!profile?.chesscomUsername;
  const agg = aggregate(hasLichess, hasChesscom, providers.lichess, providers.chesscom);

  useEffect(() => {
    setCollapseDone(false);
    if (agg === 'done') {
      const t = window.setTimeout(() => setCollapseDone(true), 4000);
      return () => window.clearTimeout(t);
    }
  }, [agg, providers.lichess.phase, providers.chesscom.phase]);

  if (agg === 'hidden') return null;

  const totalInserted =
    (hasLichess ? providers.lichess.inserted : 0) +
    (hasChesscom ? providers.chesscom.inserted : 0);
  const totalFetching =
    (hasLichess && (providers.lichess.phase === 'fetching' || providers.lichess.phase === 'inserting')
      ? providers.lichess.total ?? 0
      : 0) +
    (hasChesscom && (providers.chesscom.phase === 'fetching' || providers.chesscom.phase === 'inserting')
      ? providers.chesscom.total ?? 0
      : 0);

  const collapseToIdle = agg === 'done' && collapseDone;
  const display: Aggregate = collapseToIdle ? 'idle' : agg;

  const headline =
    display === 'syncing'
      ? totalFetching > 0
        ? `Syncing ${totalInserted}/${totalFetching}`
        : 'Syncing…'
      : display === 'done'
        ? totalInserted > 0
          ? `+${totalInserted} new games`
          : 'Up to date'
        : display === 'error'
          ? 'Sync failed'
          : 'Sync';

  const glyph =
    display === 'syncing' ? (
      <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    ) : display === 'done' ? (
      <span className="text-correct">✓</span>
    ) : display === 'error' ? (
      <span className="text-incorrect">✕</span>
    ) : (
      <span className="text-text-secondary">↻</span>
    );

  const onRetry = (platform: 'lichess' | 'chess.com') => {
    if (!profile) return;
    void retryWithProfile(profile, platform);
  };

  const isBusy = display === 'syncing';
  const onSyncNow = () => {
    if (!profile || isBusy) return;
    void triggerNow(profile);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-surface-2',
          'text-xs text-text-primary shadow-card hover:bg-surface-2 transition-colors',
        )}
        aria-label="Sync status"
      >
        {glyph}
        <span>{headline}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-surface border border-surface-2 shadow-card p-3 flex flex-col gap-2 text-xs z-20">
          {hasLichess && (
            <Row
              name="Lichess"
              progress={providers.lichess}
              onRetry={() => onRetry('lichess')}
            />
          )}
          {hasChesscom && (
            <Row
              name="Chess.com"
              progress={providers.chesscom}
              onRetry={() => onRetry('chess.com')}
            />
          )}
          {!hasLichess && !hasChesscom && (
            <span className="text-text-secondary">No accounts linked.</span>
          )}
          {(hasLichess || hasChesscom) && (
            <button
              type="button"
              className="btn-primary text-xs mt-1"
              disabled={isBusy}
              onClick={onSyncNow}
            >
              {isBusy ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  name,
  progress,
  onRetry,
}: {
  name: string;
  progress: ProviderProgress;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-primary">{name}</span>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">{progressLabel(progress)}</span>
        {progress.phase === 'error' && (
          <button className="btn-ghost text-xs" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
