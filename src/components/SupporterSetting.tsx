import { Link } from 'react-router-dom';
import { useSupporter } from '../hooks/useSupporter';
import { useSupporterCheckout } from '../hooks/useSupporterCheckout';
import { HeartIcon } from './icons/HeartIcon';

/**
 * /profile#supporter: subscription status and "Manage subscription", the
 * perks earned by inviting friends (supporter_grants), or a pointer to
 * /supporter.
 */
export function SupporterSetting() {
  const { status, isSupporter, isPending } = useSupporter();
  const { manage, pending, error } = useSupporterCheckout();
  if (isPending) return null;

  const end = status?.currentPeriodEnd?.toLocaleDateString() ?? null;
  const subscribed = !!status?.subscribed;
  const grantEnd = status?.grantEndsAt?.toLocaleDateString() ?? null;
  return (
    <section className="card flex flex-col gap-3 scroll-mt-6" id="supporter" data-testid="supporter-setting">
      <h2 className="heading-md flex items-center gap-2">
        {isSupporter && <HeartIcon className="h-5 w-5" />}
        Supporter
      </h2>
      {subscribed ? (
        <p className="text-sm text-text-primary">
          {status?.status === 'past_due'
            ? "Your last payment didn't go through. Stripe will try again; you can update your card below."
            : status?.cancelAtPeriodEnd && end
              ? `Your support ends on ${end}. You keep the Early Supporter flair after that.`
              : `Thank you for supporting PatternChess. $5 a month${end ? `, next payment ${end}` : ''}.`}
        </p>
      ) : (
        <p className="text-sm text-text-primary">
          {grantEnd
            ? `You have Supporter perks until ${grantEnd}, thanks to the friends you invited.`
            : status?.early
              ? 'Thank you for supporting PatternChess. Your Early Supporter flair stays yours.'
              : 'PatternChess is free. If it helps your chess, $5 a month keeps it running.'}{' '}
          <Link to="/supporter" className="underline">
            {status?.early ? 'Support again' : 'Become a supporter'}
          </Link>
        </p>
      )}
      {subscribed && grantEnd && (
        <p className="text-sm text-text-primary" data-testid="supporter-grant">
          Your invite rewards add perks until {grantEnd}.
        </p>
      )}
      {status && status.status !== 'none' && (
        <div>
          <button type="button" className="btn-outline" disabled={pending != null} onClick={manage}>
            {pending === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        </div>
      )}
      {error && <p className="text-incorrect text-sm">{error}</p>}
    </section>
  );
}
