import { useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useOnboardingStore } from '../state/onboardingStore';
import { BrandLockup } from './BrandLogo';
import { ContactEmailForm, ContactEmailPending } from './email/ContactEmailForm';
import { LichessLogo } from './icons/PlatformLogos';

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
              Signed in with Lichess as <span className="font-semibold">{lichessName}</span>
            </span>
          </p>
        )}
        <h1 className="heading-md">Where should we send your daily plan?</h1>
        {showForm ? (
          <>
            <p className="text-text-primary">
              Lichess keeps your email private, so we need one from you. We'll send your plan on days
              you have positions due and a progress report each Sunday. Your games keep importing in
              the meantime.
            </p>
            <ContactEmailForm
              submitLabel="Continue"
              onSaved={(email) => {
                setSavedEmail(email);
                setEditing(false);
              }}
            />
            <p className="text-sm text-text-primary">
              Turn reminders off any time in your profile, or with one click from any email. We never
              share your address.
            </p>
          </>
        ) : (
          <>
            <ContactEmailPending email={savedEmail} onChange={() => setEditing(true)} />
            <div>
              <button type="button" className="btn-primary" onClick={() => setSavedEmail(null)}>
                Continue
              </button>
            </div>
          </>
        )}
      </div>
      <p className="mt-4 text-sm text-text-primary">
        Not you?{' '}
        <button type="button" className="underline" onClick={() => void signOut()}>
          Sign out
        </button>
      </p>
    </div>
  );
}
