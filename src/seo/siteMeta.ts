// Central SEO constants for PatternChess. Single source of truth for the
// canonical origin, brand name, and default social-share metadata so every
// per-route <head> (see useHead) and the build-time generators
// (scripts/gen-seo.mjs) stay in sync.

export const SITE_URL = 'https://patternchess.com';
export const SITE_NAME = 'PatternChess';

export const SITE_DESCRIPTION =
  'PatternChess turns the blunders from your own chess games into spaced-repetition drills, using the Woodpecker Method so you stop making the same mistakes twice.';

export const DEFAULT_OG_IMAGE = `${SITE_URL}/social-card-og.png`;
export const SITE_LOGO = `${SITE_URL}/app-icon-512.png`;

/** Resolve a path or already-absolute URL to an absolute https URL on SITE_URL. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${SITE_URL}${path}`;
}
