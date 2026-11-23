import { useBlunderStats } from '../../hooks/useBlunderStats';
import { rankFor } from '../../lib/ranks';
import { SPACED_REPETITION_DAYS } from '../../models/blunder';
import { Skeleton } from '../Skeleton';
import { useT } from '../../i18n/useT';

interface RankBadgeProps {
  variant?: 'compact' | 'full';
}

export function RankBadge({ variant = 'full' }: RankBadgeProps) {
  const t = useT();
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
          {t.label('rank', progress.current.name, progress.current.name)}
        </span>
        <span className="text-xs text-text-primary tabular-nums">
          {t('rank.masteredShort', { count: mastered })}
        </span>
      </div>
    );
  }

  if (isInitialLoad) {
    return (
      <section className="card flex flex-col gap-3" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">{t('rank.label')}</span>
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
        <span className="label">{t('rank.label')}</span>
        <span className="text-text-primary text-xs">
          {progress.next
            ? t('rank.untilNext', { count: progress.remainingToNext, name: t.label('rank', progress.next.name, progress.next.name) })
            : t('rank.topTier')}
        </span>
      </header>
      <div>
        <p className="heading-lg text-gold-dark">{t.label('rank', progress.current.name, progress.current.name)}</p>
        <p className="text-text-primary text-sm mt-1">
          {t.rich(
            'rank.mastered',
            { count: <span className="text-text-primary tabular-nums">{mastered.toLocaleString()}</span> },
            mastered,
          )}
        </p>
      </div>
      <div className="h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="h-full bg-gold-dark transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.round(progress.fraction * 100))}%` }}
        />
      </div>
      <p className="text-text-primary text-xs">
        {t('rank.help', { cycles: SPACED_REPETITION_DAYS.length })}
        <span className="ml-1">{t('rank.reviews', { count: reviewed })}</span>
      </p>
    </section>
  );
}
