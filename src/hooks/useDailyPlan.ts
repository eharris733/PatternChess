import { useAuth } from '../auth/useAuth';
import { useDrillsToday } from './useTrainingActivity';
import { useDueCount } from './useDueCount';
import { useEndgameScenarios } from './useEndgameScenarios';
import { useDrillsOfKind } from './useDrillsOfKind';
import { useUpcomingBlunders } from './useUpcomingBlunders';
import { useGamesPlayedToday } from './useGamesPlayedToday';
import { useCourseProgress } from './useCourseProgress';
import { useSupporter } from './useSupporter';
import { isScenarioDue } from '../models/endgameScenario';
import { DEFAULT_DAILY_GOALS, effectiveGoals, OPENINGS_PER_DAY, PLAYOUTS_PER_DAY } from '../lib/dailyGoal';
import { availableCourse } from '../lib/courses';
import { isSupporterDay } from '../lib/courseCatalog';
import { completedOn, nextDay } from '../lib/coursePacing';
import { detectTimezone, localDate } from '../services/streakService';
import type { PlatformId } from '../components/icons/PlatformLogos';

/** The plan's steps, in the order they show (and the order "Next" walks). */
export type PlanStepId = 'lesson' | 'train' | 'openings' | 'endgames' | 'play';

export interface PlayTarget {
  platform: PlatformId;
  href: string;
}

/**
 * Where the Play step sends you: every platform you sync from (Lichess, then
 * Chess.com). A player with both linked gets both, since either one counts.
 */
export function playTargets(lichess: string | null, chesscom: string | null): PlayTarget[] {
  const targets: PlayTarget[] = [];
  if (lichess) targets.push({ platform: 'lichess', href: 'https://lichess.org/' });
  if (chesscom) targets.push({ platform: 'chesscom', href: 'https://www.chess.com/play/online' });
  return targets;
}

/**
 * Today's plan, computed once: every step's progress and whether the whole
 * plan is done. The dashboard's `DailyHabitCard` renders it and the training
 * summary reads `allDone` / `nextStep` from it, so "Today's plan: done" there
 * always agrees with the checklist.
 *
 * A step with no material at all (no positions yet, no opening drills, no
 * endgame scenarios) is idle: it never blocks Play or the plan.
 */
