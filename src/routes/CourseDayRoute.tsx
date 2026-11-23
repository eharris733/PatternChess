import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { BackLink } from '../components/BackLink';
import { Skeleton } from '../components/Skeleton';
import { CheckIcon } from '../components/icons/CheckIcon';
import { HeartIcon } from '../components/icons/HeartIcon';
import { TrainIcon } from '../components/icons/TrainIcon';
import { YouTubeEmbed, useYouTubePlayer, youtubeWatchUrl } from '../components/youtube/YouTubeEmbed';
import { useAuth } from '../auth/useAuth';
import { availableCourse, courseTopicLabel } from '../lib/courses';
import { isSupporterDay, type Course, type CourseSegment } from '../lib/courseCatalog';
import { dayStatuses, nextDay, type DayStatus } from '../lib/coursePacing';
import { MOTIF_LABEL, type Motif } from '../chess/motifs';
import { ENDGAME_TYPE_LABEL } from '../chess/endgameType';
import {
  useCompleteCourseDay,
  useCourseDayContent,
  useCourseDrill,
  useCourseProgress,
  useCourseToday,
  useSetCourseFocus,
} from '../hooks/useCourses';
import { useSupporter } from '../hooks/useSupporter';
import { ApiError } from '../lib/api';

const SIDE = { white: 'White', black: 'Black' } as const;

