import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAchievements } from '../../hooks/useAchievements';
import { useDailyPlan } from '../../hooks/useDailyPlan';
import { COMMITMENT_LABEL } from '../../lib/dailyGoal';
import { useSyncStore } from '../../state/syncStore';
import { streakNoticeText, useStreakNoticeStore } from '../../state/streakNoticeStore';
import { nearestAchievement } from '../../lib/achievements';
import { CheckIcon } from '../icons/CheckIcon';
import { TrophyIcon } from '../icons/TrophyIcon';
import { EndgameIcon } from '../icons/EndgameIcon';
import { TrainIcon } from '../icons/TrainIcon';
import { OpeningIcon } from '../icons/OpeningIcon';
import { KingIcon } from '../icons/KingIcon';
import { PlatformLogo } from '../icons/PlatformLogos';
import { LockIcon } from '../icons/LockIcon';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { Skeleton } from '../Skeleton';
import { usePathProgress } from '../../hooks/usePathProgress';
import { useFeature } from '../../hooks/useFeature';
import type { TrainingFocus } from '../../routes/training/trainingFocus';
import { CourseIcon } from '../icons/CourseIcon';
import { useAuth } from '../../auth/useAuth';
import { useLabel, useT } from '../../i18n/useT';

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
  const t = useT();
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
        <span className="flex shrink-0 flex-col items-end leading-tight" data-testid={testId ? `${testId}-count` : undefined}>
          <span className="font-mono text-sm tabular-nums text-text-primary">
            {Math.min(done, goal)}/{goal}
          </span>
          <span className="text-[10px] text-text-primary">{t('plan.today')}</span>
        </span>
      )}
      {locked && !complete ? (
        <button
          type="button"
          disabled
          className="btn-outline h-9 px-3 text-xs shrink-0 gap-1.5"
          aria-label={t('plan.lockedSuffix', { action })}
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

/**
 * Today's plan: a checklist sized by the player's commitment level, in order
 * (Lesson →) Train → Openings → Endgames → Play. "Today's lesson" shows only
 * while you follow a course (/courses): it walks the lesson, its drill and
 * your own mistakes on the same idea, and is done once a lesson is finished
 * today (the next one is open right away). Every other step always shows (a skeleton
 * while its data loads); with nothing due, Train and Openings offer "Practice
 * ahead" and Endgames a replay, so the plan never dead-ends. Play stays
 * locked until the rest is done. A step with no material at all (no games
 * analyzed yet) is idle and never blocks Play. (The streak lives in the
 * sidebar badge and on the profile.)
 */
export function DailyHabitCard() {
  const t = useT();
  const label = useLabel();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const plan = useDailyPlan();
  const { achievements } = useAchievements();
  const syncing = useSyncStore((s) =>
    Object.values(s.providers).some((p) => p.phase === 'fetching' || p.phase === 'inserting' || p.phase === 'analyzing'),
  );
  const triggerSync = useSyncStore((s) => s.triggerNow);
  const notice = useStreakNoticeStore((s) => s.notice);
  const clearNotice = useStreakNoticeStore((s) => s.clear);
  const path = usePathProgress();
  const pathOn = useFeature('path');
  const {
    goals,
    play,
    playHref,
    showPlay,
    drillsToday,
    dueCount,
    upcomingCount,
    trainPending,
    trainIdle,
    practiceNext,
    openingsPending,
    openingsToday,
    openingsDue,
    openingsGoal,
    openingsIdle,
    scenariosPending,
    playoutsToday,
    playoutsDue,
    endgamesGoal,
    endgamesIdle,
    lessonPending,
    lessonCourse,
    lessonDoneToday,
    lessonNext,
    lessonNextOpen,
    showLesson,
    lessonTarget,
    gamesToday,
    gamesTodayPending,
    playLocked,
    restPending,
    stepsDone,
    stepsTotal,
    allDone,
  } = plan;

  if (plan.drillsPending) {
    return (
      <section className="card flex flex-col gap-4" aria-busy="true">
        <header className="flex items-baseline justify-between">
          <span className="label">{t('plan.title')}</span>
          <Skeleton className="h-3 w-20" />
        </header>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
    );
  }

  const train = (focus?: TrainingFocus) => navigate('/training', focus ? { state: focus } : undefined);

  const lessonDetail = !lessonCourse
    ? null
    : lessonDoneToday
      ? t('plan.lesson.done', { course: lessonCourse.title })
      : lessonNext
        ? t('plan.lesson.next', {
            course: lessonCourse.title,
            day: lessonNext.day,
            lesson: lessonCourse.days[lessonNext.day - 1].title,
          })
        : null;

  const next = nearestAchievement(achievements);

  return (
    <section className="card flex flex-col gap-3" data-testid="daily-plan">
      <header className="flex items-baseline justify-between">
        <span className="label">
          {t('plan.title')}
          <button
            type="button"
            onClick={() => navigate('/profile#commitment')}
            className="ml-2 font-normal text-text-primary underline underline-offset-2 decoration-text-primary/30 hover:decoration-text-primary"
            data-testid="commitment-level"
          >
            {label('commitment', goals.level, COMMITMENT_LABEL[goals.level])}
          </button>
        </span>
        {restPending ? (
          <Skeleton className="h-3 w-20" />
        ) : (
          <span
            className={clsx(
              'font-mono text-xs uppercase tracking-tight inline-flex items-center gap-1.5',
              allDone ? 'text-correct' : 'text-text-primary',
            )}
            data-testid="plan-progress"
          >
            {allDone && <CheckIcon className="h-3.5 w-3.5" />}
            {allDone ? t('plan.done') : t('plan.progress', { done: stepsDone, total: stepsTotal })}
          </span>
        )}
      </header>

      {notice && (
        <div className="flex items-start gap-2 border-2 border-accent/40 bg-accent/10 px-3 py-2 text-sm" role="status">
          <SnowflakeIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span className="flex-1 text-text-primary">{streakNoticeText(notice, t)}</span>
          <button type="button" onClick={clearNotice} aria-label={t('common.dismiss')} className="shrink-0 text-text-primary">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10">
        {lessonPending ? (
          <PlanStepSkeleton />
        ) : (
          showLesson &&
          lessonCourse &&
          lessonTarget && (
            <PlanStep
              testId="plan-step-lesson"
              icon={<CourseIcon className="h-5 w-5" />}
              title={t('plan.lesson.title')}
              detail={lessonDetail}
              done={lessonDoneToday ? 1 : 0}
              goal={1}
              action={lessonDoneToday ? (lessonNextOpen ? t('plan.lesson.nextLesson') : t('common.review')) : t('plan.lesson.start')}
              actionShort={lessonDoneToday && lessonNextOpen ? t('common.next') : undefined}
              onAction={() => navigate(lessonTarget)}
            />
          )
        )}
        <PlanStep
          testId="plan-step-train"
          icon={<TrainIcon className="h-5 w-5" />}
          title={t('plan.train.title', { count: goals.positionsPerDay })}
          // The title + counter are what's required today; this line is the queue.
          detail={trainPending ? null : dueCount > 0 ? t('plan.inQueue', { count: dueCount }) : upcomingCount > 0 ? t('plan.queueClear') : t('plan.noneYet')}
          done={drillsToday}
          goal={goals.positionsPerDay}
          idle={trainIdle && drillsToday === 0}
          action={practiceNext ? t('plan.practiceAhead') : t('common.train')}
          actionShort={practiceNext ? t('plan.practice') : undefined}
          onAction={() => train(practiceNext ? { practiceAhead: true } : undefined)}
        />
        {openingsPending ? (
          <PlanStepSkeleton />
        ) : openingsIdle ? (
          <PlanStep
            testId="plan-step-openings"
            icon={<OpeningIcon className="h-5 w-5" />}
            title={t('plan.openings.idleTitle')}
            detail={t('plan.noneYet')}
            done={0}
            goal={0}
            idle
            action={t('nav.openings')}
            onAction={() => navigate('/openings')}
          />
        ) : (
          <PlanStep
            testId="plan-step-openings"
            icon={<OpeningIcon className="h-5 w-5" />}
            title={t('plan.openings.title', { count: openingsGoal })}
            detail={openingsDue > 0 ? t('plan.inQueue', { count: openingsDue }) : t('plan.queueClear')}
            done={openingsToday}
            goal={openingsGoal}
            action={openingsDue > 0 ? t('common.review') : t('plan.practice')}
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
            icon={<EndgameIcon className="h-5 w-5" />}
            title={t('plan.endgames.idleTitle')}
            detail={t('plan.noneYet')}
            done={0}
            goal={0}
            idle
            action={t('nav.endgames')}
            onAction={() => navigate('/endgames')}
          />
        ) : (
          <PlanStep
            testId="plan-step-endgames"
            icon={<EndgameIcon className="h-5 w-5" />}
            title={t('plan.endgames.title', { count: endgamesGoal })}
            detail={playoutsDue > 0 ? t('plan.inQueue', { count: playoutsDue }) : t('plan.queueClear')}
            done={playoutsToday}
            goal={endgamesGoal}
            action={t('common.play')}
            onAction={() => navigate('/endgames')}
          />
        )}
        {showPlay && playHref && profile && (
          <PlanStep
            testId="plan-step-play"
            icon={play ? <PlatformLogo platform={play.platform} className="h-5 w-5" /> : <KingIcon color="white" className="h-5 w-5" />}
            title={t('plan.play.title', { count: goals.gamesPerDay })}
            detail={
              playLocked ? (
                t('plan.play.locked')
              ) : (
                <>
                  {syncing && t('plan.play.checking')}
                  {!syncing && (
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-gold-dark"
                      onClick={() => void triggerSync(profile)}
                      data-testid="check-new-games"
                    >
                      {t('plan.play.check')}
                    </button>
                  )}
                </>
              )
            }
            done={gamesToday}
            goal={goals.gamesPerDay}
            loading={gamesTodayPending}
            locked={playLocked}
            action={t('common.play')}
            href={playHref}
          />
        )}
      </ul>

      {allDone && (
        <div className="flex items-center justify-between gap-3" data-testid="plan-done">
          <span className="text-sm text-text-primary">{t('plan.allDone')}</span>
          <button
            type="button"
            className="btn-outline h-9 px-4 text-xs shrink-0"
            onClick={() => train(practiceNext ? { practiceAhead: true } : undefined)}
          >
            {practiceNext ? t('plan.practiceAhead') : t('plan.keepGoing')}
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
            {t.rich('plan.nextUnlock', {
              count: <span className="font-semibold tabular-nums">{path.remaining}</span>,
            }, path.remaining)}
          </span>
          <span className="label shrink-0">{t('plan.yourPath')}</span>
        </button>
      )}

      {next && (
        <button
          type="button"
          onClick={() => navigate('/achievements')}
          className="flex flex-col gap-1.5 pt-1 text-left transition-opacity hover:opacity-90"
        >
          <div className="flex items-baseline justify-between">
            <span className="label">{t('plan.nextAchievement')}</span>
            <span className="font-mono text-text-primary text-xs tabular-nums">
              {Math.min(next.value, next.threshold).toLocaleString()}/{next.threshold.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TrophyIcon className="h-4 w-4 shrink-0 text-gold-dark" />
            <span className="text-sm text-text-primary" title={next.description}>
              {next.title}
            </span>
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
