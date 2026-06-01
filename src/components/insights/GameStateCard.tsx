import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  GAME_STATE_LABEL,
  GAME_STATE_ORDER,
  GameStateBucket,
} from '../../chess/blunderContext';
import { useGameStateInsight } from '../../hooks/useInsights';
import { InsightCardSkeleton } from '../Skeleton';

const MIN_BLUNDERS = 20;

function pct(n: number, total: number): number {
  return total > 0 ? (n / total) * 100 : 0;
}

const BAR_COLOR: Record<GameStateBucket, string> = {
  missedWin: 'bg-mistake',
  roughlyEqual: 'bg-gold-dark',
  alreadyLosing: 'bg-[#5A5A5A]',
};

export function GameStateCard() {
  const navigate = useNavigate();
  const insight = useGameStateInsight();
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const stats = insight.data;
  if (stats.total < MIN_BLUNDERS) return null;

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Position when blundering</span>
        <span className="text-text-secondary text-xs tabular-nums">
          {stats.total.toLocaleString()} total
        </span>
      </header>
      <div className="flex flex-col divide-y divide-text-primary/15">
        {GAME_STATE_ORDER.map((bucket) => {
          const slot = stats.byBucket[bucket];
          const sharePct = pct(slot.count, stats.total);
          return (
            <button
              key={bucket}
              type="button"
              onClick={() =>
                navigate('/training', { state: { contextFilter: bucket } })
              }
              className="flex flex-col gap-1.5 py-2.5 px-1 text-left hover:bg-text-primary/5 rounded-none transition-colors"
            >
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-text-primary">{GAME_STATE_LABEL[bucket]}</span>
                <span className="tabular-nums text-text-secondary">
                  <span className="text-text-primary">{slot.count}</span> ({Math.round(sharePct)}%)
                </span>
              </div>
              <div className="relative h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
                <div
                  className={clsx('absolute inset-y-0 left-0 rounded-none', BAR_COLOR[bucket])}
                  style={{ width: `${Math.min(100, sharePct)}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-text-secondary text-xs">
        Missed wins are blundered from a winning position; already-losing blunders
        happen when you were already behind.
      </p>
    </section>
  );
}
