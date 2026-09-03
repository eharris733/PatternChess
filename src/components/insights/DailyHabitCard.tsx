import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useAchievements } from '../../hooks/useAchievements';
import { useDueBlunders } from '../../hooks/useDueBlunders';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { DAILY_GOAL } from '../../lib/dailyGoal';
import { nearestAchievement } from '../../lib/achievements';
import { detectTimezone, localDate } from '../../services/streakService';
import { CheckIcon } from '../icons/CheckIcon';
import { TrophyIcon } from '../icons/TrophyIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { Skeleton } from '../Skeleton';

/** Endgame play-outs the plan asks for per day (the list may hold many more). */
export const PLAYOUTS_PER_DAY = 2;

function PlanStep({
  icon,
  title,
  detail,
  done,
  goal,
  action,
  onAction,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string | null;
  done: number;
  goal: number;
  action: string;
  onAction: () => void;
  loading?: boolean;
}) {
  const complete = done >= goal;
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={clsx(
          'flex h-6 w-6 shrink-0 items-center justify-center border-2',
          complete
            ? 'border-correct bg-correct/15 text-correct'
            : 'border-text-primary/30 bg-surface text-transparent',
        )}
        aria-hidden
      >
        <CheckIcon className="h-4 w-4" />
      </span>
      <span className="shrink-0 text-gold-dark">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className={clsx('block text-sm', complete ? 'text-text-secondary line-through' : 'text-text-primary')}>
          {title}
        </span>
        {detail && <span className="block text-xs text-text-secondary truncate">{detail}</span>}
      </span>
      {loading ? (
        <Skeleton className="h-4 w-10" />
      ) : (
        <span className="font-mono text-sm tabular-nums text-text-secondary shrink-0">
          {Math.min(done, goal)}/{goal}
        </span>
      )}
      <button
        type="button"
        className={clsx(complete ? 'btn-outline' : 'btn-primary', 'h-9 px-4 text-xs shrink-0')}
        onClick={onAction}
      >
        {action}
      </button>
    </li>
  );
}

/**
 * Today's plan: a checklist of the two things to do — drill the SR queue and
 * play a couple of endgame play-outs — each with its own progress, check, and
 * button. (The streak lives in the sidebar badge and on the profile.)
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

  if (drillsQuery.isPending) {
    return (
      <section className="card flex flex-col gap-4" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">Today's plan</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
    );
  }

  const scenarios = scenariosQuery.data ?? [];
  const playoutsToday = scenarios.filter(
    (s) => s.lastPlayedAt && localDate(tz, s.lastPlayedAt) === today,
  ).length;
  const playoutsWaiting = scenarios.filter((s) => s.status !== 'passed').length;
  const showEndgames = playoutsWaiting > 0 || playoutsToday > 0;
  const drillsToday = drillsQuery.data ?? 0;
  const dueCount = dueQuery.data?.length ?? 0;

  const steps = [
    { done: drillsToday, goal: DAILY_GOAL },
    ...(showEndgames ? [{ done: playoutsToday, goal: PLAYOUTS_PER_DAY }] : []),
  ];
  const stepsDone = steps.filter((s) => s.done >= s.goal).length;
  const allDone = stepsDone === steps.length;
  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Today's plan</span>
        <span
          className={clsx(
            'font-mono text-xs uppercase tracking-tight inline-flex items-center gap-1.5',
            allDone ? 'text-correct' : 'text-text-secondary',
          )}
        >
          {allDone && <CheckIcon className="h-3.5 w-3.5" title="Plan complete" />}
          {allDone ? 'All done today' : `${stepsDone}/${steps.length} done`}
        </span>
      </header>

      <ul className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10">
        <PlanStep
          icon={<TrainIcon className="h-4 w-4" />}
          title={`Train ${DAILY_GOAL} positions`}
          detail={
            dueQuery.isPending
              ? null
              : dueCount > 0
                ? `${dueCount} due in your queue`
                : 'Queue is clear — drills still count'
          }
          done={drillsToday}
          goal={DAILY_GOAL}
          action="Train"
          onAction={() => navigate('/training')}
        />
        {showEndgames && (
          <PlanStep
            icon={<EndgameIcon className="h-4 w-4" />}
            title={`Play ${PLAYOUTS_PER_DAY} endgames`}
            detail={`${playoutsWaiting} play-out${playoutsWaiting === 1 ? '' : 's'} waiting`}
            done={playoutsToday}
            goal={PLAYOUTS_PER_DAY}
            action="Play"
            onAction={() => navigate('/endgames')}
            loading={scenariosQuery.isPending && scenariosQuery.isFetching}
          />
        )}
      </ul>

      {next && (
        <button
          type="button"
          onClick={() => navigate('/achievements')}
          className="flex flex-col gap-1.5 pt-1 text-left transition-opacity hover:opacity-90"
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
