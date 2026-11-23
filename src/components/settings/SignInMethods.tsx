import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '../../lib/authClient';
import { LichessLogo } from '../icons/PlatformLogos';
import { useT } from '../../i18n/useT';

type Provider = 'google' | 'lichess';

const PROVIDERS: Provider[] = ['google', 'lichess'];

/** Errors better-auth puts on the return URL after a failed link (`?error=`). */
function linkErrorKey(code: string | null): 'accounts.alreadyLinked' | 'accounts.linkFailed' | null {
  if (!code) return null;
  return /already_linked|already linked/i.test(code) ? 'accounts.alreadyLinked' : 'accounts.linkFailed';
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

/**
 * /profile → Accounts: the ways to sign in to this one account. Connecting a
 * second provider (better-auth linkSocial; the server trusts Google and
 * Lichess, functions/_shared/auth.ts) means either button opens the same
 * account. Two existing accounts are never merged: linking a Lichess account
 * that already has its own PatternChess account fails with a clear message.
 */
export function SignInMethods() {
  const t = useT();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ['auth', 'accounts'],
    queryFn: async () => {
      const { data, error: e } = await authClient.listAccounts();
      if (e) throw new Error(e.message ?? 'listAccounts failed');
      return (data ?? []) as Array<{ id: string; providerId: string; accountId: string }>;
    },
    staleTime: 60_000,
  });

  // Back from a failed link: better-auth adds ?error=<code> to the return URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = linkErrorKey(params.get('error'));
    if (!key) return;
    setError(t(key));
    params.delete('error');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }, [t]);

  const linked = new Map((accounts.data ?? []).map((a) => [a.providerId, a]));
  const label = (p: Provider) => (p === 'google' ? 'Google' : 'Lichess');

  const connect = async (provider: Provider) => {
    setPending(provider);
    setError(null);
    const back = `${window.location.pathname}#accounts`;
    const { error: e } = await authClient.linkSocial({ provider, callbackURL: back, errorCallbackURL: back });
    if (e) {
      setError(t(linkErrorKey(e.code ?? e.message ?? 'x') ?? 'accounts.linkFailed'));
      setPending(null);
    }
  };

  const disconnect = async (provider: Provider) => {
    const account = linked.get(provider);
    if (!account) return;
    setPending(provider);
    setError(null);
    const { error: e } = await authClient.unlinkAccount({ accountId: account.id });
    setPending(null);
    if (e) setError(t('accounts.unlinkFailed'));
    void queryClient.invalidateQueries({ queryKey: ['auth', 'accounts'] });
  };

  return (
    <div className="flex flex-col gap-2" id="accounts" data-testid="sign-in-methods">
      <h3 className="heading-md">{t('accounts.title')}</h3>
      <p className="text-sm text-text-primary">{t('accounts.help')}</p>
      <ul className="flex flex-col gap-2">
        {PROVIDERS.map((p) => {
          const on = linked.has(p);
          const onlyOne = on && linked.size <= 1;
          return (
            <li key={p} className="flex items-center gap-3 border-2 border-text-primary/15 px-3 py-2" data-testid={`sign-in-${p}`}>
              {p === 'google' ? <GoogleMark className="h-5 w-5 shrink-0" /> : <LichessLogo className="h-5 w-5 shrink-0" />}
              <span className="flex-1 text-sm font-semibold text-text-primary">{label(p)}</span>
              {accounts.isPending ? null : on ? (
                <>
                  <span className="text-xs text-correct">{t('accounts.connected')}</span>
                  {!onlyOne && (
                    <button
                      type="button"
                      className="btn-ghost h-8 px-2 text-xs underline"
                      disabled={pending != null}
                      onClick={() => void disconnect(p)}
                    >
                      {t('accounts.disconnect')}
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="btn-outline h-8 px-3 text-xs"
                  disabled={pending != null}
                  onClick={() => void connect(p)}
                  data-testid={`connect-${p}`}
                >
                  {pending === p ? t('accounts.connecting') : t('accounts.connect')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-incorrect text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
