import clsx from 'clsx';
import type { TimeControlCategory } from '../../services/chessApiService';
import { useRatingProgress } from '../../hooks/useRatingProgress';
import { InsightCardSkeleton } from '../Skeleton';

const CATEGORY_LABEL: Record<TimeControlCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

// Enough games for the start→latest swing to mean something rather than noise.
const MIN_GAMES = 5;

export function RatingProgressCard() {
  const { progress, isPending } = useRatingProgress();
  if (isPending) return <InsightCardSkeleton rows={2} />;
  const rows = progress.filter((p) => p.games >= MIN_GAMES);
  if (rows.length === 0) return null;

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Rating progress</span>
        <span className="text-text-secondary text-xs">since you started</span>
      </header>
      <ul className="flex flex-col divide-y divide-[#1A1A1A]/15">
        {rows.map((p) => (
          <li key={p.category} className="flex items-center justify-between py-2.5 gap-3">
            <div className="min-w-0">
              <p className="text-text-primary text-sm font-semibold">{CATEGORY_LABEL[p.category]}</p>
              <p className="text-text-secondary text-xs tabular-nums">
                {p.startRating} → {p.latestRating} · {p.games.toLocaleString()} games
              </p>
            </div>
            <span
              className={clsx(
                'font-mono tabular-nums text-sm px-2 py-0.5 rounded-none border-2',
                p.delta > 0
                  ? 'bg-correct/15 text-correct border-correct/50'
                  : p.delta < 0
                    ? 'bg-incorrect/15 text-incorrect border-incorrect/50'
                    : 'bg-surface-3 text-text-secondary border-[#1A1A1A]',
              )}
            >
              {p.delta >= 0 ? '+' : ''}
              {p.delta}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
