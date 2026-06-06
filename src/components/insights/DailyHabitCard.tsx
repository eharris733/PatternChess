import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useAchievements } from '../../hooks/useAchievements';
import { dailyGoalProgress } from '../../lib/dailyGoal';
import { nearestAchievement } from '../../lib/achievements';
import { addDays, detectTimezone, localDate } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { TrophyIcon } from '../icons/TrophyIcon';
import { Skeleton } from '../Skeleton';

/**
 * Daily-return hook: progress toward today's drill goal plus the current
 * streak. Named "Daily habit" to sit alongside the "Today's goals" (due-blunder)
 * card without a name clash — this one is about showing up every day.
 */
export function DailyHabitCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();
  const { achievements } = useAchievements();

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
          <span className="label">Daily habit</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-2 w-full" />
      </section>
    );
  }

  const progress = dailyGoalProgress(drillsQuery.data ?? 0);
  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Daily habit</span>
        {streakDays > 0 && (
          <span
            className={streakStale ? 'flex items-center gap-1.5 opacity-50' : 'flex items-center gap-1.5'}
            title={
              streakStale
                ? `Streak: ${streakDays} (resets on your next drill — last drill ${last ?? 'never'})`
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

      <button className="btn-primary w-full" onClick={() => navigate('/training')}>
        {progress.done > 0 ? 'Keep training' : 'Start training'}
      </button>

      {next && (
        <button
          type="button"
          onClick={() => navigate('/achievements')}
          className="flex flex-col gap-1.5 border-t-2 border-text-primary/15 pt-3 text-left transition-opacity hover:opacity-90"
        >
          <div className="flex items-baseline justify-between">
            <span className="label">Next achievement</span>
            <span className="text-text-secondary text-xs tabular-nums">
              {Math.min(next.value, next.threshold).toLocaleString()}/{next.threshold.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrophyIcon className="h-4 w-4 shrink-0 text-gold-dark" />
            <span className="text-sm text-text-primary">{next.title}</span>
            <span className="truncate text-text-secondary text-xs">— {next.description}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-none border border-text-primary/20 bg-text-primary/10">
            <div
              className="h-full bg-gold-dark transition-[width] duration-300"
              style={{ width: `${Math.round(next.fraction * 100)}%` }}
            />
          </div>
        </button>
      )}

    </section>
  );
}
