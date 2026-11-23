import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { supabaseService } from '../../services/supabaseService';
import { detectTimezone } from '../../services/streakService';

// Same shape the profiles.contact_email check constraint accepts.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Lichess sign-ins share no email address, so they type one in. Saving turns
 * reminders on; the notifier Worker mails a confirmation link within the hour
 * and sends nothing else until it is clicked. Used by the dashboard email ask
 * and the Email section of /profile.
 */
export function ContactEmailForm({
  submitLabel = 'Send confirmation link',
  onSaved,
  children,
}: {
  submitLabel?: string;
  onSaved?: (email: string) => void;
  /** Extra buttons beside submit (the dashboard ask's "Not now"). */
  children?: React.ReactNode;
}) {
  const { profile, refreshProfile } = useAuth();
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL_RE.test(address.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await supabaseService.updateContactEmail(address, profile?.timezone ? null : detectTimezone());
      await refreshProfile();
      onSaved?.(address.trim());
    } catch (err) {
      console.warn('[email] save failed', err);
      setError("Couldn't save that address. Check it and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)} data-testid="contact-email-form">
      <label className="flex flex-col gap-1.5">
        <span className="label">Email address</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      {error && <p className="text-incorrect text-sm">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!valid || saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

/** "Check your inbox" for a typed-in address that hasn't been confirmed yet. */
export function ContactEmailPending({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <p className="text-sm text-text-primary" data-testid="contact-email-pending">
      We'll send a confirmation link to <span className="font-semibold">{email}</span> within the hour.
      Reminders start once you click it. Nothing there? Check your spam folder, or{' '}
      <button type="button" className="underline" onClick={onChange}>
        use a different address
      </button>
      .
    </p>
  );
}
