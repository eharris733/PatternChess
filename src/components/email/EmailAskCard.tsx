import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { LANDING_STATS_SNAPSHOT, useLandingStats } from '../../hooks/useLandingStats';
import type { EmailAskVariant } from '../../lib/asks';
import { supabaseService } from '../../services/supabaseService';
import { CloseIcon } from '../icons/CloseIcon';
import { ContactEmailForm, ContactEmailPending } from './ContactEmailForm';

// Outside research about app reminders in general (vendor data about push
// notifications), never PatternChess data. Swap for our own opted-in vs not
// return rate (admin_email_stats.returnRate) once there is enough of it.
const AIRSHIP_URL = 'https://www.airship.com/newsroom/urban-airships-mobile-app-retention-study-for-key-industry-verticals/';
const KAHUNA_URL =
  'https://web.archive.org/web/20250515042828/https://martech.org/mobile-app-push-notifications-drive-90-day-retention-rates-by-as-much-as-180/';

/**
 * The dashboard's email ask (src/lib/asks.ts, open 2+). `turn-on` is for
 * accounts with an address and reminders off; `add-address` is for Lichess
 * sign-ins. Answering either way records the ask; `onClose` hides the card.
 */
export function EmailAskCard({ variant, onClose }: { variant: EmailAskVariant; onClose: () => void }) {
  const { refreshProfile } = useAuth();
  const { data: stats } = useLandingStats();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'on' | 'confirm' | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const dismiss = () => {
    onClose();
    void supabaseService.markAskPrompted('email').catch((err) => console.warn('[ask] dismiss failed', err));
  };

  const turnOn = async () => {
    setSaving(true);
    setError(null);
    try {
      await supabaseService.updateEmailOptIn(true);
      await refreshProfile();
      setDone('on');
    } catch (err) {
      console.warn('[ask] opt-in failed', err);
      setError("Couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <section className="card flex items-start gap-3 border-gold-dark" data-testid="email-ask-done" role="status">
        <div className="flex flex-1 flex-col gap-2">
          <span className="label">Daily reminders</span>
          {done === 'confirm' && pendingEmail ? (
            <ContactEmailPending email={pendingEmail} onChange={() => setDone(null)} />
          ) : (
            <p className="text-sm text-text-primary">
              Done. You'll get a nudge on days you have positions due. Change the hour in your profile.
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-text-primary">
          <CloseIcon className="h-4 w-4" />
        </button>
      </section>
    );
  }

  const elo = (stats ?? LANDING_STATS_SNAPSHOT).eloGained;

  return (
    <section className="card flex items-start gap-3 border-gold-dark" data-testid="email-ask">
      <div className="flex flex-1 flex-col gap-3">
        <span className="label">Daily reminders</span>
        <h2 className="heading-md">Want a nudge when it's time to train?</h2>
        <p className="text-sm text-text-primary">
          One short email on days you have positions due, at the hour you pick, plus a progress report
          each Sunday. Reminders seem to help people stick with things: in studies by app-messaging
          companies Airship and Kahuna, people who received reminders kept using apps at roughly 2 to
          3 times the rate of people who didn't.
          <sup>
            <a href="#email-ask-sources" className="text-gold-dark">
              1
            </a>
          </sup>{' '}
          {elo > 0 && (
            <>
              PatternChess players have gained +{elo.toLocaleString()} Elo between them so far. Showing up
              is how you add to it.
            </>
          )}
        </p>

        {variant === 'add-address' ? (
          <ContactEmailForm
            submitLabel="Yes, remind me"
            onSaved={(email) => {
              setPendingEmail(email);
              setDone('confirm');
            }}
          >
            <button type="button" className="btn-ghost" onClick={dismiss}>
              Not now
            </button>
          </ContactEmailForm>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void turnOn()}>
              {saving ? 'Saving…' : 'Yes, remind me'}
            </button>
            <button type="button" className="btn-ghost" disabled={saving} onClick={dismiss}>
              Not now
            </button>
          </div>
        )}
        {error && <p className="text-incorrect text-sm">{error}</p>}

        <p className="text-xs text-text-primary">
          Change the hour or turn it off any time in your profile, or with one click from any email.
        </p>
        <p id="email-ask-sources" className="text-xs text-text-primary">
          [1]{' '}
          <a href={AIRSHIP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            Airship mobile app retention study
          </a>
          {' · '}
          <a href={KAHUNA_URL} target="_blank" rel="noopener noreferrer" className="underline">
            Kahuna retention report (MarTech)
          </a>
        </p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="shrink-0 text-text-primary">
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
