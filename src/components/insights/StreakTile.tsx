import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useTrainingActivityWindow } from '../../hooks/useTrainingActivity';
import { Skeleton } from '../Skeleton';

export function StreakTile() {
  const { profile } = useAuth();
  const grid = useTrainingActivityWindow(28);

  if (!profile) {
    return (
      <section className="card flex flex-col gap-3" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">Streak</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <div className="flex items-end gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-4 w-full mt-1" />
      </section>
    );
  }

  const current = profile.currentStreakDays;
  const longest = profile.longestStreakDays;

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Streak</span>
        <span className="text-text-secondary text-xs">
          Longest: <span className="text-text-primary tabular-nums">{longest}</span>
        </span>
      </header>
      <div className="flex items-end gap-3">
        <span className="text-4xl" aria-hidden>🔥</span>
        <div>
          <p className="text-3xl font-bold tabular-nums text-text-primary">
            {current}
          </p>
          <p className="text-text-secondary text-xs">
            day{current === 1 ? '' : 's'} in a row
          </p>
        </div>
      </div>
      {grid.data && (
        <div className="flex gap-1 mt-1" aria-label="Last 28 days of training activity">
          {grid.data.map((d) => (
            <span
              key={d.date}
              title={d.date}
              className={clsx(
                'flex-1 aspect-square rounded-sm',
                d.active ? 'bg-accent' : 'bg-surface-2',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
