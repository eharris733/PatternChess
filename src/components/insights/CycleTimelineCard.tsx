import { useCycleDistribution } from '../../hooks/useCycleDistribution';
import { SR_BUCKET_LABEL } from '../../models/blunder';
import { Skeleton } from '../Skeleton';

/**
 * The woodpecker-ladder progress view: how many of your positions sit at each
 * rung, from New through each spaced cycle to Mastered. Reuses SR_BUCKET_LABEL
 * for the named buckets; the numbered rungs are ladder positions, not new
 * state labels.
 */
export function CycleTimelineCard() {
  const { data, isPending } = useCycleDistribution();

  if (isPending) {
    return (
      <section className="card flex flex-col gap-4" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">Training timeline</span>
        </header>
        <Skeleton className="h-20 w-full" />
      </section>
    );
  }

  // Nothing to show until the user has positions to train.
  if (!data || data.total === 0) return null;

  const rungs = [
    { key: 'new', label: SR_BUCKET_LABEL.new, count: data.newCount, tone: 'muted' as const },
    ...data.learningByCycle.map((c) => ({
      key: `c${c.cycle}`,
      label: `Cycle ${c.cycle}`,
      count: c.count,
      tone: 'gold' as const,
    })),
    { key: 'mastered', label: SR_BUCKET_LABEL.mastered, count: data.mastered, tone: 'gold' as const },
  ];
  const maxCount = Math.max(1, ...rungs.map((r) => r.count));

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Training timeline</span>
      </header>
      <div className="flex items-end gap-3">
        <span className="font-mono text-4xl tabular-nums tracking-tight text-gold-dark">
          {data.total}
        </span>
        <span className="text-text-secondary mb-1">
          blunder{data.total === 1 ? '' : 's'} in vault
        </span>
      </div>
      <p className="text-text-secondary text-sm">
        How they're spread across the spaced-repetition ladder — new to mastered.
      </p>

      <div className="flex items-end gap-1.5">
        {rungs.map((r) => {
          const barHeight = r.count > 0 ? Math.round((r.count / maxCount) * 56) + 8 : 2;
          return (
            <div key={r.key} className="flex flex-1 min-w-0 flex-col items-center gap-1">
              <span className="font-mono text-xs tabular-nums text-gold-dark">{r.count}</span>
              <div
                className={
                  r.count > 0
                    ? 'w-full border-2 border-text-primary bg-gold-dark/80'
                    : 'w-full border-2 border-text-primary/30 bg-text-primary/5'
                }
                style={{ height: `${barHeight}px` }}
                aria-hidden
              />
              <span className="text-center font-mono text-[9px] uppercase leading-tight tracking-tight text-text-secondary">
                {r.label}
              </span>
            </div>
          );
        })}
      </div>

      {data.tryAgain > 0 && (
        <p className="text-text-secondary text-xs">
          <span className="font-mono text-mistake">{data.tryAgain}</span>{' '}
          {SR_BUCKET_LABEL.tryAgain.toLowerCase()} — missed last time, back in the queue.
        </p>
      )}
    </section>
  );
}
