import type { LearnStudy } from '../models/learn';

// Interactive lessons built from a creator's video: an annotated PGN in
// content/courses/ with an unlisted content/learn/catalog.json entry,
// converted by `npm run learn:sync` into src/generated/courses/<slug>.json
// (never the /learn index). Each file is its own lazy chunk. Used by the
// unlisted demos (/c/:slug) and by course days whose segment names a `lesson`.

const loaders = import.meta.glob<{ default: LearnStudy }>('../generated/courses/*.json');

export function hasLesson(slug: string | null | undefined): boolean {
  return !!slug && `../generated/courses/${slug}.json` in loaders;
}

export async function loadLesson(slug: string): Promise<LearnStudy | null> {
  const load = loaders[`../generated/courses/${slug}.json`];
  if (!load) return null;
  const mod = await load();
  return (mod.default ?? mod) as LearnStudy;
}
