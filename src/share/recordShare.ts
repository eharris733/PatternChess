import { authService } from '../services/authService';

/**
 * Bump `profiles.shares_count` (share achievements) after any share, image
 * download or copied link. Fire-and-forget; skipped when signed out (the
 * public Moments tool).
 */
export function recordShare(signedIn: boolean, refreshProfile?: () => Promise<unknown> | void): void {
  if (!signedIn) return;
  void authService
    .incrementSharesCount()
    .then(() => refreshProfile?.())
    .catch((err) => console.warn('[share] increment_shares_count failed', err));
}
