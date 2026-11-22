// The progression ladder (/path): milestones on lifetime positions trained,
// the same number as "Positions solved" (BlunderStats.reviewed = sum of
// times_correct). Each rung unlocks one motivational article (titles and
// teasers in src/generated/articles.json, bodies supporter-only); courses join
// the ladder later. Supporters skip the gates.

import articlesJson from '../generated/articles.json';

export interface ArticleMeta {
  slug: string;
  title: string;
  unlockAt: number;
  teaserHtml: string;
}

export const ARTICLES: readonly ArticleMeta[] = articlesJson as ArticleMeta[];

export const PATH_RUNGS: readonly number[] = [10, 25, 50, 100, 200, 350, 500, 750, 1000];

export interface PathRung {
  at: number;
  article: ArticleMeta | null;
}

export function pathRungs(articles: readonly ArticleMeta[] = ARTICLES): PathRung[] {
  return PATH_RUNGS.map((at) => ({ at, article: articles.find((a) => a.unlockAt === at) ?? null }));
}

export interface PathProgress {
  /** Rungs reached by positions trained (supporters still see their real progress here). */
  reached: number;
  next: PathRung | null;
  /** Positions to go until `next`; null at the top. */
  remaining: number | null;
}

export function pathProgress(trained: number, rungs: readonly PathRung[] = pathRungs()): PathProgress {
  const reached = rungs.filter((r) => trained >= r.at).length;
  const next = rungs[reached] ?? null;
  return { reached, next, remaining: next ? next.at - trained : null };
}

export function articleBySlug(slug: string | undefined): ArticleMeta | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

/** Whether the rung's content opens for this player: reached, or a supporter. */
export function rungOpen(at: number, trained: number, isSupporter: boolean): boolean {
  return isSupporter || trained >= at;
}
