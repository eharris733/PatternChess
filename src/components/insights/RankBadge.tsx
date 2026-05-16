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
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none border-2 border-[#1A1A1A] bg-white">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none border-2 border-[#1A1A1A] bg-white">
        <span className="font-mono uppercase text-xs tracking-tight text-gold-dark">
          {progress.current.name}
        </span>
        <span className="text-xs text-text-secondary tabular-nums">
          {reviewed.toLocaleString()} reviews
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
          Reviews: <span className="text-text-primary tabular-nums">{reviewed.toLocaleString()}</span>
        </span>
      </header>
      <div>
        <p className="heading-lg text-gold-dark">{progress.current.name}</p>
        <p className="text-text-secondary text-sm mt-1">
          {mastered.toLocaleString()} mastered
          {progress.next
            ? ` · ${progress.remainingToNext} until ${progress.next.name}`
            : ' · top tier reached'}
        </p>
      </div>
      <div className="h-2 rounded-none bg-[#1A1A1A]/10 overflow-hidden border border-[#1A1A1A]/20">
        <div
          className="h-full bg-gold-dark transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.round(progress.fraction * 100))}%` }}
        />
      </div>
    </section>
  );
}
