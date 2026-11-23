import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSupporterUnlockStore } from '../../state/supporterUnlockStore';
import { useSupporterCheckout } from '../../hooks/useSupporterCheckout';
import { HeartIcon } from '../icons/HeartIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { useT } from '../../i18n/useT';

/**
 * The one "Unlock with Supporter" sheet: names what the player tried to use,
 * how to earn it for free when that's possible, one line of perks, and a
 * checkout button (Stripe returns to this page; see checkoutParams.ts).
 */
export function SupporterUnlockHost() {
  const request = useSupporterUnlockStore((s) => s.request);
  const close = useSupporterUnlockStore((s) => s.close);
  const { checkout, pending, error } = useSupporterCheckout();
  const t = useT();

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, close]);

  if (!request) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('supporterUnlock.title')}
      data-testid="supporter-unlock"
      onClick={close}
    >
      <div className="card relative w-full max-w-sm flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={t('common.close')}
          className="btn-ghost absolute top-3 right-3 p-1 text-text-primary"
          onClick={close}
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <h2 className="heading-md flex items-center gap-2 pr-8">
          <HeartIcon className="h-5 w-5" />
          {t('supporterUnlock.title')}
        </h2>
        <p className="text-text-primary font-semibold" data-testid="supporter-unlock-item">
          {request.item}
        </p>
        {request.earnHint && <p className="text-sm text-text-primary">{request.earnHint}</p>}
        <p className="text-sm text-text-primary">{t('supporterUnlock.perks')}</p>
        <button
          type="button"
          className="btn-primary"
          disabled={pending != null}
          onClick={checkout}
          data-testid="supporter-unlock-checkout"
        >
          {pending === 'checkout' ? t('supporterUnlock.opening') : t('supporterUnlock.cta')}
        </button>
        <Link to="/supporter" className="text-xs underline self-start" onClick={close}>
          {t('supporterUnlock.more')}
        </Link>
        {error && <p className="text-incorrect text-sm">{error}</p>}
      </div>
    </div>
  );
}
