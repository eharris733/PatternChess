import type { LearnStudy } from '../models/learn';

// Interactive lessons built from a creator's video: an annotated PGN in
// content/courses/ with an unlisted content/learn/catalog.json entry,
// converted by `npm run learn:sync` (never the /learn index). Each file is its
// own lazy chunk. Two folders, so a link can only open what it is for:
//   src/generated/course-lessons/ — course-day lessons (permission kind
//     `course`), opened only by a course day, which the course's own
//     permission gates (AVAILABLE_COURSES)
//   src/generated/courses/ — creator outreach demos, opened at /c/:slug

const lessonLoaders = import.meta.glob<{ default: LearnStudy }>('../generated/course-lessons/*.json');
const demoLoaders = import.meta.glob<{ default: LearnStudy }>('../generated/courses/*.json');

async function load(
  loaders: Record<string, () => Promise<{ default: LearnStudy }>>,
  key: string,
): Promise<LearnStudy | null> {
  const loader = loaders[key];
  if (!loader) return null;
  const mod = await loader();
  return (mod.default ?? mod) as LearnStudy;
}

/** A course day's lesson is built (src/generated/course-lessons/<slug>.json). */
export function hasLesson(slug: string | null | undefined): boolean {
  return !!slug && `../generated/course-lessons/${slug}.json` in lessonLoaders;
}

/** A course day's lesson. Only course days call this. */
export function loadLesson(slug: string): Promise<LearnStudy | null> {
  return load(lessonLoaders, `../generated/course-lessons/${slug}.json`);
}

/** A creator outreach demo (/c/:slug); never a course-day lesson. */
export function loadDemo(slug: string): Promise<LearnStudy | null> {
  return load(demoLoaders, `../generated/courses/${slug}.json`);
}
