import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-2/60', className)} />;
}

export function InsightCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="card flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-3.5 w-32" />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </section>
  );
}
