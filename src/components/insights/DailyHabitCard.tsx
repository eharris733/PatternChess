import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useAchievements } from '../../hooks/useAchievements';
import { useDueCount } from '../../hooks/useDueCount';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { useDrillsOfKind } from '../../hooks/useDrillsOfKind';
import { isScenarioDue } from '../../models/endgameScenario';
import { COMMITMENT_LABEL, DEFAULT_DAILY_GOALS } from '../../lib/dailyGoal';
import { useGamesPlayedToday } from '../../hooks/useGamesPlayedToday';
import { useSyncStore } from '../../state/syncStore';
import { streakNoticeText, useStreakNoticeStore } from '../../state/streakNoticeStore';
import { nearestAchievement } from '../../lib/achievements';
import { detectTimezone, localDate } from '../../services/streakService';
import { CheckIcon } from '../icons/CheckIcon';
import { TrophyIcon } from '../icons/TrophyIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { OpeningIcon } from '../icons/OpeningIcon';
import { KingIcon } from '../icons/KingIcon';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { Skeleton } from '../Skeleton';
import { usePathProgress } from '../../hooks/usePathProgress';
import { useFeature } from '../../hooks/useFeature';

/** Endgame play-outs the plan asks for per day (the list may hold many more). */
export const PLAYOUTS_PER_DAY = 2;
/** Opening reviews the plan asks for per day, when any are due. */
export const OPENINGS_PER_DAY = 3;

