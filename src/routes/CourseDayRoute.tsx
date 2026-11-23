import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { BackLink } from '../components/BackLink';
import { Skeleton } from '../components/Skeleton';
import { CheckIcon } from '../components/icons/CheckIcon';
import { HeartIcon } from '../components/icons/HeartIcon';
import { LockIcon } from '../components/icons/LockIcon';
import { TrainIcon } from '../components/icons/TrainIcon';
import { LessonPlayer } from '../components/courses/LessonPlayer';
import {
  YouTubeEmbed,
  useYouTubePlayer,
  youtubeIdFromUrl,
  youtubeWatchUrl,
  type YouTubePlayer,
} from '../components/youtube/YouTubeEmbed';
import { useAuth } from '../auth/useAuth';
import { availableCourse, courseTopicLabel } from '../lib/courses';
import { isSupporterDay, type Course, type CourseSegment } from '../lib/courseCatalog';
import { courseMistakesLabel } from '../lib/courseDrill';
import { hasLesson } from '../lib/courseLessons';
import { dayStatuses, nextDay, type DayStatus } from '../lib/coursePacing';
import { MOTIF_LABEL, type Motif } from '../chess/motifs';
import { ENDGAME_TYPE_LABEL } from '../chess/endgameType';
import {
  useCompleteCourseDay,
  useCourseDayContent,
  useCourseDrill,
  useCourseLesson,
  useCourseProgress,
  useCourseToday,
  useSetCourseFocus,
} from '../hooks/useCourses';
import { useSupporter } from '../hooks/useSupporter';
import { ApiError } from '../lib/api';
import type { TrainingFocus } from './training/trainingFocus';

const SIDE = { white: 'White', black: 'Black' } as const;

/** What to say when your games have nothing on this topic yet. */
function emptyDrillText(course: Course): string {
  const { type, keys, color, endgameType } = course.topic;
  if (type === 'opening') {
    return `None of your ${keys[0]} games${color ? ` as ${SIDE[color]}` : ''} has a mistake to drill yet. Play it a few times this week and the moments you miss will land here.`;
  }
  if (type === 'motif') {
    return `None of your analyzed blunders is tagged "${MOTIF_LABEL[keys[0] as Motif] ?? keys[0]}" yet. When one turns up in your games, it lands here.`;
  }
  const what = endgameType ? ENDGAME_TYPE_LABEL[endgameType].toLowerCase() : keys[0] === 'endgame' ? 'endgame' : keys[0];
  return `No ${what} mistakes from your games yet. Longer games reach them more often, so play a few and check back.`;
}

/** "Hanging Pawns'" / "ChessNetwork's". */
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

function playUrl(lichess: string | null, chesscom: string | null): string | null {
  if (lichess) return 'https://lichess.org/';
  if (chesscom) return 'https://www.chess.com/play/online';
  return null;
}

