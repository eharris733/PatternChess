import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { detectTimezone } from '../services/streakService';
import { ContactEmailForm, ContactEmailPending } from './email/ContactEmailForm';

function hourLabel(h: number): string {
  if (h === 0) return '12 am';
  if (h === 12) return '12 pm';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * The one email switch in /profile. Reminders are opt-out: new accounts start
 * on (the sign-in page says so next to "Continue with Google"). Lichess
 * sign-ins share no email address, so they add one here and confirm it by link.
 */
export function EmailRemindersSetting() {
  const { user, profile, refreshProfile } = useAuth();
  const [on, setOn] = useState(profile?.emailOptIn ?? false);
  const [hour, setHour] = useState(profile?.emailHour ?? 18);
  const [changingAddress, setChangingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOn(profile?.emailOptIn ?? false);
  }, [profile?.emailOptIn]);
  useEffect(() => {
    setHour(profile?.emailHour ?? 18);
  }, [profile?.emailHour]);

  const contact = profile?.contactEmail ?? null;
  const contactVerified = !!profile?.contactEmailVerifiedAt;
  const email = contact ? (contactVerified ? contact : null) : user?.email || null;
  const pending = !!contact && !contactVerified && !changingAddress;

  const toggle = (next: boolean) => {
    setOn(next);
    setError(null);
    void supabaseService
      .updateEmailOptIn(next)
      .then(() => refreshProfile())
      .catch((err) => {
        console.warn('[email] save failed', err);
        setOn(!next);
        setError('Could not save this setting. Try again in a moment.');
      });
  };

  const pickHour = (next: number) => {
    const prev = hour;
    setHour(next);
    setError(null);
    void supabaseService
      .updateEmailHour(next, profile?.timezone ? null : detectTimezone())
      .then(() => refreshProfile())
      .catch((err) => {
        console.warn('[email] save failed', err);
        setHour(prev);
        setError('Could not save this setting. Try again in a moment.');
      });
  };

  return (
    <section className="card flex flex-col gap-4" id="email" data-testid="email-reminders-setting">
      <h2 className="heading-md">Email</h2>
      {pending && contact ? (
        <ContactEmailPending email={contact} onChange={() => setChangingAddress(true)} />
      ) : email && !changingAddress ? (
        <>
          <label className="flex items-start gap-2 select-none">
            <input type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(e.target.checked)} />
            <span>
              Training reminders and progress updates
              <span className="block text-text-secondary text-xs">
                Sent to {email}: a nudge on days you have training due and a weekly progress report.
                Every email also has a one-click unsubscribe.
              </span>
            </span>
          </label>
          {on && (
            <label className="flex items-center gap-2 text-sm">
              Send reminders at
              <select
                className="input w-28"
                value={hour}
                onChange={(e) => pickHour(Number(e.target.value))}
                data-testid="email-hour"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
              <span className="text-text-secondary text-xs">your time</span>
            </label>
          )}
          {contact && (
            <button type="button" className="self-start text-sm underline" onClick={() => setChangingAddress(true)}>
              Use a different address
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-text-primary">
            {changingAddress
              ? "Enter the new address. We'll send a confirmation link to it."
              : "You signed in with Lichess, which doesn't share an email address. Add one to get a nudge on days you have training due and a weekly progress report."}
          </p>
          <ContactEmailForm onSaved={() => setChangingAddress(false)} />
        </>
      )}
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </section>
  );
}
