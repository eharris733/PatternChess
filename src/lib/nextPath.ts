/**
 * Where to send a player after sign-in (`/login?next=/supporter?checkout=1`).
 * Only same-origin paths pass, so a crafted link can never bounce a fresh
 * session to another site through the OAuth callbackURL.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  const base = 'https://next.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  // Never loop back into the sign-in page itself.
  if (url.pathname === '/login') return null;
  return url.pathname + url.search + url.hash;
}

/** `/login?next=<path>` for a page that needs a signed-in player to continue. */
export function loginUrlWithNext(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/** Signed-out /supporter → sign-in → back here with checkout starting by itself. */
export const SUPPORTER_CHECKOUT_RESUME = '/supporter?checkout=1';
