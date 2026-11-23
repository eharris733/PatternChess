import { rpc } from '../../lib/api';
import type { CourseSegment } from '../../lib/courseCatalog';
import type { DayDone } from '../../lib/coursePacing';

// Server side: functions/_shared/rpc/courses.ts (`courses.*`).

interface ProgressRow {
  course_slug: string;
  day: number;
  local_date: string;
  completed_at: string;
}

export interface CourseProgress {
  /** The course the player follows (its lesson joins the daily plan), or null. */
  focus: string | null;
  /** Finished lessons per course slug. */
  byCourse: Map<string, DayDone[]>;
}

function group(rows: readonly ProgressRow[]): Map<string, DayDone[]> {
  const out = new Map<string, DayDone[]>();
  for (const r of rows) {
    const list = out.get(r.course_slug) ?? [];
    list.push({ day: r.day, localDate: r.local_date });
    out.set(r.course_slug, list);
  }
  return out;
}

export async function getCourseProgress(): Promise<CourseProgress> {
  const data = await rpc<{ focus: string | null; days: ProgressRow[] }>('courses.progress');
  return { focus: data?.focus ?? null, byCourse: group(data?.days ?? []) };
}

/** Marks a lesson finished on the player's local date; returns that course's finished days. */
export async function completeCourseDay(slug: string, day: number, localDate: string): Promise<DayDone[]> {
  const rows = await rpc<ProgressRow[]>('courses.completeDay', { slug, day, localDate });
  return group(rows ?? []).get(slug) ?? [];
}

export async function setCourseFocus(slug: string | null): Promise<string | null> {
  return (await rpc<{ focus: string | null }>('courses.setFocus', { slug }))?.focus ?? null;
}

/** A supporter-only lesson (throws ApiError 403 `supporters_only` / `not_open` otherwise). */
export async function getCourseDayContent(slug: string, day: number): Promise<CourseSegment> {
  const d = await rpc<{
    youtubeId: string;
    start: number | null;
    end: number | null;
    takeaway: string;
    lesson?: string | null;
  }>('courses.dayContent', { slug, day });
  return {
    youtubeId: d.youtubeId,
    ...(d.start != null ? { start: d.start } : {}),
    ...(d.end != null ? { end: d.end } : {}),
    takeaway: d.takeaway,
    ...(d.lesson ? { lesson: d.lesson } : {}),
  };
}
