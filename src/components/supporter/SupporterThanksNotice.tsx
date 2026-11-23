import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSupporter } from '../../hooks/useSupporter';
import { HeartIcon } from '../icons/HeartIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { useT } from '../../i18n/useT';

/**
 * Back from Stripe Checkout on any app page (`?supporter=thanks`, added by
 * checkoutParams.withThanks): thanks the player and re-reads their supporter
 * row until the webhook switches the perks on (usually seconds).
 */
export function SupporterThanksNotice() {
  const [params, setParams] = useSearchParams();
  const thanks = params.get('supporter') === 'thanks';
  const { isSupporter } = useSupporter();
  const queryClient = useQueryClient();
  const t = useT();

  useEffect(() => {
    if (!thanks || isSupporter) return;
    const id = window.setInterval(() => void queryClient.invalidateQueries({ queryKey: ['supporter'] }), 2000);
    const stop = window.setTimeout(() => window.clearInterval(id), 60_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [thanks, isSupporter, queryClient]);

  if (!thanks) return null;
  const dismiss = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('supporter');
        return next;
      },
      { replace: true },
    );
  return (
    <div
      role="status"
      data-testid="supporter-thanks"
      className="fixed bottom-4 right-4 z-40 max-w-sm card flex items-start gap-3 pr-10"
    >
      <HeartIcon className="h-5 w-5 shrink-0 mt-0.5" />
      <p className="text-sm text-text-primary">{isSupporter ? t('supporterThanks.active') : t('supporterThanks.pending')}</p>
      <button type="button" aria-label={t('common.close')} className="btn-ghost absolute top-2 right-2 p-1" onClick={dismiss}>
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
