import { useState, type FormEvent } from 'react';
import { authClient } from '../lib/authClient';

/**
 * Dev only (rendered under `import.meta.env.DEV`): email + password sign-in
 * against the local API's test mode (`AUTH_TEST_MODE=1` in .dev.vars), so the
 * app can be tried on localhost, where Google sign-in has no redirect URI.
 * "Create account" signs up a fresh player to try onboarding.
 */
export function DevSignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: 'in' | 'up', e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === 'in'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split('@')[0] });
    if (res.error) {
      setError(res.error.message ?? 'Sign-in failed');
      setBusy(false);
      return;
    }
    // AuthProvider picks the new session up from the cookie.
    window.location.assign('/dashboard');
  };

  return (
    <form
      onSubmit={(e) => void submit('in', e)}
      className="flex flex-col gap-2 rounded-md border border-dashed border-text-primary p-3 text-left"
      data-testid="dev-sign-in"
    >
      <p className="text-xs text-text-primary">Local test sign-in (dev builds only)</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        aria-label="Email"
        autoComplete="username"
        className="rounded border border-text-primary bg-bg px-2 py-1.5 text-sm"
      />
      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Password"
        autoComplete="current-password"
        className="rounded border border-text-primary bg-bg px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" className="btn-outline flex-1" disabled={busy}>
          Sign in
        </button>
        <button type="button" className="btn-outline flex-1" disabled={busy} onClick={() => void submit('up')}>
          Create account
        </button>
      </div>
      {error && (
        <p role="alert" className="text-incorrect text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
