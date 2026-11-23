import { Link, useNavigate } from 'react-router-dom';
import { supabaseService } from '../../services/supabaseService';
import { useCourseRecommendations, useSetCourseFocus } from '../../hooks/useCourses';
import { CloseIcon } from '../icons/CloseIcon';
import { CourseIcon } from '../icons/CourseIcon';
import { Skeleton } from '../Skeleton';

/** The dashboard's course ask (src/lib/asks.ts: open 3+, courses available, no course followed yet). */
export function CourseAskCard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { recommendations, isPending } = useCourseRecommendations();
  const setFocus = useSetCourseFocus();

  const record = () =>
    void supabaseService.markAskPrompted('course').catch((err) => console.warn('[ask] record failed', err));
  const dismiss = () => {
    onClose();
    record();
  };
  const start = (slug: string) => {
    record();
    setFocus.mutate(slug, {
      onSuccess: () => {
        onClose();
        navigate(`/courses/${slug}`);
      },
    });
  };

  const picked = recommendations.length > 0;

  return (
    <section className="card flex items-start gap-3 border-gold-dark" data-testid="course-ask">
      <CourseIcon className="mt-1 h-5 w-5 shrink-0 text-gold-dark" />
      <div className="flex flex-1 flex-col gap-3 min-w-0">
        <span className="label">Courses</span>
        <h2 className="heading-md">{picked || isPending ? 'We picked a course from your games' : 'Learn from a chess creator'}</h2>
        <p className="text-sm text-text-primary">
          Short video lessons from chess creators, each followed by the mistakes from your own games on the same idea.
          The next lesson joins your daily plan.
        </p>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          picked && (
            <ul className="flex flex-col divide-y-2 divide-text-primary/10 border-y-2 border-text-primary/10">
              {recommendations.map((r) => (
                <li key={r.course.slug} className="flex items-center gap-3 py-2.5" data-testid="course-ask-pick">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-text-primary">
                      {r.course.title} <span className="font-normal">with {r.course.creator.name}</span>
                    </span>
                    <span className="block text-xs text-text-primary">{r.reason}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-primary h-9 px-4 text-xs shrink-0"
                    disabled={setFocus.isPending}
                    onClick={() => start(r.course.slug)}
                  >
                    {setFocus.isPending && setFocus.variables === r.course.slug ? 'Starting…' : 'Start'}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/courses"
            className={picked ? 'btn-outline' : 'btn-primary'}
            onClick={() => {
              onClose();
              record();
            }}
          >
            {picked ? 'See all courses' : 'Browse courses'}
          </Link>
          <button type="button" className="btn-ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
        {setFocus.isError && <p className="text-incorrect text-sm">Couldn't start the course. Try again in a moment.</p>}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0 text-text-secondary">
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
