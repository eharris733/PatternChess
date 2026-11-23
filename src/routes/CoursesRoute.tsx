import { Link, useNavigate } from 'react-router-dom';
import { CourseCard } from '../components/courses/CourseCard';
import { Skeleton } from '../components/Skeleton';
import { AVAILABLE_COURSES, COURSE_TYPE_HEADING, availableCourse } from '../lib/courses';
import { FREE_COURSE_DAYS, type Course } from '../lib/courseCatalog';
import { nextDay } from '../lib/coursePacing';
import { useCourseProgress, useCourseRecommendations, useSetCourseFocus } from '../hooks/useCourses';
import { useSupporter } from '../hooks/useSupporter';

const TYPES: Course['topic']['type'][] = ['opening', 'motif', 'phase'];

/**
 * /courses: short video lessons from chess creators, each followed by the
 * mistakes from your own games on the same idea. "Recommended for you" ranks
 * the catalog by your games (src/lib/courseRecommend.ts).
 */
export function CoursesRoute() {
  const navigate = useNavigate();
  const progress = useCourseProgress();
  const { recommendations, isPending: recPending } = useCourseRecommendations();
  const setFocus = useSetCourseFocus();
  const supporter = useSupporter();

  const focus = availableCourse(progress.data?.focus);
  const done = (slug: string) => progress.data?.byCourse.get(slug) ?? [];

  const start = (slug: string) =>
    setFocus.mutate(slug, { onSuccess: () => navigate(`/courses/${slug}`) });

  if (AVAILABLE_COURSES.length === 0) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <h1 className="heading-xl">Courses</h1>
        <p className="text-text-primary">Courses are on their way. Check back soon.</p>
      </div>
    );
  }

  const focusNext = focus ? nextDay(focus.days.length, done(focus.slug)) : null;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-8" data-testid="courses-page">
      <header className="flex flex-col gap-2 max-w-3xl">
        <span className="label">Courses</span>
        <h1 className="heading-xl">Short lessons, matched to your games</h1>
        <p className="text-text-primary">
          Each course turns a chess creator's YouTube videos into short lessons. Watch or play through the lesson, then
          drill the mistakes from your own games on the same idea, so it lands where you actually lose points. The next
          lesson is ready as soon as you finish one.
        </p>
        {!supporter.isPending && !supporter.isSupporter && (
          <p className="text-sm text-text-primary">
            The first {FREE_COURSE_DAYS} lessons of every course are free. Supporters get the rest.{' '}
            <Link to="/supporter" className="underline">
              Become a supporter
            </Link>
          </p>
        )}
      </header>

      {focus && (
        <section className="card flex flex-col gap-3 border-gold-dark" data-testid="course-focus">
          <span className="label">Your course</span>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="heading-md">{focus.title}</h2>
            <span className="font-mono text-xs tabular-nums text-text-primary">
              {Math.min(done(focus.slug).length, focus.days.length)}/{focus.days.length} lessons
            </span>
          </div>
          <p className="text-sm text-text-primary">
            {focusNext == null
              ? 'You finished this course. Pick your next one below.'
              : `Next: day ${focusNext.day}, ${focus.days[focusNext.day - 1].title}.`}
          </p>
          <div>
            <Link to={`/courses/${focus.slug}`} className="btn-primary">
              {focusNext ? 'Continue' : 'Open course'}
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3" data-testid="course-recommendations">
        <h2 className="heading-md">Recommended for you</h2>
        {recPending || progress.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : recommendations.length === 0 ? (
          <p className="text-text-primary">
            Once a few of your games are analyzed, we'll match courses to the openings you play and the mistakes that
            cost you. Until then, any course below is a good start.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {recommendations.map((r) => (
              <CourseCard
                key={r.course.slug}
                course={r.course}
                doneDays={done(r.course.slug).length}
                isFocus={focus?.slug === r.course.slug}
                reason={r.reason}
                onStart={() => start(r.course.slug)}
                starting={setFocus.isPending && setFocus.variables === r.course.slug}
              />
            ))}
          </div>
        )}
      </section>

      {TYPES.map((type) => {
        const courses = AVAILABLE_COURSES.filter((c) => c.topic.type === type);
        if (courses.length === 0) return null;
        return (
          <section key={type} className="flex flex-col gap-3">
            <h2 className="heading-md">{COURSE_TYPE_HEADING[type]}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {courses.map((c) => (
                <CourseCard
                  key={c.slug}
                  course={c}
                  doneDays={done(c.slug).length}
                  isFocus={focus?.slug === c.slug}
                  onStart={() => start(c.slug)}
                  starting={setFocus.isPending && setFocus.variables === c.slug}
                />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-text-primary">
        Every lesson plays on the creator's own YouTube channel, embedded with credit. Follow them on YouTube for the
        full videos.
      </p>
    </div>
  );
}