export function useDailyPlan() {
  const { profile } = useAuth();
  const drillsQuery = useDrillsToday();
  // Count only: the full due list (solution lines, drill data) isn't needed here.
  const dueQuery = useDueCount({ excludeKind: 'opening' });
  const dueCount = dueQuery.data ?? 0;
  // Same params as /training's main "Practice ahead", so the cache is shared.
  const upcomingQuery = useUpcomingBlunders(
    { excludeKind: 'opening' },
    { enabled: dueQuery.isSuccess && dueCount === 0 },
  );
  const scenariosQuery = useEndgameScenarios();
  const openingDrillsQuery = useDrillsOfKind('opening');
  const gamesTodayQuery = useGamesPlayedToday();
  // Never fetched in builds without courses (production until creators agree).
  const courseProgressQuery = useCourseProgress();
  const supporter = useSupporter();

  // A lapsed supporter's Obsessed/custom plan reads as its free cap (dailyGoal.ts).
  const storedGoals = profile?.dailyGoals ?? DEFAULT_DAILY_GOALS;
  const goals = supporter.isPending ? storedGoals : effectiveGoals(storedGoals, supporter.isSupporter);
  const play = playTargets(profile?.lichessUsername ?? null, profile?.chesscomUsername ?? null);
  // PGN-only players have nothing to sync, so the Play step can't detect games.
  const showPlay = goals.gamesPerDay > 0 && play.length > 0;

  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);

  // --- Train ---------------------------------------------------------------
  const drillsPending = drillsQuery.isPending;
  /** Today's count actually loaded (not pending, not failed). */
  const drillsLoaded = drillsQuery.isSuccess;
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
  const openingsLoaded = openingDrillsQuery.isSuccess;
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

  // --- Today's lesson (the followed course; first) --------------------------
  const lessonPending = courseProgressQuery.isLoading;
  const lessonCourse = availableCourse(courseProgressQuery.data?.focus);
  const lessonDays = (lessonCourse && courseProgressQuery.data?.byCourse.get(lessonCourse.slug)) || [];
  const lessonDoneToday = completedOn(lessonDays, today);
  const lessonNext = lessonCourse ? nextDay(lessonCourse.days.length, lessonDays) : null;
  // A supporter-only next lesson stays off the plan for free players (the course page explains).
  const lessonNextOpen =
    lessonNext?.status === 'open' && !(isSupporterDay(lessonNext.day) && !supporter.isSupporter);
  const showLesson = !!lessonCourse && (lessonDoneToday || lessonNextOpen);
  const lastDoneDay = lessonDays.reduce((m, d) => Math.max(m, d.day), 0);
  const lessonTarget = lessonCourse
    ? `/courses/${lessonCourse.slug}/${lessonNextOpen && lessonNext ? lessonNext.day : Math.max(1, lastDoneDay)}`
    : null;

  // --- Play (last; opens once the rest is done) ----------------------------
  const gamesToday = gamesTodayQuery.data ?? 0;
  const gamesPending = showPlay && gamesTodayQuery.isPending;
  const playDone = gamesToday >= goals.gamesPerDay;
  const restPending = trainPending || openingsPending || scenariosPending || lessonPending;
  const restDone =
    !restPending &&
    (lessonDoneToday || !showLesson) &&
    (trainDone || trainIdle) &&
    (openingsDone || openingsIdle) &&
    (endgamesDone || endgamesIdle);
  const playLocked = !restDone;

  // Counted steps, in plan order (idle ones don't count).
  const counted: { id: PlanStepId; done: boolean }[] = [
    ...(showLesson ? [{ id: 'lesson' as const, done: lessonDoneToday }] : []),
    ...(trainIdle && !trainDone ? [] : [{ id: 'train' as const, done: trainDone }]),
    ...(openingsIdle ? [] : [{ id: 'openings' as const, done: openingsDone }]),
    ...(endgamesIdle ? [] : [{ id: 'endgames' as const, done: endgamesDone }]),
    ...(showPlay ? [{ id: 'play' as const, done: playDone }] : []),
  ];
  const stepsTotal = counted.length;
  const stepsDone = counted.filter((s) => s.done).length;
  /** Anything the verdict depends on is still loading. */
  const pending = drillsPending || restPending || gamesPending;
  const allDone = !pending && stepsDone === stepsTotal;
  /** The first unfinished step in plan order (null while loading or when all are done). */
  const nextStep: PlanStepId | null = pending ? null : (counted.find((s) => !s.done)?.id ?? null);
  /** Every unfinished counted step, in plan order (a plan run skips one it just finished). */
  const unfinished: PlanStepId[] = counted.filter((s) => !s.done).map((s) => s.id);

  return {
    goals,
    today,
    tz,
    play,
    showPlay,
    // Train
    drillsPending,
    drillsLoaded,
    drillsToday,
    dueCount,
    upcomingCount,
    trainPending,
    trainIdle,
    trainDone,
    practiceNext,
    // Openings
    openingsPending,
    openingsLoaded,
    openingsToday,
    openingsDue,
    openingsGoal,
    openingsIdle,
    openingsDone,
    // Endgames
    scenariosPending,
    playoutsToday,
    playoutsDue,
    endgamesGoal,
    endgamesIdle,
    endgamesDone,
    // Lesson
    lessonPending,
    lessonCourse,
    lessonDoneToday,
    lessonNext,
    lessonNextOpen,
    showLesson,
    lessonTarget,
    // Play
    gamesToday,
    gamesTodayPending: gamesTodayQuery.isPending,
    playLocked,
    // Summary
    restPending,
    stepsDone,
    stepsTotal,
    pending,
    allDone,
    nextStep,
    unfinished,
  };
}

export type DailyPlan = ReturnType<typeof useDailyPlan>;
