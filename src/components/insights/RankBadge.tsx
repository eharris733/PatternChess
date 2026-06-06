import { useBlunderStats } from '../../hooks/useBlunderStats';
import { rankFor } from '../../lib/ranks';
import { Skeleton } from '../Skeleton';

interface RankBadgeProps {
  variant?: 'compact' | 'full';
}

export function RankBadge({ variant = 'full' }: RankBadgeProps) {
  const stats = useBlunderStats();
  const isInitialLoad = stats.isPending;
  const reviewed = stats.data?.reviewed ?? 0;
  const mastered = stats.data?.mastered ?? 0;
  const progress = rankFor(mastered);

  if (variant === 'compact') {
    if (isInitialLoad) {
      return (
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none border-2 border-text-primary bg-surface">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none border-2 border-text-primary bg-surface">
        <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">
          {progress.current.name}
        </span>
        <span className="text-xs text-text-secondary tabular-nums">
          {mastered.toLocaleString()} mastered
        </span>
      </div>
    );
  }

  if (isInitialLoad) {
    return (
      <section className="card flex flex-col gap-3" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">Rank</span>
          <Skeleton className="h-3 w-24" />
        </header>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Rank</span>
        <span className="text-text-secondary text-xs">
          {progress.next
            ? `${progress.remainingToNext} mastered until ${progress.next.name}`
            : 'Top tier reached'}
        </span>
      </header>
      <div>
        <p className="heading-lg text-gold-dark">{progress.current.name}</p>
        <p className="text-text-secondary text-sm mt-1">
          <span className="text-text-primary tabular-nums">{mastered.toLocaleString()}</span> position
          {mastered === 1 ? '' : 's'} mastered
        </p>
      </div>
      <div className="h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="h-full bg-gold-dark transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.round(progress.fraction * 100))}%` }}
        />
      </div>
      <p className="text-text-secondary text-xs">
        Ranks advance as you master positions — 7 spaced cycles at ≥80% recall.
        <span className="ml-1 opacity-70">{reviewed.toLocaleString()} reviews total.</span>
      </p>
    </section>
  );
}
