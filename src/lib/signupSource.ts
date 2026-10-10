/**
 * First-touch sign-up attribution. Links from events.patternchess.com carry
 * `utm_source=events&utm_medium=<placement>&utm_campaign=otb`; any page
 * stores the first tagged visit in localStorage at boot (the OAuth round-trip
 * drops the query string, same as `?ref=`), and AuthProvider claims it once
 * after sign-in (claim_signup_source RPC — only brand-new accounts, only once).
 */
const STORAGE_KEY = 'pc:signup-source';
const PART_RE = /^[a-z0-9_-]{1,40}$/i;

/** Store `source/medium/campaign` from the URL's utm params — first touch wins. */
export function captureSignupSourceFromUrl(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const source = params.get('utm_source');
    if (!source || !PART_RE.test(source)) return;
    const parts = [source, params.get('utm_medium'), params.get('utm_campaign')].map((p) =>
      p && PART_RE.test(p) ? p.toLowerCase() : '',
    );
    localStorage.setItem(STORAGE_KEY, parts.join('/'));
  } catch {
    // storage blocked — the sign-up just isn't attributed
  }
}

/** The stored source, removed so it's only ever claimed once. */
export function takeStoredSignupSource(): string | null {
  try {
    const source = localStorage.getItem(STORAGE_KEY);
    if (source) localStorage.removeItem(STORAGE_KEY);
    return source;
  } catch {
    return null;
  }
}