/** What to say when your games have nothing on this topic yet. */
function emptyDrillText(course: Course): string {
  const { type, keys, color, endgameType } = course.topic;
  if (type === 'opening') {
    return `None of your ${keys[0]} games${color ? ` as ${SIDE[color]}` : ''} has a position to drill yet. Play a few games in it this week and the moments you miss will land here.`;
  }
  if (type === 'motif') {
    return `None of your analyzed blunders is tagged "${MOTIF_LABEL[keys[0] as Motif] ?? keys[0]}" yet. Keep playing; when one turns up, it's waiting here.`;
  }
  const what = endgameType ? ENDGAME_TYPE_LABEL[endgameType].toLowerCase() : keys[0] === 'endgame' ? 'endgames' : keys[0];
  return `No ${what} positions from your games yet. Longer games reach them more often, so play a few and check back.`;
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
                      : 'border-text-primary/25 text-text-secondary',
                )}
              >
                {status === 'done' ? <CheckIcon className="h-4 w-4" /> : d.day}
              </span>
              <span className="flex-1 min-w-0 text-text-primary">{d.title}</span>
              {gated ? (
                <HeartIcon className="h-3.5 w-3.5 shrink-0" title="For supporters" />
              ) : status === 'tomorrow' ? (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-tight text-text-secondary">Tomorrow</span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * /courses/:slug/:day?: one lesson. The creator's clip (embedded with credit,
 * never re-hosted), the takeaway, and "Today's drill" from your own games.
 * One new lesson per local date; days past the free ones are for supporters.
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

  const total = course?.days.length ?? 0;
  const done = (course && progress.data?.byCourse.get(course.slug)) || [];
  const statuses = dayStatuses(total, done, today);
  const day = Number(dayParam);
  const validDay = Number.isInteger(day) && day >= 1 && day <= total;
  const status: DayStatus = validDay ? statuses[day - 1] : 'locked';
  const supporterDay = validDay && isSupporterDay(day);
  const gated = supporterDay && !supporter.isSupporter;
  const watchable = validDay && (status === 'open' || status === 'done') && !gated;
  const lockedContent = useCourseDayContent(
    course?.slug ?? '',
    day,
    today,
    !!course && watchable && supporterDay && !supporter.isPending,
  );
  const meta = validDay ? course!.days[day - 1] : null;
  const segment: CourseSegment | null = !watchable
    ? null
    : supporterDay
      ? (lockedContent.data ?? null)
      : meta?.youtubeId
        ? { youtubeId: meta.youtubeId, start: meta.start, end: meta.end, takeaway: meta.takeaway ?? '' }
        : null;
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
    const next = nextDay(total, done, today);
    return <Navigate to={`/courses/${course.slug}/${next?.day ?? total}`} replace />;
  }

  const isFocus = progress.data?.focus === course.slug;
  const justFinished = complete.isSuccess && complete.variables?.day === day;
  const finishedCourse = done.length >= total;
  const ids = drill.positions.map((b) => b.id);
  const play = playUrl(profile?.lichessUsername ?? null, profile?.chesscomUsername ?? null);

  const markDone = () => {
    complete.mutate(
      { slug: course.slug, day, localDate: today },
      {
        onSuccess: () => {
          // Finishing a lesson means you're following the course: put it in the daily plan.
          if (!progress.data?.focus) setFocus.mutate(course.slug);
        },
      },
    );
  };

  const completeError =
    complete.error instanceof ApiError && complete.error.code === 'not_open_yet'
      ? 'This lesson opens tomorrow.'
      : complete.error
        ? "Couldn't save that. Try again in a moment."
        : null;
  const contentError =
    lockedContent.error instanceof ApiError && lockedContent.error.code === 'not_open_yet'
      ? 'This lesson opens tomorrow.'
      : lockedContent.error
        ? "This lesson isn't available right now. Try again in a moment."
        : null;

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
          <div className="flex flex-col gap-1">
            <span className="font-mono text-xs uppercase tracking-tight text-text-primary">
              Day {day} of {total}
            </span>
            <h2 className="heading-md" data-testid="course-day-title">
              {meta!.title}
            </h2>
          </div>

          {status === 'locked' ? (
            <section className="card text-text-primary" data-testid="course-day-locked">
              Finish day {day - 1} first. Lessons open one at a time.
            </section>
          ) : status === 'tomorrow' ? (
            <section className="card flex flex-col gap-2" data-testid="course-day-tomorrow">
              <p className="font-semibold text-text-primary">Day {day} opens tomorrow.</p>
              <p className="text-sm text-text-primary">
                One lesson a day gives each idea time to settle. Play a few games, drill today's positions, and come back
                tomorrow.
              </p>
            </section>
          ) : gated ? (
            <section className="card flex flex-col gap-3 border-gold-dark" data-testid="course-supporter-gate">
              <p className="flex items-center gap-2 font-semibold">
                <HeartIcon className="h-4 w-4" />
                Day {day} onward is for supporters.
              </p>
              <p className="text-sm text-text-primary">
                $5 a month keeps PatternChess running, and supporters get every lesson in every course. Today's drill
                below stays free.
              </p>
              <div>
                <Link to="/supporter" className="btn-primary">
                  Become a supporter
                </Link>
              </div>
            </section>
          ) : !segment ? (
            contentError ? (
              <p className="card text-text-primary">{contentError}</p>
            ) : (
              <Skeleton className="aspect-video w-full" />
            )
          ) : (
            <>
              <div className="card !p-3 flex flex-col gap-2">
                <YouTubeEmbed player={player} title={`${course.title}, day ${day}: ${meta!.title}`} testId="course-video" />
                <a
                  href={youtubeWatchUrl(segment.youtubeId, segment.start)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-end text-xs text-text-primary underline"
                >
                  Watch on YouTube
                </a>
              </div>
              {segment.takeaway && (
                <section className="card flex flex-col gap-2" data-testid="course-takeaway">
                  <span className="label">The takeaway</span>
                  <p className="text-text-primary leading-relaxed">{segment.takeaway}</p>
                </section>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {status === 'done' ? (
                  <span className="flex items-center gap-2 text-sm text-text-primary" data-testid="course-day-done">
                    <CheckIcon className="h-4 w-4 text-correct" />
                    {justFinished
                      ? finishedCourse
                        ? 'Course finished. Well played.'
                        : `Done for today. Day ${day + 1} opens tomorrow.`
                      : 'Lesson done.'}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={markDone}
                    disabled={complete.isPending}
                    data-testid="course-complete"
                  >
                    {complete.isPending ? 'Saving…' : 'Mark lesson done'}
                  </button>
                )}
                {completeError && <span className="text-sm text-incorrect">{completeError}</span>}
              </div>
            </>
          )}

          <section className="card flex flex-col gap-3" data-testid="course-drill">
            <span className="label flex items-center gap-2">
              <TrainIcon className="h-4 w-4" /> Today's drill
            </span>
            {drill.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : ids.length > 0 ? (
              <>
                <p className="text-text-primary">
                  {ids.length === 1 ? 'One position' : `${ids.length} positions`} from your own games on this idea. Put
                  the lesson to work while it's fresh.
                </p>
                <div>
                  <button
                    type="button"
                    className="btn-primary"
                    data-testid="course-drill-start"
                    onClick={() =>
                      navigate('/training', { state: { blunderIds: ids, focusLabel: `${course.title}, day ${day}` } })
                    }
                  >
                    Drill {ids.length === 1 ? 'it' : `these ${ids.length}`}
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
        </div>

        <aside className="flex flex-col gap-4">
          <section className="card flex flex-col gap-3">
            <span className="label">Lessons</span>
            <DayList course={course} statuses={statuses} current={day} isSupporter={supporter.isSupporter} />
          </section>
          <section className="card flex flex-col gap-2 text-sm text-text-primary">
            {isFocus ? (
              <>
                <p>This is your course. Each new lesson shows up in today's plan on the dashboard.</p>
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
                <p>Follow this course to get its next lesson in today's plan.</p>
                <button
                  type="button"
                  className="btn-outline self-start"
                  onClick={() => setFocus.mutate(course.slug)}
                  disabled={setFocus.isPending}
                  data-testid="course-focus-button"
                >
                  Make it my course
                </button>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
