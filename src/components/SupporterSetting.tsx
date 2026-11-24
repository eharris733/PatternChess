import { Link } from 'react-router-dom';
import { useSupporter } from '../hooks/useSupporter';
import { useSupporterCheckout } from '../hooks/useSupporterCheckout';
import { HeartIcon } from './icons/HeartIcon';
import { useT } from '../i18n/useT';

/**
 * /profile#supporter: subscription status and "Manage subscription", perks
 * given by hand (a comp grant) or earned by inviting friends
 * (supporter_grants), or a pointer to /supporter.
 */
export function SupporterSetting() {
  const t = useT();
  const { status, isSupporter, isPending } = useSupporter();
  const { manage, pending, error } = useSupporterCheckout();
  if (isPending) return null;

  const end = status?.currentPeriodEnd?.toLocaleDateString() ?? null;
  const subscribed = !!status?.subscribed;
  const grantEnd = status?.grantEndsAt?.toLocaleDateString() ?? null;
  const compEnd = status?.compEndsAt?.toLocaleDateString() ?? null;
  const openEndedComp = !!status?.compOpenEnded;
  return (
    <section className="card flex flex-col gap-3 scroll-mt-6" id="supporter" data-testid="supporter-setting">
      <h2 className="heading-md flex items-center gap-2">
        {isSupporter && <HeartIcon className="h-5 w-5" />}
        {t('supporter.title')}
      </h2>
      {subscribed ? (
        <p className="text-sm text-text-primary">
          {status?.status === 'past_due'
            ? t('supporter.pastDue')
            : status?.cancelAtPeriodEnd && end
              ? t('supporter.endsOn', { date: end })
              : end
                ? t('supporter.thanksNext', { date: end })
                : t('supporter.thanks')}
        </p>
      ) : compEnd ? (
        <p className="text-sm text-text-primary" data-testid="supporter-comp">
          {openEndedComp ? t('supporter.comp') : t('supporter.compUntil', { date: compEnd })}
        </p>
      ) : (
        <p className="text-sm text-text-primary">
          {grantEnd
            ? t('supporter.grantUntil', { date: grantEnd })
            : status?.early
              ? t('supporter.earlyThanks')
              : t('supporter.pitch')}{' '}
          <Link to="/supporter" className="underline">
            {status?.early ? t('supporter.supportAgain') : t('supporter.become')}
          </Link>
        </p>
      )}
      {subscribed && grantEnd && !compEnd && (
        <p className="text-sm text-text-primary" data-testid="supporter-grant">
          {t('supporter.grantAdds', { date: grantEnd })}
        </p>
      )}
      {status && status.status !== 'none' && (
        <div>
          <button type="button" className="btn-outline" disabled={pending != null} onClick={manage}>
            {pending === 'portal' ? t('supporter.opening') : t('supporter.manage')}
          </button>
        </div>
      )}
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </section>
  );
}
