import { isAdminEmail } from '../auth/admin';

/**
 * Built-but-unreleased features. Off = admins only (so they can be previewed
 * in production); flip to true to ship. Gate every entry point (route, nav,
 * links, chimes, achievements) through `featureVisible` / `useFeature`.
 */
export const RELEASED = {
  /** /path progression ladder + supporter articles. */
  path: false,
  /** /learn study library (+ "Suggested studies" on /openings, Learn achievements). */
  learn: false,
} as const;

export type Feature = keyof typeof RELEASED;

export function featureVisible(feature: Feature, email?: string | null): boolean {
  return RELEASED[feature] || isAdminEmail(email);
}
