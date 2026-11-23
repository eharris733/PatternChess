import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useAchievements } from '../../hooks/useAchievements';
import { useDueCount } from '../../hooks/useDueCount';
import { useEndgameScenarios } from '../../hooks/useEndgameScenarios';
import { useDrillsOfKind } from '../../hooks/useDrillsOfKind';
import { useUpcomingBlunders } from '../../hooks/useUpcomingBlunders';
import { isScenarioDue } from '../../models/endgameScenario';
import {
  COMMITMENT_LABEL,
  DEFAULT_DAILY_GOALS,
  OPENINGS_PER_DAY,
  PLAYOUTS_PER_DAY,
} from '../../lib/dailyGoal';
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
import { PlatformLogo, type PlatformId } from '../icons/PlatformLogos';
import { LockIcon } from '../icons/LockIcon';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { Skeleton } from '../Skeleton';
import { usePathProgress } from '../../hooks/usePathProgress';
import { useFeature } from '../../hooks/useFeature';
import type { TrainingFocus } from '../../routes/training/trainingFocus';

function PlanStep({
  icon,
  title,
  detail,
  done,
  goal,
  action,
  actionShort,
  onAction,
  href,
  loading,
  idle,
  locked,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  done: number;
  goal: number;
  action: string;
  /** Shorter label for phone widths (e.g. "Practice" for "Practice ahead"). */
  actionShort?: string;
  onAction?: () => void;
  /** External link (opens a new tab) instead of `onAction`. */
  href?: string;
  loading?: boolean;
  /** Nothing to do here yet (no material): no count, never blocks the plan. */
  idle?: boolean;
  /** Visible but closed until the rest of the plan is done. */
  locked?: boolean;
  testId?: string;
}) {
  const complete = !idle && done >= goal;
  const label = actionShort ? (
    <>
      <span className="sm:hidden">{actionShort}</span>
      <span className="hidden sm:inline">{action}</span>
    </>
  ) : (
    action
  );
  return (
    <li
      className={clsx('flex items-center gap-3 py-3', locked && !complete && 'opacity-60')}
      data-plan-step
      data-testid={testId}
      data-state={locked && !complete ? 'locked' : complete ? 'done' : idle ? 'idle' : 'open'}
    >
      <span
        className={clsx(
          'flex h-6 w-6 shrink-0 items-center justify-center border-2',
          complete
            ? 'border-correct bg-correct/15 text-correct'
            : idle
              ? 'border-text-primary/15 bg-surface text-transparent'
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
          <span className="block text-xs text-text-primary">
            {detail}
          </span>
        )}
      </span>
      {loading ? (
        <Skeleton className="h-4 w-10" />
      ) : idle ? null : (
        <span className="font-mono text-sm tabular-nums text-text-primary shrink-0">
          {Math.min(done, goal)}/{goal}
        </span>
      )}
      {locked && !complete ? (
        <button
          type="button"
          disabled
          className="btn-outline h-9 px-3 text-xs shrink-0 gap-1.5"
          aria-label={`${action} (locked)`}
        >
          <LockIcon className="h-3.5 w-3.5" />
          {action}
        </button>
      ) : href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx(complete || idle ? 'btn-outline' : 'btn-primary', 'h-9 px-4 text-xs shrink-0 whitespace-nowrap')}
        >
          {label}
        </a>
      ) : (
        <button
          type="button"
          className={clsx(complete || idle ? 'btn-outline' : 'btn-primary', 'h-9 px-4 text-xs shrink-0 whitespace-nowrap')}
          onClick={onAction}
          aria-label={actionShort ? action : undefined}
        >
          {label}
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
function playTarget(
  lichess: string | null,
  chesscom: string | null,
): { platform: PlatformId; href: string } | null {
  if (lichess) return { platform: 'lichess', href: 'https://lichess.org/' };
  if (chesscom) return { platform: 'chesscom', href: 'https://www.chess.com/play/online' };
  return null;
}

/**
 * Today's plan: a checklist sized by the player's commitment level, in order
 * Train → Openings → Endgames → Play. Every step always shows (a skeleton
 * while its data loads); with nothing due, Train and Openings offer "Practice
 * ahead" and Endgames a replay, so the plan never dead-ends. Play stays
 * locked until the rest is done. A step with no material at all (no games
 * analyzed yet) is idle and never blocks Play. (The streak lives in the
 * sidebar badge and on the profile.)
 */
export function DailyHabitCard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();
  // Count only: the full due list (solution lines, drill data) was downloaded
  // here just to show its length.
  const dueQuery = useDueCount({ excludeKind: 'opening' });
  const dueCount = dueQuery.data ?? 0;
  // Same params as /training's main "Practice ahead", so the cache is shared.
  const upcomingQuery = useUpcomingBlunders(
    { excludeKind: 'opening' },
    { enabled: dueQuery.isSuccess && dueCount === 0 },
  );
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
  const play = playTarget(profile?.lichessUsername ?? null, profile?.chesscomUsername ?? null);
  const playHref = play?.href ?? null;
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
        <Skeleton className="h-10 w-full" />
      </section>
    );
  }

  const train = (focus?: TrainingFocus) => navigate('/training', focus ? { state: focus } : undefined);

  // --- Train ---------------------------------------------------------------
  const drillsToday = drillsQuery.data ?? 0;
  const upcomingCount = upcomingQuery.data?.length ?? 0;
  const trainPending = dueQuery.isPending || (dueCount === 0 && upcomingQuery.isPending);
  // Openings have their own step; the train step's "due" excludes them.
  // Nothing due and nothing coming up: no positions at all yet, so the step
  // can't be finished today and must not hold Play back.
  const trainIdle = !trainPending && dueCount === 0 && upcomingCount === 0;
  const trainDone = drillsToday >= goals.positionsPerDay;
  const practiceNext = dueCount === 0 && upcomingCount > 0;

  // --- Openings ------------------------------------------------------------
  // Opening drills done today vs the daily ask (capped by the drills you
  // have). Practice ahead keeps the step doable when nothing is due.
  const openingsPending = openingDrillsQuery.isPending;
  const openingDrills = [...(openingDrillsQuery.data?.values() ?? [])].filter((b) => b.kind === 'opening');
  const openingsToday = openingDrills.filter(
    (b) => b.lastDrilledAt && localDate(tz, b.lastDrilledAt) === today,
  ).length;
  const now = Date.now();
  // Same rule as the due queue: next_drill_at <= now (retired rows are
  // already excluded by useDrillsOfKind).
  const openingsDue = openingDrills.filter((b) => b.nextDrillAt && b.nextDrillAt.getTime() <= now).length;
  const openingsGoal = Math.min(OPENINGS_PER_DAY, openingDrills.length);
  const openingsIdle = !openingsPending && openingDrills.length === 0;
  const openingsDone = openingsToday >= openingsGoal;

  // --- Endgames ------------------------------------------------------------
  const scenariosPending = scenariosQuery.isPending;
  const scenarios = scenariosQuery.data ?? [];
  const playoutsToday = scenarios.filter((s) => s.lastPlayedAt && localDate(tz, s.lastPlayedAt) === today).length;
  const playoutsDue = scenarios.filter((s) => isScenarioDue(s)).length;
  const endgamesGoal = Math.min(PLAYOUTS_PER_DAY, scenarios.length);
  const endgamesIdle = !scenariosPending && scenarios.length === 0;
  const endgamesDone = playoutsToday >= endgamesGoal;

  // --- Play (last; opens once the rest is done) ----------------------------
  const gamesToday = gamesTodayQuery.data ?? 0;
  const restPending = trainPending || openingsPending || scenariosPending;
  const restDone =
    !restPending && (trainDone || trainIdle) && (openingsDone || openingsIdle) && (endgamesDone || endgamesIdle);
  const playLocked = !restDone;

  const steps = [
    ...(trainIdle && !trainDone ? [] : [trainDone]),
    ...(openingsIdle ? [] : [openingsDone]),
    ...(endgamesIdle ? [] : [endgamesDone]),
    ...(showPlay ? [gamesToday >= goals.gamesPerDay] : []),
  ];
  const stepsDone = steps.filter(Boolean).length;
  const allDone = !restPending && stepsDone === steps.length;
  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-3" data-testid="daily-plan">
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
        {restPending ? (
          <Skeleton className="h-3 w-20" />
        ) : (
          <span
            className={clsx(
              'font-mono text-xs uppercase tracking-tight inline-flex items-center gap-1.5',
              allDone ? 'text-correct' : 'text-text-secondary',
            )}
            data-testid="plan-progress"
          >
            {allDone && <CheckIcon className="h-3.5 w-3.5" title="Plan complete" />}
            {allDone ? 'Plan done' : `${stepsDone}/${steps.length} done`}
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
        <PlanStep
          testId="plan-step-train"
          icon={<TrainIcon className="h-4 w-4" />}
          title={`Train ${goals.positionsPerDay} positions`}
          detail={
            trainPending
              ? null
              : dueCount > 0
                ? `${dueCount} due in your queue`
                : upcomingCount > 0
                  ? "Queue's clear. Practice ahead, it still counts."
                  : drillsToday > 0
                    ? "Every position drilled. Play a game and we'll find fresh material."
                    : "Nothing to train yet. Play a game and we'll find fresh material."
          }
          done={drillsToday}
          goal={goals.positionsPerDay}
          idle={trainIdle && drillsToday === 0}
          action={practiceNext ? 'Practice ahead' : 'Train'}
          actionShort={practiceNext ? 'Practice' : undefined}
          onAction={() => train(practiceNext ? { practiceAhead: true } : undefined)}
        />
        {openingsPending ? (
          <PlanStepSkeleton />
        ) : openingsIdle ? (
          <PlanStep
            testId="plan-step-openings"
            icon={<OpeningIcon className="h-4 w-4" />}
            title="Review openings"
            detail="Your opening exits show up here once your games are checked."
            done={0}
            goal={0}
            idle
            action="Openings"
            onAction={() => navigate('/openings')}
          />
        ) : (
          <PlanStep
            testId="plan-step-openings"
            icon={<OpeningIcon className="h-4 w-4" />}
            title={`Review ${openingsGoal} ${openingsGoal === 1 ? 'opening' : 'openings'}`}
            detail={openingsDue > 0 ? `${openingsDue} due` : 'Nothing due. Practice ahead, it still counts.'}
            done={openingsToday}
            goal={openingsGoal}
            action={openingsDue > 0 ? 'Review' : 'Practice'}
            onAction={() =>
              train({
                kindFilter: 'opening',
                returnTo: '/openings',
                ...(openingsDue > 0 ? {} : { practiceAhead: true }),
              })
            }
          />
        )}
        {scenariosPending ? (
          <PlanStepSkeleton />
        ) : endgamesIdle ? (
          <PlanStep
            testId="plan-step-endgames"
            icon={<EndgameIcon className="h-4 w-4" />}
            title="Play endgames"
            detail="Endgames you let slip in your games show up here."
            done={0}
            goal={0}
            idle
            action="Endgames"
            onAction={() => navigate('/endgames')}
          />
        ) : (
          <PlanStep
            testId="plan-step-endgames"
            icon={<EndgameIcon className="h-4 w-4" />}
            title={`Play ${endgamesGoal} ${endgamesGoal === 1 ? 'endgame' : 'endgames'}`}
            detail={playoutsDue > 0 ? `${playoutsDue} due for review` : 'Nothing due. Replay a saved endgame.'}
            done={playoutsToday}
            goal={endgamesGoal}
            action="Play"
            onAction={() => navigate('/endgames')}
          />
        )}
        {showPlay && playHref && profile && (
          <PlanStep
            testId="plan-step-play"
            icon={play ? <PlatformLogo platform={play.platform} className="h-4 w-4" /> : <KingIcon color="white" className="h-4 w-4" />}
            title={`Play ${goals.gamesPerDay} ${goals.gamesPerDay === 1 ? 'game' : 'games'}`}
            detail={
              playLocked ? (
                'Unlocks when your plan is done.'
              ) : (
                <>
                  {syncing ? 'Checking for new games…' : 'New blunders from your games land in your queue.'}{' '}
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
              )
            }
            done={gamesToday}
            goal={goals.gamesPerDay}
            loading={gamesTodayQuery.isPending}
            locked={playLocked}
            action="Play"
            href={playHref}
          />
        )}
      </ul>

      {allDone && (
        <div className="flex items-center justify-between gap-3" data-testid="plan-done">
          <span className="text-sm text-text-primary">Plan done. Keep going?</span>
          <button
            type="button"
            className="btn-outline h-9 px-4 text-xs shrink-0"
            onClick={() => train(practiceNext ? { practiceAhead: true } : undefined)}
          >
            {practiceNext ? 'Practice ahead' : 'Keep going'}
          </button>
        </div>
      )}

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
