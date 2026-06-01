import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { retryWithProfile, useSyncStore } from '../state/syncStore';
import type { ProviderProgress } from '../services/syncService';

type Aggregate = 'none' | 'idle' | 'syncing' | 'done' | 'error';

function aggregate(
  hasLichess: boolean,
  hasChesscom: boolean,
  l: ProviderProgress,
  c: ProviderProgress,
): Aggregate {
  if (!hasLichess && !hasChesscom) return 'none';
  const states = [
    hasLichess ? l.phase : 'idle',
    hasChesscom ? c.phase : 'idle',
  ];
  if (
    states.includes('fetching') ||
    states.includes('inserting') ||
    states.includes('analyzing')
  ) {
    return 'syncing';
  }
  if (states.includes('error')) return 'error';
  if (states.includes('done')) return 'done';
  return 'idle';
}

export function SyncIndicator({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const providers = useSyncStore((s) => s.providers);
  const triggerNow = useSyncStore((s) => s.triggerNow);
  const [collapseDone, setCollapseDone] = useState(false);

  const hasLichess = !!profile?.lichessUsername;
  const hasChesscom = !!profile?.chesscomUsername;
  const agg = aggregate(hasLichess, hasChesscom, providers.lichess, providers.chesscom);
  const rateLimited =
    (hasLichess && providers.lichess.phase === 'error' && !!providers.lichess.rateLimited) ||
    (hasChesscom && providers.chesscom.phase === 'error' && !!providers.chesscom.rateLimited);

  useEffect(() => {
    setCollapseDone(false);
    if (agg === 'done') {
      const t = window.setTimeout(() => setCollapseDone(true), 4000);
      return () => window.clearTimeout(t);
    }
  }, [agg, providers.lichess.phase, providers.chesscom.phase]);

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
  const totalBlundersFound =
    (hasLichess ? providers.lichess.blundersFound : 0) +
    (hasChesscom ? providers.chesscom.blundersFound : 0);
  const isAnalyzing =
    (hasLichess && providers.lichess.phase === 'analyzing') ||
    (hasChesscom && providers.chesscom.phase === 'analyzing');

  const collapseToIdle = agg === 'done' && collapseDone;
  const display: Aggregate = collapseToIdle ? 'idle' : agg;

  const headline = (() => {
    if (display === 'none') return 'Connect account';
    if (display === 'syncing') {
      if (isAnalyzing) return 'Analyzing…';
      if (totalFetching > 0) return `Syncing ${totalInserted}/${totalFetching}`;
      return 'Syncing…';
    }
    if (display === 'done') {
      const parts: string[] = [];
      if (totalInserted > 0) parts.push(`+${totalInserted} games`);
      if (totalBlundersFound > 0) parts.push(`+${totalBlundersFound} blunders`);
      return parts.length > 0 ? parts.join(' · ') : 'Up to date';
    }
    if (display === 'error') return rateLimited ? 'Rate limited' : 'Sync failed';
    return 'Up to date';
  })();

  const glyph =
    display === 'syncing' ? (
      <span className="inline-block w-3.5 h-3.5 border-2 border-gold-dark border-t-transparent rounded-full animate-spin" />
    ) : display === 'done' ? (
      <span className="text-correct">✓</span>
    ) : display === 'error' ? (
      <span className="text-incorrect">✕</span>
    ) : display === 'none' ? (
      <span className="text-text-secondary">+</span>
    ) : (
      <span className="text-correct">✓</span>
    );

  const isBusy = display === 'syncing';

  const onClick = () => {
    if (display === 'none') {
      navigate('/profile');
      return;
    }
    if (isBusy || !profile) return;
    if (display === 'error') {
      if (hasLichess && providers.lichess.phase === 'error') {
        void retryWithProfile(profile, 'lichess');
      }
      if (hasChesscom && providers.chesscom.phase === 'error') {
        void retryWithProfile(profile, 'chess.com');
      }
      return;
    }
    void triggerNow(profile);
  };

  const subTitle = (() => {
    if (display === 'syncing') return null;
    if (display === 'none') return 'Sync games to start';
    if (display === 'error') return rateLimited ? 'Wait a minute, then tap to retry' : 'Tap to retry';
    return 'Tap to sync now';
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      aria-label={`Sync: ${headline}`}
      title={collapsed ? headline : undefined}
      className={clsx(
        'mx-2 mb-1 flex items-center gap-3 px-3 py-2 rounded-none font-mono uppercase text-xs tracking-tight transition-colors text-left',
        'text-text-secondary hover:bg-text-primary/5 hover:text-text-primary',
        'disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary',
        collapsed && 'justify-center',
      )}
    >
      <span className="shrink-0 w-4 flex items-center justify-center text-base">{glyph}</span>
      {!collapsed && (
        <span className="flex flex-col min-w-0">
          <span className="truncate text-text-primary">{headline}</span>
          {subTitle && (
            <span className="truncate text-[10px] tracking-tight text-text-secondary normal-case">
              {subTitle}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
