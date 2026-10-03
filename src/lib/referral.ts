/**
 * Invite links: `https://patternchess.com/?ref=CODE`. Any page captures the
 * code into localStorage at boot (the OAuth round-trip drops the query
 * string), and AuthProvider claims it once after sign-in (claim_referral
 * RPC, which only credits brand-new accounts).
 */
import { SITE_URL } from '../seo/siteMeta';

const STORAGE_KEY = 'pc:ref';
const CODE_RE = /^[a-z0-9]{4,16}$/i;

export function inviteUrl(code: string | null | undefined, path = '/'): string {
  const url = new URL(path, SITE_URL);
  if (code) url.searchParams.set('ref', code);
  return url.toString();
}

/** Store `?ref=` from the current URL, if present and well-formed. */
export function captureReferralFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code && CODE_RE.test(code)) localStorage.setItem(STORAGE_KEY, code.toLowerCase());
  } catch {
    // storage blocked — the referral just isn't credited
  }
}

/** The stored code, removed so it's only ever claimed once. */
export function takeStoredReferral(): string | null {
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    if (code) localStorage.removeItem(STORAGE_KEY);
    return code;
  } catch {
    return null;
  }
}
