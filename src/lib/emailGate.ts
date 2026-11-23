import type { AuthUser } from '../auth/AuthProvider';
import type { UserProfile } from '../models/userProfile';

/**
 * Lichess sign-ins share no email address (better-auth stores a placeholder),
 * so the daily plan had nowhere to go. They type one in before reaching the
 * app: new accounts as the first onboarding step, existing ones on their next
 * visit. Since feedback round 2 the address must also be confirmed before any
 * use: saving it mails the link at once (profile.update → the notifier's
 * sendConfirm), and the gate stays up until the link is clicked.
 */
export function needsContactEmail(
  user: Pick<AuthUser, 'provider'> | null,
  profile: Pick<UserProfile, 'contactEmail' | 'contactEmailVerifiedAt'> | null,
): boolean {
  return !!user && user.provider === 'lichess' && !!profile && (!profile.contactEmail || !profile.contactEmailVerifiedAt);
}
