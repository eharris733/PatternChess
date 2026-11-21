import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

/**
 * The one email switch in /profile. Reminders are opt-out: new accounts start
 * on (the sign-in page says so next to "Continue with Google"). Lichess
 * sign-ins share no email address, so there is nothing to switch yet.
 */
export function EmailRemindersSetting() {
  const { user, profile, refreshProfile } = useAuth();
  const [on, setOn] = useState(profile?.emailOptIn ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOn(profile?.emailOptIn ?? false);
  }, [profile?.emailOptIn]);

  const email = user?.email ?? null;

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

  return (
    <section className="card flex flex-col gap-4" id="email" data-testid="email-reminders-setting">
      <h2 className="heading-md">Email</h2>
      {email ? (
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
      ) : (
        <p className="text-sm text-text-primary">
          You signed in with Lichess, which doesn't share an email address, so we can't send you
          reminders yet.
        </p>
      )}
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </section>
  );
}
