import type { AuthUser } from '../auth/AuthProvider';
import type { UserProfile } from '../models/userProfile';

/**
 * Lichess sign-ins share no email address (better-auth stores a placeholder),
 * so the daily plan had nowhere to go. Since 2026-11-22 they type one in
 * before reaching the app: new accounts as the first onboarding step,
 * existing ones once, on their next visit. A typed-in address counts as soon
 * as it is saved; the notifier Worker mails the confirmation link.
 */
export function needsContactEmail(
  user: Pick<AuthUser, 'provider'> | null,
  profile: Pick<UserProfile, 'contactEmail'> | null,
): boolean {
  return !!user && user.provider === 'lichess' && !!profile && !profile.contactEmail;
}
