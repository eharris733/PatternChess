/**
 * Win-back links from the admin outreach queue (/analytics → Win-back).
 *
 * - Landing-only leads get `/?u=<handle>&p=<lichess|chesscom>&src=wb`: the
 *   landing page prefills the username and re-runs the demo, so the lead lands
 *   on their own blunders.
 * - Leads who already have an account get `/login?src=wb`; signing in routes
 *   them back into onboarding or the dashboard.
 *
 * Both fire a `lead_return` funnel event.
 */
import { SITE_URL } from '../seo/siteMeta';
import type { DemoPlatform } from '../components/landing/UsernameInput';

export const WIN_BACK_SOURCE = 'wb';
const HANDLE_RE = /^[A-Za-z0-9_-]{2,30}$/;
const SOURCE_RE = /^[a-z0-9_-]{1,24}$/;

export interface WinBackParams {
  platform: DemoPlatform;
  username: string;
  source: string;
}

export function landingWinBackUrl(platform: DemoPlatform, username: string): string {
  const url = new URL('/', SITE_URL);
  url.searchParams.set('u', username);
  url.searchParams.set('p', platform);
  url.searchParams.set('src', WIN_BACK_SOURCE);
  return url.toString();
}

export function loginWinBackUrl(): string {
  const url = new URL('/login', SITE_URL);
  url.searchParams.set('src', WIN_BACK_SOURCE);
  return url.toString();
}

/** Pure read of `?u=&p=&src=` (safe in a useState initializer). */
export function readWinBackParams(search: string): WinBackParams | null {
  const q = new URLSearchParams(search);
  const username = q.get('u')?.trim() ?? '';
  const p = q.get('p');
  if (!HANDLE_RE.test(username)) return null;
  if (p !== 'lichess' && p !== 'chesscom') return null;
  const src = q.get('src') ?? WIN_BACK_SOURCE;
  return { platform: p, username, source: SOURCE_RE.test(src) ? src : WIN_BACK_SOURCE };
}

/** `?src=` on any page, validated; null when absent. */
export function readSourceParam(search: string): string | null {
  const src = new URLSearchParams(search).get('src');
  return src && SOURCE_RE.test(src) ? src : null;
}

/** Drop the win-back params so a refresh doesn't re-run or re-count them. */
export function stripWinBackParams(): void {
  try {
    const url = new URL(window.location.href);
    for (const k of ['u', 'p', 'src']) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // non-fatal
  }
}
