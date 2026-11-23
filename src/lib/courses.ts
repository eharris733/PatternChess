import { ALL_COURSES, visibleCourses, type Course } from './courseCatalog';
import { MOTIF_LABEL, type Motif } from '../chess/motifs';
import { ENDGAME_TYPE_LABEL } from '../chess/endgameType';

/**
 * Courses waiting on creator permission show in dev and on the Pages preview
 * environment (build var VITE_SHOW_PENDING_COURSES=1), never in production:
 * there only `granted` courses ship. The courses RPCs apply the same rule.
 */
export const SHOW_PENDING_COURSES: boolean =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_PENDING_COURSES === '1';

/** The courses this build offers (the sidebar entry and the dashboard ask need at least one). */
export const AVAILABLE_COURSES: readonly Course[] = visibleCourses(ALL_COURSES, SHOW_PENDING_COURSES);

export function availableCourse(slug: string | null | undefined): Course | null {
  return AVAILABLE_COURSES.find((c) => c.slug === slug) ?? null;
}

const SIDE = { white: 'White', black: 'Black' } as const;
const PHASE_NAME: Record<string, string> = { opening: 'Opening phase', middlegame: 'Middlegame', endgame: 'Endgames' };

/** Short chip text for a course topic ("Caro-Kann Defense · Black", "Rook endgames", "Allowed fork"). */
export function courseTopicLabel(course: Course): string {
  const { type, keys, color, endgameType } = course.topic;
  if (type === 'opening') return color ? `${keys[0]} · ${SIDE[color]}` : keys[0];
  if (type === 'motif') return MOTIF_LABEL[keys[0] as Motif] ?? keys[0];
  if (endgameType) return ENDGAME_TYPE_LABEL[endgameType];
  return PHASE_NAME[keys[0]] ?? keys[0];
}

/** Section headings on /courses, by topic type. */
export const COURSE_TYPE_HEADING: Record<Course['topic']['type'], string> = {
  opening: 'Openings',
  motif: 'Tactics',
  phase: 'Game phases',
};
