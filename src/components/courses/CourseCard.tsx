import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { Course } from '../../lib/courseCatalog';
import { courseTopicLabel } from '../../lib/courses';
import { CheckIcon } from '../icons/CheckIcon';

/**
 * One course in a list: title, creator, topic, progress. `reason` (from
 * courseRecommend) says why it was picked; `onStart` follows the course.
 */
export function CourseCard({
  course,
  doneDays,
  isFocus,
  reason,
  onStart,
  starting,
}: {
  course: Course;
  doneDays: number;
  isFocus: boolean;
  reason?: string;
  onStart?: () => void;
  starting?: boolean;
}) {
  const total = course.days.length;
  const finished = doneDays >= total;
  return (
    <article
      className={clsx('card flex flex-col gap-3', isFocus && 'border-gold-dark')}
      data-testid="course-card"
      data-slug={course.slug}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="border border-text-primary/30 px-2 py-0.5 font-mono text-[11px] uppercase tracking-tight text-text-primary">
          {courseTopicLabel(course)}
        </span>
        {isFocus && <span className="label text-gold-dark">Your course</span>}
        {course.permission.status !== 'granted' && (
          <span className="font-mono text-[11px] uppercase tracking-tight text-text-primary" title="Hidden in production until the creator agrees">
            Awaiting creator OK
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Link to={`/courses/${course.slug}`} className="heading-md text-text-primary underline-offset-4 hover:underline">
          {course.title}
        </Link>
        <span className="text-sm text-text-primary">with {course.creator.name}</span>
      </div>
      {reason && <p className="text-sm font-semibold text-text-primary">{reason}</p>}
      <p className="text-sm text-text-primary">{course.summary}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-text-primary">
          {finished && <CheckIcon className="h-3.5 w-3.5 text-correct" />}
          {doneDays > 0 ? `${Math.min(doneDays, total)}/${total} lessons` : `${total} lessons`}
        </span>
        {onStart && !isFocus && !finished ? (
          <button type="button" className="btn-primary h-9 px-4 text-xs" onClick={onStart} disabled={starting} data-testid="course-start">
            {starting ? 'Starting…' : doneDays > 0 ? 'Follow' : 'Start'}
          </button>
        ) : (
          <Link to={`/courses/${course.slug}`} className="btn-outline h-9 px-4 text-xs" data-testid="course-open">
            {finished ? 'Rewatch' : isFocus || doneDays > 0 ? 'Continue' : 'Open'}
          </Link>
        )}
      </div>
    </article>
  );
}
