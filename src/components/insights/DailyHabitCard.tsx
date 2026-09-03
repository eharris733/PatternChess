import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useAchievements } from '../../hooks/useAchievements';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { dailyGoalProgress } from '../../lib/dailyGoal';
import { nearestAchievement } from '../../lib/achievements';
import { addDays, detectTimezone, localDate } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { TrophyIcon } from '../icons/TrophyIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { Skeleton } from '../Skeleton';

/** How many endgame play-outs the plan suggests per day (the list may hold more). */
const PLAYOUTS_PER_DAY = 2;

/**
 * Today's plan: progress toward the daily goal, the streak, and the two things
 * to do — due positions (the SR queue) and endgame play-outs waiting on the
 * Endgames tab. Finished play-outs count toward the goal alongside drills.
 */
export function DailyHabitCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();
  const dueQuery = useDueBlunders();
  const scenariosQuery = useEndgameScenarios();
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
          <span className="label">Today's plan</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-2 w-full" />
      </section>
    );
  }

  const scenarios = scenariosQuery.data ?? [];
  const playoutsToday = scenarios.filter(
    (s) => s.lastPlayedAt && localDate(tz, s.lastPlayedAt) === today,
  ).length;
  const playoutsWaiting = scenarios.filter((s) => s.status !== 'passed').length;
  const dueCount = dueQuery.data?.length ?? 0;

  const progress = dailyGoalProgress((drillsQuery.data ?? 0) + playoutsToday);
  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Today's plan</span>
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
        <span className="font-mono text-4xl tracking-tight text-gold-dark">
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
            `${progress.remaining} to go`
          )}
        </span>
      </div>

      <div className="h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="h-full bg-gold-dark transition-[width] duration-300"
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>

      <ul className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10">
        <li>
          <button
            type="button"
            className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-text-primary/5 transition"
            onClick={() => navigate('/training')}
          >
            <TrainIcon className="h-4 w-4 shrink-0 text-gold-dark" />
            <span className="flex-1 text-sm text-text-primary">
              {dueQuery.isPending ? (
                <Skeleton className="h-4 w-32" />
              ) : dueCount > 0 ? (
                `${dueCount} position${dueCount === 1 ? '' : 's'} due`
              ) : (
                'No positions due — all caught up'
              )}
            </span>
            <span className="font-mono text-xs uppercase tracking-tight text-text-secondary">
              Train
            </span>
          </button>
        </li>
        {playoutsWaiting > 0 && (
          <li>
            <button
              type="button"
              className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-text-primary/5 transition"
              onClick={() => navigate('/endgames')}
            >
              <EndgameIcon className="h-4 w-4 shrink-0 text-gold-dark" />
              <span className="flex-1 text-sm text-text-primary">
                {playoutsWaiting} endgame play-out{playoutsWaiting === 1 ? '' : 's'} waiting
                <span className="text-text-secondary">
                  {' '}
                  · play {Math.min(PLAYOUTS_PER_DAY, playoutsWaiting)} today
                </span>
              </span>
              <span className="font-mono text-xs uppercase tracking-tight text-text-secondary">
                Play
              </span>
            </button>
          </li>
        )}
      </ul>

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
