import { useBlunderStats } from '../../hooks/useBlunderStats';
import { rankFor } from '../../lib/ranks';

interface RankBadgeProps {
  variant?: 'compact' | 'full';
}

export function RankBadge({ variant = 'full' }: RankBadgeProps) {
  const stats = useBlunderStats();
  const reviewed = stats.data?.reviewed ?? 0;
  const mastered = stats.data?.mastered ?? 0;
  const progress = rankFor(mastered);

  if (variant === 'compact') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-2/70 border border-surface-2">
        <span className="text-xs font-semibold text-accent">{progress.current.name}</span>
        <span className="text-xs text-text-secondary tabular-nums">
          {reviewed.toLocaleString()} reviews
        </span>
      </div>
    );
  }

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Rank</span>
        <span className="text-text-secondary text-xs">
          Reviews: <span className="text-text-primary tabular-nums">{reviewed.toLocaleString()}</span>
        </span>
      </header>
      <div>
        <p className="heading-lg text-accent">{progress.current.name}</p>
        <p className="text-text-secondary text-sm mt-1">
          {mastered.toLocaleString()} mastered
          {progress.next
            ? ` · ${progress.remainingToNext} until ${progress.next.name}`
            : ' · top tier reached'}
        </p>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.round(progress.fraction * 100))}%` }}
        />
      </div>
    </section>
  );
}
