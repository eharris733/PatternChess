import { ALL_COURSES, courseBySlug, isSupporterDay, type Course, type CourseSegment } from '../../../src/lib/courseCatalog';
import { dayOpen, isLocalDate, type DayDone } from '../../../src/lib/coursePacing';
import { all, first, run, nowIso, type AppEnv } from '../db';
import { hasSupporterPerks } from '../supporterGrants';
import { argNumber, argString, badRequest, forbidden, notFound, userRpc, type RpcRegistry, type UserRpcContext } from './core';

/**
 * Personalised YouTube courses (/courses): progress, the active course, and
 * the supporter-only lessons.
 *
 * The catalog (src/generated/courses-catalog.json) is public and bundled
 * here too, so every handler validates slugs and day numbers against it.
 * Lessons past the free days live only in KV `patternchess-content` as
 * `course-day:<slug>:<n>` (npm run courses:sync) and are served to active
 * supporters only, checked here in code. Pacing (lessons open in order, the
 * next one as soon as the previous is done; src/lib/coursePacing.ts) applies
 * to everyone, supporters included.
 */

type CoursesEnv = AppEnv & {
  /** KV `patternchess-content` (also holds the /path article bodies). */
  CONTENT?: KVNamespace;
  /** '1' on the Pages preview environment: courses still waiting on creator permission are live there. */
  VITE_SHOW_PENDING_COURSES?: string;
};

interface ProgressRow {
  course_slug: string;
  day: number;
  local_date: string;
  completed_at: string;
}

/** The course, if this environment shows it: granted everywhere, pending only where the preview flag is on. */
function visibleCourse(env: CoursesEnv, slug: string): Course {
  const course = courseBySlug(slug, ALL_COURSES);
  if (!course) throw notFound('Unknown course');
  const status = course.permission.status;
  if (status === 'granted' || (status === 'pending' && env.VITE_SHOW_PENDING_COURSES === '1')) return course;
  throw notFound('Unknown course');
}

function argDay(args: Record<string, unknown>, course: Course): number {
  const day = argNumber(args, 'day');
  if (!Number.isInteger(day) || day < 1 || day > course.days.length) throw badRequest('day out of range');
  return day;
}

/** The client's local date, within a day or two of the server's (time zones span ±14 h). */
function argLocalDate(args: Record<string, unknown>): string {
  const d = args.localDate;
  if (!isLocalDate(d)) throw badRequest('localDate must be YYYY-MM-DD');
  const skew = Math.abs(Date.parse(`${d}T12:00:00Z`) - Date.now());
  if (skew > 2 * 86_400_000) throw badRequest('localDate is too far from today');
  return d;
}

/** The app-wide perk rule: a perk-status subscription or an active grant (referral reward). */
async function isActiveSupporter(ctx: UserRpcContext): Promise<boolean> {
  return hasSupporterPerks(ctx.db, ctx.user.id);
}

async function courseDone(ctx: UserRpcContext, slug: string): Promise<DayDone[]> {
  const rows = await all<{ day: number; local_date: string }>(
    ctx.db,
    'SELECT day, local_date FROM course_progress WHERE user_id = ? AND course_slug = ?',
    [ctx.user.id, slug],
  );
  return rows.map((r) => ({ day: r.day, localDate: r.local_date }));
}

export const handlers: RpcRegistry = {
  /** Every completed lesson (all courses) plus the active course. */
  'courses.progress': userRpc(async (ctx) => {
    const [rows, focus] = await Promise.all([
      all<ProgressRow>(
        ctx.db,
        'SELECT course_slug, day, local_date, completed_at FROM course_progress WHERE user_id = ? ORDER BY course_slug, day',
        [ctx.user.id],
        'course_progress',
      ),
      first<{ course_slug: string }>(ctx.db, 'SELECT course_slug FROM course_focus WHERE user_id = ?', [ctx.user.id]),
    ]);
    return { focus: focus?.course_slug ?? null, days: rows };
  }),

  /**
   * Marks one lesson finished on the player's local date. The day must be
   * open (day 1, or the previous day finished); days past the free ones need
   * an active supporter. Completing a day twice is a no-op.
   */
  'courses.completeDay': userRpc<{ slug: string; day: number; localDate: string }>(async (ctx, args) => {
    const env = ctx.env as CoursesEnv;
    const course = visibleCourse(env, argString(args, 'slug'));
    const day = argDay(args, course);
    const localDate = argLocalDate(args);
    if (isSupporterDay(day) && !(await isActiveSupporter(ctx))) throw forbidden('This lesson is for supporters', 'supporters_only');
    const done = await courseDone(ctx, course.slug);
    if (!dayOpen(day, course.days.length, done)) throw forbidden('Finish the lesson before this one first', 'not_open');
    await run(
      ctx.db,
      `INSERT INTO course_progress (user_id, course_slug, day, local_date, completed_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, course_slug, day) DO NOTHING`,
      [ctx.user.id, course.slug, day, localDate, nowIso()],
    );
    return all<ProgressRow>(
      ctx.db,
      'SELECT course_slug, day, local_date, completed_at FROM course_progress WHERE user_id = ? AND course_slug = ? ORDER BY day',
      [ctx.user.id, course.slug],
      'course_progress',
    );
  }),

  /** Follow a course (its lesson joins the daily plan), or `slug: null` to stop. */
  'courses.setFocus': userRpc<{ slug: string | null }>(async (ctx, args) => {
    const raw = args.slug;
    if (raw != null && typeof raw !== 'string') throw badRequest('slug must be a string or null');
    const slug = raw ? visibleCourse(ctx.env as CoursesEnv, raw).slug : null;
    if (slug) {
      await run(
        ctx.db,
        `INSERT INTO course_focus (user_id, course_slug, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET course_slug = excluded.course_slug, updated_at = excluded.updated_at`,
        [ctx.user.id, slug, nowIso()],
      );
    } else {
      await run(ctx.db, 'DELETE FROM course_focus WHERE user_id = ?', [ctx.user.id]);
    }
    return { focus: slug };
  }),

  /**
   * A supporter-only lesson (day past the free ones): video segment +
   * takeaway from KV. Active supporters only, and only once the day is open.
   */
  'courses.dayContent': userRpc<{ slug: string; day: number }>(async (ctx, args) => {
    const env = ctx.env as CoursesEnv;
    const course = visibleCourse(env, argString(args, 'slug'));
    const day = argDay(args, course);
    if (!isSupporterDay(day)) throw badRequest('Free lessons are in the public catalog');
    if (!(await isActiveSupporter(ctx))) throw forbidden('This lesson is for supporters', 'supporters_only');
    if (!dayOpen(day, course.days.length, await courseDone(ctx, course.slug))) {
      throw forbidden('Finish the lesson before this one first', 'not_open');
    }
    const raw = await env.CONTENT?.get(`course-day:${course.slug}:${day}`);
    if (raw == null) throw notFound('Lesson not available');
    const seg = JSON.parse(raw) as CourseSegment;
    return {
      youtubeId: seg.youtubeId,
      start: seg.start ?? null,
      end: seg.end ?? null,
      takeaway: seg.takeaway,
      lesson: seg.lesson ?? null,
      lessonStudy: seg.lessonStudy ?? null,
    };
  }),
};
