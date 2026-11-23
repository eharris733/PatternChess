import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { supabaseService } from '../../services/supabaseService';
import { detectTimezone } from '../../services/streakService';
import { useT } from '../../i18n/useT';
import { ApiError } from '../../lib/api';

// Same shape the profiles.contact_email check constraint accepts.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Lichess sign-ins share no email address, so they type one in. Saving turns
 * reminders on and mails the confirmation link at once (profile.update → the
 * notifier's sendConfirm); nothing else is sent until it is clicked. Used by
 * the Lichess email gate, the dashboard email ask and the Email section of
 * /profile. An address that already belongs to another account is refused
 * (409 email_in_use) with a pointer to that account.
 */
export function ContactEmailForm({
  submitLabel,
  onSaved,
  children,
}: {
  submitLabel?: string;
  onSaved?: (email: string) => void;
  /** Extra buttons beside submit (the dashboard ask's "Not now"). */
  children?: React.ReactNode;
}) {
  const { profile, refreshProfile } = useAuth();
  const t = useT();
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
      setError(err instanceof ApiError && err.code === 'email_in_use' ? t('email.inUse') : t('email.addressError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)} data-testid="contact-email-form">
      <label className="flex flex-col gap-1.5">
        <span className="label">{t('email.addressLabel')}</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder={t('email.placeholder')}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      {error && <p className="text-incorrect text-sm">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!valid || saving}>
          {saving ? t('common.saving') : (submitLabel ?? t('email.sendConfirm'))}
        </button>
        {children}
      </div>
    </form>
  );
}

/** "Check your inbox" for a typed-in address that hasn't been confirmed yet, with a resend. */
export function ContactEmailPending({ email, onChange }: { email: string; onChange: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2" data-testid="contact-email-pending">
      <p className="text-sm text-text-primary">
        {t.rich('email.pending', {
          email: <span className="font-semibold">{email}</span>,
          change: (
            <button type="button" className="underline" onClick={onChange}>
              {t('email.pendingChange')}
            </button>
          ),
        })}
      </p>
      <ResendConfirmButton />
    </div>
  );
}

/** "Send it again" (profile.resendConfirm: at most once a minute, five a day). */
export function ResendConfirmButton({ className = 'btn-outline self-start h-9 px-3 text-xs' }: { className?: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'wait' | 'error'>('idle');
  const resend = async () => {
    setState('sending');
    try {
      await supabaseService.resendContactConfirm();
      setState('sent');
    } catch (err) {
      setState(err instanceof ApiError && err.status === 429 ? 'wait' : 'error');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={className} disabled={state === 'sending'} onClick={() => void resend()} data-testid="resend-confirm">
        {state === 'sending' ? t('email.resending') : t('email.resend')}
      </button>
      {state === 'sent' && <span className="text-xs text-text-primary">{t('email.resent')}</span>}
      {state === 'wait' && <span className="text-xs text-text-primary">{t('email.resendWait')}</span>}
      {state === 'error' && <span className="text-xs text-incorrect">{t('email.resendError')}</span>}
    </div>
  );
}
