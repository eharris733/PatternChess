import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useTrainingActivityWindow } from '../../hooks/useTrainingActivity';

export function StreakTile() {
  const { profile } = useAuth();
  const grid = useTrainingActivityWindow(28);

  if (!profile) return null;

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
