import { createAuthClient } from 'better-auth/react';

/**
 * better-auth client for /api/auth/* (same origin as the SPA, so the session
 * is a first-party httpOnly cookie — nothing to store or refresh here).
 *
 * better-auth 1.7 serves genericOAuth providers (Lichess) through the core
 * `signIn.social` endpoint, so no genericOAuthClient plugin is needed:
 * `authClient.signIn.social({ provider: 'lichess', callbackURL })`.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  fetchOptions: { credentials: 'same-origin' },
});

/** Lichess sign-ins have no email; better-auth stores `<lichessId>@lichess.invalid`. */
export const LICHESS_PLACEHOLDER_DOMAIN = '@lichess.invalid';

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(LICHESS_PLACEHOLDER_DOMAIN);
}
