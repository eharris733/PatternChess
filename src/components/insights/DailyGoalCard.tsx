import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { dailyGoalProgress } from '../../lib/dailyGoal';
import { addDays, detectTimezone, localDate } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { Skeleton } from '../Skeleton';

/**
 * Daily-return hook: progress toward today's drill goal plus the current
 * streak. The point is to give a reason to come back tomorrow — hitting the
 * goal extends the streak.
 */
export function DailyGoalCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();

  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  const yesterday = addDays(today, -1);
  const last = profile?.lastDrillLocalDate ?? null;
  const streakStale = !last || (last !== today && last !== yesterday);
  const streakDays = profile?.currentStreakDays ?? 0;

  if (drillsQuery.isPending) {
    return (
      <section className="card flex flex-col gap-4" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">Daily goal</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-2 w-full" />
      </section>
    );
  }

  const progress = dailyGoalProgress(drillsQuery.data ?? 0);

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Daily goal</span>
        {streakDays > 0 && (
          <span
            className={streakStale ? 'flex items-center gap-1.5 opacity-50' : 'flex items-center gap-1.5'}
            title={
              streakStale
                ? `Streak: ${streakDays} (resets on next drill — last drill ${last ?? 'never'})`
                : `${streakDays}-day streak`
            }
          >
            <FlameIcon className="h-4 w-4" />
            <span className="text-sm tabular-nums">
              <span className="font-mono font-semibold text-gold-dark">{streakDays}</span>
              <span className="text-text-secondary"> day{streakDays === 1 ? '' : 's'}</span>
            </span>
          </span>
        )}
      </header>

      <div className="flex items-end gap-3">
        <span className="font-mono text-4xl tabular-nums tracking-tight text-gold-dark">
          {progress.done}
          <span className="text-text-secondary text-2xl">/{progress.goal}</span>
        </span>
        <span className="text-text-secondary mb-1">
          {progress.met ? (
            <span className="text-correct inline-flex items-center gap-1.5">
              <CheckIcon className="h-4 w-4" title="Daily goal complete" />
              Goal complete
            </span>
          ) : (
            `${progress.remaining} drill${progress.remaining === 1 ? '' : 's'} to go`
          )}
        </span>
      </div>

      <div className="h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="h-full bg-gold-dark transition-[width] duration-300"
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>

      <p className="text-text-secondary text-sm">
        {progress.met
          ? streakDays > 0
            ? `Nice — you've kept a ${streakDays}-day streak. Come back tomorrow to extend it.`
            : 'Goal hit. Come back tomorrow to start a streak.'
          : streakStale && streakDays > 0
            ? 'Drill today to keep your streak alive.'
            : 'Finish your daily drills to build a streak.'}
      </p>

      {!progress.met && (
        <div>
          <button className="btn-primary" onClick={() => navigate('/training')}>
            {progress.done > 0 ? 'Keep training' : 'Start training'}
          </button>
        </div>
      )}
    </section>
  );
}
