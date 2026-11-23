import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { BrandLockup } from './BrandLogo';
import { ContactEmailForm, ResendConfirmButton } from './email/ContactEmailForm';
import { LichessLogo } from './icons/PlatformLogos';
import { useT } from '../i18n/useT';

/** How often the "check your inbox" state re-reads the profile while visible. */
const POLL_MS = 5000;

/**
 * Required step for Lichess sign-ins, which share no email address
 * (`needsContactEmail`). New accounts see it before the import screen;
 * existing ones on their next visit. Saving goes through
 * `updateContactEmail` (turns reminders on), which mails the confirmation
 * link at once; the step then waits on "Check your inbox" — re-reading the
 * profile on focus and every few seconds — and opens the app as soon as the
 * link is clicked. There is no skip: signing out is the only other way off.
 */
export function OnboardingEmail() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const lichessName = profile?.lichessUsername ?? user?.name ?? null;
  const pendingEmail = profile?.contactEmail && !profile.contactEmailVerifiedAt ? profile.contactEmail : null;
  const waiting = !!pendingEmail && !editing;

  useEffect(() => {
    if (!waiting) return;
    const check = () => {
      if (document.visibilityState === 'visible') void refreshProfile();
    };
    const id = window.setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [waiting, refreshProfile]);

  return (
    <div className="flex flex-col items-center min-h-[60vh] max-w-xl mx-auto" data-testid="onboarding-email">
      <BrandLockup size="lg" className="mb-4" />
      <div className="w-full flex flex-col gap-4 bg-surface rounded-none p-6 border-2 border-text-primary shadow-card">
        {lichessName && (
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <LichessLogo className="h-4 w-4 shrink-0" />
            <span>
              {t.rich('onboarding.email.signedInAs', { name: <span className="font-semibold">{lichessName}</span> })}
            </span>
          </p>
        )}
        {waiting ? (
          <div className="flex flex-col gap-3" data-testid="onboarding-email-check">
            <h1 className="heading-md">{t('onboarding.email.checkTitle')}</h1>
            <p className="text-text-primary">
              {t.rich('onboarding.email.check', { email: <span className="font-semibold">{pendingEmail}</span> })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={() => void refreshProfile()} data-testid="email-clicked">
                {t('onboarding.email.clicked')}
              </button>
              <button type="button" className="btn-ghost underline" onClick={() => setEditing(true)}>
                {t('onboarding.email.change')}
              </button>
            </div>
            <ResendConfirmButton />
          </div>
        ) : (
          <>
            <h1 className="heading-md">{t('onboarding.email.title')}</h1>
            <p className="text-text-primary">{t('onboarding.email.body')}</p>
            <ContactEmailForm submitLabel={t('onboarding.email.continue')} onSaved={() => setEditing(false)} />
            <p className="text-sm text-text-primary">{t('onboarding.email.footer')}</p>
          </>
        )}
      </div>
      <p className="mt-4 text-sm text-text-primary">
        {t.rich('onboarding.email.notYou', {
          signOut: (
            <button type="button" className="underline" onClick={() => void signOut()}>
              {t('profile.signOut')}
            </button>
          ),
        })}
      </p>
    </div>
  );
}
