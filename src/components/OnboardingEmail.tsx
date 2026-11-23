import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useOnboardingStore } from '../state/onboardingStore';
import { BrandLockup } from './BrandLogo';
import { ContactEmailForm, ContactEmailPending } from './email/ContactEmailForm';
import { LichessLogo } from './icons/PlatformLogos';
import { useT } from '../i18n/useT';

/**
 * Required step for Lichess sign-ins, which share no email address
 * (`needsContactEmail`). New accounts see it before the import screen;
 * existing ones once, on their next visit. Saving goes through
 * `updateContactEmail` (turns reminders on); the notifier Worker mails the
 * confirmation link within the hour. There is no skip: signing out is the
 * only other way off this screen.
 */
export function OnboardingEmail() {
  const { user, profile, signOut } = useAuth();
  const t = useT();
  const savedEmail = useOnboardingStore((s) => s.savedEmail);
  const setSavedEmail = useOnboardingStore((s) => s.setSavedEmail);
  const [editing, setEditing] = useState(false);
  const lichessName = profile?.lichessUsername ?? user?.name ?? null;

  const showForm = !savedEmail || editing;

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
        <h1 className="heading-md">{t('onboarding.email.title')}</h1>
        {showForm ? (
          <>
            <p className="text-text-primary">
              {t('onboarding.email.body')}
            </p>
            <ContactEmailForm
              submitLabel={t('onboarding.email.continue')}
              onSaved={(email) => {
                setSavedEmail(email);
                setEditing(false);
              }}
            />
            <p className="text-sm text-text-primary">
              {t('onboarding.email.footer')}
            </p>
          </>
        ) : (
          <>
            <ContactEmailPending email={savedEmail} onChange={() => setEditing(true)} />
            <div>
              <button type="button" className="btn-primary" onClick={() => setSavedEmail(null)}>
                {t('onboarding.email.continue')}
              </button>
            </div>
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
