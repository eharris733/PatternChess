import catalog from '../generated/learnCatalog.json';
import type { LearnCategory, LearnStudy, LearnStudyMeta } from '../models/learn';

/**
 * PatternChess-approved study library. Metadata is small and bundled; each
 * study's move tree is its own lazy chunk (src/generated/learn/<slug>.json),
 * both written by `npm run learn:sync` (scripts/build-learn.mjs) from the
 * hand-curated content/learn/catalog.json.
 */
export const LEARN_STUDIES: readonly LearnStudyMeta[] = (
  catalog as unknown as { studies: LearnStudyMeta[] }
).studies;

export function studiesInCategory(category: LearnCategory): LearnStudyMeta[] {
  return LEARN_STUDIES.filter((s) => s.category === category);
}

export function studyBySlug(slug: string): LearnStudyMeta | null {
  return LEARN_STUDIES.find((s) => s.slug === slug) ?? null;
}

/** Opening studies that teach `family`, one-sided repertoires for the other colour excluded. */
export function studiesForOpening(
  family: string,
  color: 'white' | 'black',
): LearnStudyMeta[] {
  return LEARN_STUDIES.filter(
    (s) =>
      s.category === 'openings' &&
      s.openingFamilies.includes(family) &&
      (s.color == null || s.color === color),
  );
}

const loaders = import.meta.glob<{ default: LearnStudy }>('../generated/learn/*.json');

export async function loadStudy(slug: string): Promise<LearnStudy | null> {
  const load = loaders[`../generated/learn/${slug}.json`];
  if (!load) return null;
  const mod = await load();
  return (mod.default ?? mod) as LearnStudy;
}