function PlanStep({
  icon,
  title,
  detail,
  done,
  goal,
  action,
  onAction,
  href,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  done: number;
  goal: number;
  action: string;
  onAction?: () => void;
  /** External link (opens a new tab) instead of `onAction`. */
  href?: string;
  loading?: boolean;
}) {
  const complete = done >= goal;
  return (
    <li className="flex items-center gap-3 py-3" data-plan-step>
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
        {detail && (
          <span className={clsx('block text-xs text-text-primary', typeof detail === 'string' && 'truncate')}>
            {detail}
          </span>
        )}
      </span>
      {loading ? (
        <Skeleton className="h-4 w-10" />
      ) : (
        <span className="font-mono text-sm tabular-nums text-text-primary shrink-0">
          {Math.min(done, goal)}/{goal}
        </span>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx(complete ? 'btn-outline' : 'btn-primary', 'h-9 px-4 text-xs shrink-0')}
        >
          {action}
        </a>
      ) : (
        <button
          type="button"
          className={clsx(complete ? 'btn-outline' : 'btn-primary', 'h-9 px-4 text-xs shrink-0')}
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </li>
  );
}

/** Placeholder row shown while the endgame scenario scan is still running, so
 * the endgame step reserves its space instead of popping in after the Train
 * step has already rendered. */
function PlanStepSkeleton() {
  return (
    <li className="flex items-center gap-3 py-3" data-plan-step aria-hidden>
      <Skeleton className="h-6 w-6 shrink-0" />
      <Skeleton className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-0">
        <Skeleton className="h-4 w-32" />
      </span>
      <Skeleton className="h-4 w-10 shrink-0" />
      <Skeleton className="h-9 w-16 shrink-0" />
    </li>
  );
}

/** Where the Play step sends you: the platform you sync from (Lichess first). */
function playUrl(lichess: string | null, chesscom: string | null): string | null {
  if (lichess) return 'https://lichess.org/';
  if (chesscom) return 'https://www.chess.com/play/online';
  return null;
}

/**
 * Today's plan: a checklist sized by the player's commitment level — play
 * games (detected from sync), drill the SR queue, review openings, play
 * endgames — each with its own progress, check, and button. (The streak lives
 * in the sidebar badge and on the profile.)
 */
export function DailyHabitCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();
  // Count only: the full due list (solution lines, drill data) was downloaded
  // here just to show its length.
  const dueQuery = useDueCount({ excludeKind: 'opening' });
  const scenariosQuery = useEndgameScenarios();
  const openingDrillsQuery = useDrillsOfKind('opening');
  const { achievements } = useAchievements();
  const gamesTodayQuery = useGamesPlayedToday();
  const syncing = useSyncStore((s) =>
    Object.values(s.providers).some((p) => p.phase === 'fetching' || p.phase === 'inserting' || p.phase === 'analyzing'),
  );
  const triggerSync = useSyncStore((s) => s.triggerNow);
  const notice = useStreakNoticeStore((s) => s.notice);
  const clearNotice = useStreakNoticeStore((s) => s.clear);
  const path = usePathProgress();
  const pathOn = useFeature('path');
  const goals = profile?.dailyGoals ?? DEFAULT_DAILY_GOALS;
  const playHref = playUrl(profile?.lichessUsername ?? null, profile?.chesscomUsername ?? null);
  // PGN-only players have nothing to sync, so the Play step can't detect games.
  const showPlay = goals.gamesPerDay > 0 && playHref != null;

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

  // The endgame step depends on games → scenario scan, which resolves after the
  // drills query. Reserve its row with a skeleton while that's still pending so
  // the two steps appear together rather than the endgame step sliding in late.
  const scenariosPending = scenariosQuery.isPending;
  const scenarios = scenariosQuery.data ?? [];
  const playoutsToday = scenarios.filter(
    (s) => s.lastPlayedAt && localDate(tz, s.lastPlayedAt) === today,
  ).length;
  const playoutsDue = scenarios.filter((s) => isScenarioDue(s)).length;
  const showEndgames = playoutsDue > 0 || playoutsToday > 0;

  // Openings: drills done today vs due now. The goal counts today's work in,
  // so it doesn't shrink as you clear the due ones.
  const openingDrills = [...(openingDrillsQuery.data?.values() ?? [])].filter(
    (b) => b.kind === 'opening',
  );
  const openingsToday = openingDrills.filter(
    (b) => b.lastDrilledAt && localDate(tz, b.lastDrilledAt) === today,
  ).length;
  const now = Date.now();
  // Same rule as the due queue: next_drill_at <= now (retired rows are
  // already excluded by useDrillsOfKind).
  const openingsDue = openingDrills.filter(
    (b) => b.nextDrillAt && b.nextDrillAt.getTime() <= now,
  ).length;
  const openingsGoal = Math.min(OPENINGS_PER_DAY, openingsDue + openingsToday);
  const showOpenings = openingsGoal > 0;
  const drillsToday = drillsQuery.data ?? 0;
  // Openings have their own step; the train step's "due" excludes them.
  const dueCount = dueQuery.data ?? 0;

  const gamesToday = gamesTodayQuery.data ?? 0;

  const steps = [
    ...(showPlay ? [{ done: gamesToday, goal: goals.gamesPerDay }] : []),
    { done: drillsToday, goal: goals.positionsPerDay },
    ...(showOpenings ? [{ done: openingsToday, goal: openingsGoal }] : []),
    ...(showEndgames ? [{ done: playoutsToday, goal: PLAYOUTS_PER_DAY }] : []),
  ];
  const stepsDone = steps.filter((s) => s.done >= s.goal).length;
  const allDone = stepsDone === steps.length;
  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">
          Today's plan
          <button
            type="button"
            onClick={() => navigate('/profile#commitment')}
            className="ml-2 normal-case tracking-normal text-text-secondary underline-offset-2 hover:underline"
            title="Change your daily commitment"
            data-testid="commitment-level"
          >
            {COMMITMENT_LABEL[goals.level]}
          </button>
        </span>
        {scenariosPending ? (
          <Skeleton className="h-3 w-20" />
        ) : (
          <span
            className={clsx(
              'font-mono text-xs uppercase tracking-tight inline-flex items-center gap-1.5',
              allDone ? 'text-correct' : 'text-text-secondary',
            )}
          >
            {allDone && <CheckIcon className="h-3.5 w-3.5" title="Plan complete" />}
            {allDone ? 'Plan done. See you tomorrow.' : `${stepsDone}/${steps.length} done`}
          </span>
        )}
      </header>

      {notice && (
        <div className="flex items-start gap-2 border-2 border-accent/40 bg-accent/10 px-3 py-2 text-sm" role="status">
          <SnowflakeIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span className="flex-1 text-text-primary">{streakNoticeText(notice)}</span>
          <button type="button" onClick={clearNotice} aria-label="Dismiss" className="shrink-0 text-text-secondary">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10">
        {showPlay && playHref && profile && (
          <PlanStep
            icon={<KingIcon color="white" className="h-4 w-4" />}
            title={`Play ${goals.gamesPerDay} ${goals.gamesPerDay === 1 ? 'game' : 'games'}`}
            detail={
              <>
                {syncing ? 'Checking for new games…' : 'Your new blunders become tomorrow\'s training.'}{' '}
                {!syncing && (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-gold-dark"
                    onClick={() => void triggerSync(profile)}
                    data-testid="check-new-games"
                  >
                    Check for new games
                  </button>
                )}
              </>
            }
            done={gamesToday}
            goal={goals.gamesPerDay}
            loading={gamesTodayQuery.isPending}
            action="Play"
            href={playHref}
          />
        )}
        <PlanStep
          icon={<TrainIcon className="h-4 w-4" />}
          title={`Train ${goals.positionsPerDay} positions`}
          detail={
            dueQuery.isPending
              ? null
              : dueCount > 0
                ? `${dueCount} due in your queue`
                : "Queue's clear. Extra drills still count."
          }
          done={drillsToday}
          goal={goals.positionsPerDay}
          action="Train"
          onAction={() => navigate('/training')}
        />
        {showOpenings && (
          <PlanStep
            icon={<OpeningIcon className="h-4 w-4" />}
            title={`Review ${openingsGoal} ${openingsGoal === 1 ? 'opening' : 'openings'}`}
            detail={openingsDue > 0 ? `${openingsDue} due` : null}
            done={openingsToday}
            goal={openingsGoal}
            action="Review"
            onAction={() => navigate('/training', { state: { kindFilter: 'opening' } })}
          />
        )}
        {scenariosPending ? (
          <PlanStepSkeleton />
        ) : (
          showEndgames && (
            <PlanStep
              icon={<EndgameIcon className="h-4 w-4" />}
              title={`Play ${PLAYOUTS_PER_DAY} endgames`}
              detail={playoutsDue > 0 ? `${playoutsDue} due for review` : null}
              done={playoutsToday}
              goal={PLAYOUTS_PER_DAY}
              action="Play"
              onAction={() => navigate('/endgames')}
            />
          )
        )}
      </ul>

      {pathOn && path.next && path.remaining != null && !path.isPending && (
        <button
          type="button"
          onClick={() => navigate('/path')}
          className="flex items-baseline justify-between gap-3 text-left text-sm transition-opacity hover:opacity-90"
          data-testid="next-unlock"
        >
          <span className="text-text-primary">
            Next unlock in <span className="font-semibold tabular-nums">{path.remaining}</span> position
            {path.remaining === 1 ? '' : 's'}
          </span>
          <span className="label shrink-0">Your path</span>
        </button>
      )}

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
