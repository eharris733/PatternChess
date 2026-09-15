import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useLeaderboard } from '../../hooks/useLeaderboard';
import type {
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardWindow,
} from '../../services/db/leaderboard';
import { Skeleton } from '../Skeleton';

const METRICS: Array<{ id: LeaderboardMetric; label: string; hint: string }> = [
  { id: 'solved', label: 'Solved', hint: 'Positions recalled correctly on the first try' },
  { id: 'mastered', label: 'Mastered', hint: 'Positions taken through the whole spaced-repetition ladder' },
  { id: 'elo', label: 'Elo gained', hint: 'Rating points gained since joining, across time controls' },
  { id: 'streak', label: 'Streak', hint: 'Consecutive days trained' },
];

const WINDOWS: Array<{ id: LeaderboardWindow; label: string }> = [
  { id: 'all', label: 'All-time' },
  { id: 'week', label: 'This week' },
];

function formatValue(metric: LeaderboardMetric, value: number): string {
  switch (metric) {
    case 'elo':
      return `+${value.toLocaleString()}`;
    case 'streak':
      return `${value.toLocaleString()} ${value === 1 ? 'day' : 'days'}`;
    default:
      return value.toLocaleString();
  }
}

function windowHint(metric: LeaderboardMetric, window: LeaderboardWindow): string {
  if (window === 'all') return metric === 'streak' ? 'Longest streak ever' : 'Since joining';
  return metric === 'streak' ? 'Current streak' : 'Since Monday';
}

export function LeaderboardPanel() {
  const { profile } = useAuth();
  const [metric, setMetric] = useState<LeaderboardMetric>('solved');
  const [window, setWindow] = useState<LeaderboardWindow>('all');
  const query = useLeaderboard(metric, window);
  const board = query.data;
  const meInTop = board?.rows.some((r) => r.isMe) ?? false;
  const optedOut = profile?.leaderboardOptOut ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Leaderboard metric" className="flex flex-wrap gap-1.5">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              title={m.hint}
              onClick={() => setMetric(m.id)}
              className={clsx(
                'px-3 py-1.5 text-xs font-mono uppercase tracking-tight border-2 rounded-none transition-colors',
                metric === m.id
                  ? 'bg-text-primary text-bg border-text-primary'
                  : 'bg-surface text-text-primary border-text-primary hover:bg-accent/15',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="Leaderboard window" className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={window === w.id}
              onClick={() => setWindow(w.id)}
              className={clsx(
                'px-3 py-1.5 text-xs border-2 rounded-none transition-colors',
                window === w.id
                  ? 'bg-accent/20 border-accent text-text-primary'
                  : 'bg-surface border-text-primary/40 text-text-secondary hover:border-text-primary',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <section className="card flex flex-col gap-3" data-testid="leaderboard">
        <header className="flex items-baseline justify-between">
          <span className="label">{METRICS.find((m) => m.id === metric)?.label}</span>
          <span className="text-text-secondary text-xs">{windowHint(metric, window)}</span>
        </header>

        {query.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="text-incorrect text-sm">
            Couldn&rsquo;t load the leaderboard. If this keeps happening, the leaderboard migration
            may not be applied yet.
          </p>
        ) : !board || board.rows.length === 0 ? (
          <p className="text-text-secondary text-sm">
            Nobody has a score here yet{window === 'week' ? ' this week' : ''}. Train a few positions
            and check back.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-text-primary/15">
            {board.rows.map((r) => (
              <Row key={`${r.rank}-${r.label}`} row={r} metric={metric} />
            ))}
            {board.me && !meInTop && (
              <>
                <li aria-hidden className="py-1 text-center text-text-secondary text-xs">
                  &hellip;
                </li>
                <Row row={board.me} metric={metric} />
              </>
            )}
          </ol>
        )}

        <p className="text-text-secondary text-xs">
          {optedOut ? (
            <>
              You&rsquo;re hidden from leaderboards.{' '}
              <Link to="/profile" className="underline hover:no-underline">
                Show yourself in Profile
              </Link>
              .
            </>
          ) : (
            <>
              Shown as your Lichess or Chess.com username, or your display name. Prefer to stay
              off the boards?{' '}
              <Link to="/profile" className="underline hover:no-underline">
                Opt out in Profile
              </Link>
              .
            </>
          )}
        </p>
      </section>
    </div>
  );
}

function Row({ row, metric }: { row: LeaderboardRow; metric: LeaderboardMetric }) {
  return (
    <li
      className={clsx(
        'flex items-center gap-3 py-2 text-sm',
        row.isMe && 'bg-accent/10 -mx-2 px-2',
      )}
      data-testid={row.isMe ? 'leaderboard-me' : undefined}
    >
      <span
        className={clsx(
          'w-8 shrink-0 font-mono tabular-nums text-right',
          row.rank <= 3 ? 'text-gold-dark' : 'text-text-secondary',
        )}
      >
        {row.rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-primary">
        {row.label}
        {row.isMe && <span className="ml-2 text-xs text-text-secondary">(you)</span>}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-text-primary">
        {formatValue(metric, row.value)}
      </span>
    </li>
  );
}
