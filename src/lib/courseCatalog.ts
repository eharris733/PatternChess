// The course catalog (/courses): creator YouTube videos cut into one short
// lesson a day, matched to the player's own games. Built by
// `npm run courses:sync` from content/courses/catalog.json (public) and the
// gitignored content/supporter/courses/*.json (days past the free ones, which
// live only in KV). Pure: shared by the app and the courses RPCs
// (functions/_shared/rpc/courses.ts), so no import.meta here; visibility per
// build is in src/lib/courses.ts.

import catalogJson from '../generated/courses-catalog.json';
import type { EndgameType } from '../chess/endgameType';

export type CourseTopicType = 'opening' | 'motif' | 'phase';
export type CoursePermission = 'granted' | 'pending' | 'declined';

export interface CourseTopic {
  type: CourseTopicType;
  /**
   * What the course teaches, matched against your games: opening families
   * (`games.opening_family`), motif ids (MOTIF_LABEL keys) or phases.
   * The first key is the main one.
   */
  keys: string[];
  /** The side an opening course teaches; unset = both. */
  color?: 'white' | 'black';
  /** Narrows an endgame-phase course to one material family. */
  endgameType?: EndgameType;
}

/** One lesson: a clip of the creator's video plus the line to remember. */
export interface CourseSegment {
  youtubeId: string;
  start?: number;
  end?: number;
  takeaway: string;
  /**
   * The lesson's interactive drill: the slug of an annotated PGN built by
   * `npm run learn:sync` into src/generated/course-lessons/<slug>.json (comments
   * paraphrase the video, `[%ts m:ss]` links each moment back to it). Unset =
   * watch the clip and read the takeaway.
   */
  lesson?: string;
  /**
   * Supporter days only: the built lesson itself (a LearnStudy), stored with
   * the day in KV and returned by `courses.dayContent`, so it never ships in
   * the public bundle. Typed loosely here because the server shares this file.
   */
  lessonStudy?: unknown;
}

export interface CourseDay extends Partial<CourseSegment> {
  /** 1-based. */
  day: number;
  title: string;
  /** Supporter-only: the segment comes from `courses.dayContent`. */
  locked?: boolean;
}

export interface Course {
  slug: string;
  title: string;
  summary: string;
  topic: CourseTopic;
  creator: { name: string; channelUrl: string };
  /** Only `granted` courses ship to production users. */
  permission: { status: CoursePermission; date: string | null };
  days: CourseDay[];
}

interface CatalogFile {
  freeDays: number;
  courses: Course[];
}

const catalog = catalogJson as unknown as CatalogFile;

/** Days 1..FREE_COURSE_DAYS are free; later days need an active supporter. */
export const FREE_COURSE_DAYS: number = catalog.freeDays;

export const ALL_COURSES: readonly Course[] = catalog.courses;

export function courseBySlug(slug: string | null | undefined, courses: readonly Course[] = ALL_COURSES): Course | null {
  return courses.find((c) => c.slug === slug) ?? null;
}

/** Granted courses, plus pending ones when this build shows them (dev, preview). */
export function visibleCourses(courses: readonly Course[], showPending: boolean): Course[] {
  return courses.filter((c) => c.permission.status === 'granted' || (showPending && c.permission.status === 'pending'));
}

export function isSupporterDay(day: number): boolean {
  return day > FREE_COURSE_DAYS;
}