function DayList({
  course,
  statuses,
  current,
  isSupporter,
}: {
  course: Course;
  statuses: DayStatus[];
  current: number;
  isSupporter: boolean;
}) {
  return (
    <ol className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10" data-testid="course-days">
      {course.days.map((d, i) => {
        const status = statuses[i];
        const gated = isSupporterDay(d.day) && !isSupporter;
        return (
          <li key={d.day}>
            <Link
              to={`/courses/${course.slug}/${d.day}`}
              data-testid="course-day-link"
              data-status={status}
              aria-current={d.day === current ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-3 px-2 py-2.5 text-sm transition-colors hover:bg-accent/10',
                d.day === current && 'bg-accent/15 shadow-[inset_3px_0_0_rgb(var(--accent))]',
              )}
            >
              <span
                className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center border-2 font-mono text-xs',
                  status === 'done'
                    ? 'border-correct bg-correct/15 text-correct'
                    : status === 'open'
                      ? 'border-gold-dark text-gold-dark'
                      : 'border-text-primary/25 text-text-primary',
                )}
              >
                {status === 'done' ? <CheckIcon className="h-4 w-4" /> : d.day}
              </span>
              <span className="flex-1 min-w-0 text-text-primary">{d.title}</span>
              {gated ? (
                <HeartIcon className="h-3.5 w-3.5 shrink-0" title="For supporters" />
              ) : status === 'locked' ? (
                <LockIcon className="h-3.5 w-3.5 shrink-0 text-text-primary" />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** "1 Lesson · 2 Your games": where you are in today's two steps. */
function DaySteps({ lessonDone, hasDrill }: { lessonDone: boolean; hasDrill: boolean }) {
  const steps = [
    { label: hasDrill ? 'Lesson drill' : 'Lesson', done: lessonDone },
    { label: 'Your games', done: false },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="course-day-steps">
      {steps.map((s, i) => {
        const current = (i === 0 && !lessonDone) || (i === 1 && lessonDone);
        return (
          <li key={s.label} className="flex items-center gap-2" data-current={current || undefined}>
            <span
              className={clsx(
                'flex h-5 w-5 items-center justify-center border-2 font-mono text-[11px]',
                s.done
                  ? 'border-correct bg-correct/15 text-correct'
                  : current
                    ? 'border-gold-dark text-gold-dark'
                    : 'border-text-primary/25 text-text-primary',
              )}
            >
              {s.done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={clsx('text-text-primary', current && 'font-semibold')}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A watch-only lesson: the clip (embedded with credit, never re-hosted) and a link out. */
function LessonVideo({ player, segment, title }: { player: YouTubePlayer; segment: CourseSegment; title: string }) {
  return (
    <div className="card !p-3 flex flex-col gap-2">
      <YouTubeEmbed player={player} title={title} testId="course-video" />
      <a
        href={youtubeWatchUrl(segment.youtubeId, segment.start)}
        target="_blank"
        rel="noopener noreferrer"
        className="self-end text-xs text-text-primary underline"
      >
        Watch on YouTube
      </a>
    </div>
  );
}

function Takeaway({ text }: { text: string }) {
  return (
    <section className="card flex flex-col gap-2" data-testid="course-takeaway">
      <span className="label">The takeaway</span>
      <p className="text-text-primary leading-relaxed">{text}</p>
    </section>
  );
}

/**
 * /courses/:slug/:day?: one course day, in two steps.
 *
 * 1. The lesson. With an interactive lesson (an annotated PGN of the video,
 *    `segment.lesson`), you play through the creator's positions on the board
 *    while the clip plays alongside; otherwise you watch the clip and read the
 *    takeaway. Finishing it marks the day done.
 * 2. Now your games: every mistake from your own games on the same idea
 *    (matchCourseBlunders), drilled at /training, which brings you back here.
 *
 * Lessons open in order with no waiting: the next one is ready as soon as this
 * one is done. Days past the free ones are for supporters; step 2 stays free.
 */
export function CourseDayRoute() {
  const { slug, day: dayParam } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const course = availableCourse(slug);
  const progress = useCourseProgress();
  const today = useCourseToday();
  const supporter = useSupporter();
  const complete = useCompleteCourseDay();
  const setFocus = useSetCourseFocus();
  const drill = useCourseDrill(course);
  // Replaying a finished lesson's drill.
  const [replay, setReplay] = useState(false);

  const total = course?.days.length ?? 0;
  const done = (course && progress.data?.byCourse.get(course.slug)) || [];
  const statuses = dayStatuses(total, done);
  const day = Number(dayParam);
  const validDay = Number.isInteger(day) && day >= 1 && day <= total;
  const status: DayStatus = validDay ? statuses[day - 1] : 'locked';
  const supporterDay = validDay && isSupporterDay(day);
  const gated = supporterDay && !supporter.isSupporter;
  const watchable = validDay && (status === 'open' || status === 'done') && !gated;
  const lockedContent = useCourseDayContent(course?.slug ?? '', day, !!course && watchable && supporterDay && !supporter.isPending);
  const meta = validDay ? course!.days[day - 1] : null;
  const segment: CourseSegment | null = !watchable
    ? null
    : supporterDay
      ? (lockedContent.data ?? null)
      : meta?.youtubeId
        ? { youtubeId: meta.youtubeId, start: meta.start, end: meta.end, takeaway: meta.takeaway ?? '', lesson: meta.lesson }
        : null;
  const lessonSlug = segment?.lesson && hasLesson(segment.lesson) ? segment.lesson : null;
  const lesson = useCourseLesson(lessonSlug);
  const lessonVideoId = lesson.data?.source ? youtubeIdFromUrl(lesson.data.source.url) : null;
  const player = useYouTubePlayer(segment?.youtubeId ?? null, { start: segment?.start, end: segment?.end });

  if (!course) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <BackLink to="/courses" label="Courses" />
        <p className="text-text-primary">That course isn't available.</p>
      </div>
    );
  }
  if (progress.isPending) return <Skeleton className="h-96 w-full max-w-5xl mx-auto" />;
  if (!validDay) {
    const next = nextDay(total, done);
    return <Navigate to={`/courses/${course.slug}/${next?.day ?? total}`} replace />;
  }

  const isFocus = progress.data?.focus === course.slug;
  const lessonDone = status === 'done';
  const justFinished = complete.isSuccess && complete.variables?.day === day;
  const finishedCourse = done.length >= total;
  const ids = drill.positions.map((b) => b.id);
  const play = playUrl(profile?.lichessUsername ?? null, profile?.chesscomUsername ?? null);
  const nextMeta = day < total ? course.days[day] : null;
  const dayTitle = `${course.title}, day ${day}: ${meta!.title}`;

  const markDone = () => {
    setReplay(false);
    if (lessonDone) return;
    complete.mutate(
      { slug: course.slug, day, localDate: today },
      {
        onSuccess: () => {
          // Finishing a lesson means you're following the course: its next lesson joins the daily plan.
          if (!progress.data?.focus) setFocus.mutate(course.slug);
          requestAnimationFrame(() =>
            document.querySelector('[data-testid=course-drill]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          );
        },
      },
    );
  };

  const drillMine = () => {
    const focus: TrainingFocus = {
      blunderIds: ids,
      focusLabel: `${course.title}: your games`,
      returnTo: `/courses/${course.slug}/${day}`,
    };
    navigate('/training', { state: focus });
  };

  const completeError =
    complete.error instanceof ApiError && complete.error.code === 'not_open'
      ? 'Finish the lesson before this one first.'
      : complete.error
        ? "Couldn't save that. Try again in a moment."
        : null;
  const contentError =
    lockedContent.error instanceof ApiError && lockedContent.error.code === 'not_open'
      ? 'Finish the lesson before this one first.'
      : lockedContent.error
        ? "This lesson isn't loading right now. Try again in a moment."
        : null;

  let lessonStep: React.ReactNode;
  if (status === 'locked') {
    lessonStep = (
      <section className="card text-text-primary" data-testid="course-day-locked">
        Finish day {day - 1} first. Lessons open in order, and each one is ready as soon as the last is done.
      </section>
    );
  } else if (gated) {
    lessonStep = (
      <section className="card flex flex-col gap-3 border-gold-dark" data-testid="course-supporter-gate">
        <p className="flex items-center gap-2 font-semibold">
          <HeartIcon className="h-4 w-4" />
          Day {day} onward is for supporters.
        </p>
        <p className="text-sm text-text-primary">
          $5 a month keeps PatternChess running, and supporters get every lesson in every course. Your games below stay
          free.
        </p>
        <div>
          <Link to="/supporter" className="btn-primary">
            Become a supporter
          </Link>
        </div>
      </section>
    );
  } else if (!segment || (lessonSlug && lesson.isPending)) {
    lessonStep = contentError ? (
      <p className="card text-text-primary">{contentError}</p>
    ) : (
      <Skeleton className="aspect-video w-full" />
    );
  } else if (lesson.data && (!lessonDone || replay)) {
    lessonStep = (
      <div className="flex flex-col gap-3" data-testid="course-lesson-drill">
        <LessonPlayer
          key={replay ? 'replay' : 'first'}
          study={lesson.data}
          // The lesson's [%ts] moments point into its own source video: share
          // the day's clip only when it is that video.
          video={lessonVideoId === segment.youtubeId ? player : undefined}
          videoTitle={dayTitle}
          narrow
          finishLabel={lessonDone ? 'Done' : 'Finish the lesson'}
          onFinish={markDone}
          header={
            <p className="text-sm text-text-primary">
              Play through the positions from {possessive(course.creator.name)} video. Stockfish checked every move,
              and each note links back to its moment in the video.
            </p>
          }
        />
        {completeError && <span className="text-sm text-incorrect">{completeError}</span>}
      </div>
    );
  } else {
    lessonStep = (
      <>
        <LessonVideo player={player} segment={segment} title={dayTitle} />
        {segment.takeaway && <Takeaway text={segment.takeaway} />}
        <div className="flex flex-wrap items-center gap-3">
          {lessonDone ? (
            <>
              <span className="flex items-center gap-2 text-sm text-text-primary" data-testid="course-day-done">
                <CheckIcon className="h-4 w-4 text-correct" />
                {justFinished ? 'Lesson done. Now your games.' : 'Lesson done.'}
              </span>
              {lesson.data && (
                <button type="button" className="btn-outline" onClick={() => setReplay(true)} data-testid="course-replay">
                  Replay the lesson drill
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={markDone}
              disabled={complete.isPending}
              data-testid="course-complete"
            >
              {complete.isPending ? 'Saving…' : 'Done watching'}
            </button>
          )}
          {completeError && <span className="text-sm text-incorrect">{completeError}</span>}
        </div>
      </>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6" data-testid="course-day">
      <BackLink to="/courses" label="Courses" />

      <header className="flex flex-col gap-2">
        <span className="label">{courseTopicLabel(course)}</span>
        <h1 className="heading-xl">{course.title}</h1>
        <p className="text-text-primary" data-testid="course-credit">
          Lessons by{' '}
          <a href={course.creator.channelUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            {course.creator.name}
          </a>{' '}
          on YouTube. Subscribe to their channel for the full videos.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-tight text-text-primary">
              Day {day} of {total}
            </span>
            <h2 className="heading-md" data-testid="course-day-title">
              {meta!.title}
            </h2>
            {status !== 'locked' && <DaySteps lessonDone={lessonDone} hasDrill={!!lessonSlug} />}
          </div>

          {lessonStep}

          <section
            className={clsx('card flex flex-col gap-3', lessonDone && 'border-gold-dark')}
            data-testid="course-drill"
          >
            <span className="label flex items-center gap-2">
              <TrainIcon className="h-4 w-4" /> Now your games
            </span>
            {drill.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : drill.total > 0 ? (
              <>
                <h3 className="heading-md" data-testid="course-mistakes">
                  {courseMistakesLabel(course, drill.total)}
                </h3>
                <p className="text-text-primary">
                  {drill.total > ids.length
                    ? `Here are the ${ids.length} worth drilling first. Put the lesson to work while it's fresh.`
                    : "Put the lesson to work on them while it's fresh."}
                </p>
                <div>
                  <button
                    type="button"
                    className={lessonDone ? 'btn-primary' : 'btn-outline'}
                    data-testid="course-drill-start"
                    onClick={drillMine}
                  >
                    {ids.length === 1 ? 'Drill it' : `Drill ${ids.length}`}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-text-primary" data-testid="course-drill-empty">
                  {emptyDrillText(course)}
                </p>
                {play && (
                  <div>
                    <a href={play} target="_blank" rel="noopener noreferrer" className="btn-outline">
                      Play a game
                    </a>
                  </div>
                )}
              </>
            )}
          </section>

          {lessonDone && (
            <section className="flex flex-wrap items-center justify-between gap-3" data-testid="course-next-lesson">
              {nextMeta ? (
                <>
                  <span className="text-sm text-text-primary">
                    Next: day {day + 1}, {nextMeta.title}
                  </span>
                  <Link to={`/courses/${course.slug}/${day + 1}`} className="btn-outline" onClick={() => setReplay(false)}>
                    Next lesson
                  </Link>
                </>
              ) : (
                <span className="flex items-center gap-2 text-sm text-text-primary" data-testid="course-finished">
                  <CheckIcon className="h-4 w-4 text-correct" />
                  {finishedCourse ? 'Course finished. Well played.' : 'That was the last lesson.'}
                </span>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="card flex flex-col gap-3">
            <span className="label">Lessons</span>
            <DayList course={course} statuses={statuses} current={day} isSupporter={supporter.isSupporter} />
          </section>
          <section className="card flex flex-col gap-2 text-sm text-text-primary">
            {isFocus ? (
              <>
                <p>You're following this course. Its next lesson is in today's plan on the dashboard.</p>
                <button
                  type="button"
                  className="btn-ghost self-start"
                  onClick={() => setFocus.mutate(null)}
                  disabled={setFocus.isPending}
                  data-testid="course-unfocus"
                >
                  Stop following
                </button>
              </>
            ) : (
              <>
                <p>Follow this course to put its next lesson in today's plan.</p>
                <button
                  type="button"
                  className="btn-outline self-start"
                  onClick={() => setFocus.mutate(course.slug)}
                  disabled={setFocus.isPending}
                  data-testid="course-focus-button"
                >
                  Follow this course
                </button>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
