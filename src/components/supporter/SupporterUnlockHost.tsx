import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupporterUnlockStore, type DailyLimitInfo } from '../../state/supporterUnlockStore';
import { useSupporterCheckout } from '../../hooks/useSupporterCheckout';
import { useCountdown } from '../../hooks/useCountdown';
import { formatCountdown } from '../../lib/dailyLimit';
import { DEFAULT_SUPPORTER_PLAN, type SupporterPlan } from '../../lib/supporterPricing';
import { SupporterPlanChoice } from './SupporterPlanChoice';
import { HeartIcon } from '../icons/HeartIcon';
import { LockIcon } from '../icons/LockIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { useT } from '../../i18n/useT';
import type { MessageKey, TKey } from '../../i18n/i18n';

const LIMIT_TITLE: Record<DailyLimitInfo['kind'], MessageKey> = {
  positions: 'limit.title.positions',
  openings: 'limit.title.openings',
  endgames: 'limit.title.endgames',
};
const LIMIT_BODY: Record<DailyLimitInfo['kind'], TKey> = {
  positions: 'limit.body.positions',
  openings: 'limit.body.openings',
  endgames: 'limit.body.endgames',
};

/** The daily-limit header: what's done for today and the live countdown to the reset. */
function DailyLimitHeader({ limit }: { limit: DailyLimitInfo }) {
  const t = useT();
  const left = useCountdown(limit.resetsAt);
  return (
    <>
      <h2 className="heading-md flex items-center gap-2 pr-8">
        <LockIcon className="h-5 w-5" />
        {t(LIMIT_TITLE[limit.kind])}
      </h2>
      <p className="text-text-primary" data-testid="daily-limit-body">
        {t(LIMIT_BODY[limit.kind], { count: limit.limit })}
      </p>
      <div className="border-2 border-text-primary/20 bg-surface-3 px-3 py-2 flex flex-col items-center">
        <span className="label">{t('limit.unlocksInLabel')}</span>
        <span className="font-mono text-2xl font-semibold text-text-primary tabular-nums" data-testid="daily-limit-timer">
          {formatCountdown(left)}
        </span>
      </div>
    </>
  );
}

/**
 * The one "Unlock with Supporter" sheet: names what the player tried to use
 * (or which daily limit they reached, with the countdown to its reset), how to
 * earn it for free when that's possible, the annual/monthly choice and a
 * checkout button (Stripe returns to this page; see checkoutParams.ts).
 */
export function SupporterUnlockHost() {
  const request = useSupporterUnlockStore((s) => s.request);
  const close = useSupporterUnlockStore((s) => s.close);
  const { checkout, pending, error } = useSupporterCheckout();
  const [plan, setPlan] = useState<SupporterPlan>(DEFAULT_SUPPORTER_PLAN);
  const t = useT();

  useEffect(() => {
    if (!request) return;
    // Capture phase + stop: Escape closes only this sheet, not a picker
    // modal underneath it (FlairPickerModal listens on window too).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, close]);

  if (!request) return null;
  const limit = request.limit ?? null;
  const title = limit ? t(LIMIT_TITLE[limit.kind]) : t('supporterUnlock.title');
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={limit ? 'daily-limit' : 'supporter-unlock'}
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
        {limit ? (
          <DailyLimitHeader limit={limit} />
        ) : (
          <>
            <h2 className="heading-md flex items-center gap-2 pr-8">
              <HeartIcon className="h-5 w-5" />
              {title}
            </h2>
            <p className="text-text-primary font-semibold" data-testid="supporter-unlock-item">
              {request.item}
            </p>
            {request.earnHint && <p className="text-sm text-text-primary">{request.earnHint}</p>}
          </>
        )}
        <p className="text-sm text-text-primary">{limit ? t('limit.perks') : t('supporterUnlock.perks')}</p>
        <SupporterPlanChoice value={plan} onChange={setPlan} className="mt-1" />
        <button
          type="button"
          className="btn-primary"
          disabled={pending != null}
          onClick={() => checkout(plan)}
          data-testid="supporter-unlock-checkout"
        >
          {pending === 'checkout' ? t('supporterUnlock.opening') : limit ? t('limit.cta') : t('supporterUnlock.cta')}
        </button>
        {limit && (
          <button type="button" className="btn-outline" onClick={close} data-testid="daily-limit-dismiss">
            {t('limit.notNow')}
          </button>
        )}
        <Link to="/supporter" className="text-xs underline self-start" onClick={close}>
          {t('supporterUnlock.more')}
        </Link>
        {error && <p className="text-incorrect text-sm">{error}</p>}
      </div>
    </div>
  );
}
