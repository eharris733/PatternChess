import clsx from 'clsx';
import { ANNUAL_SAVING_PCT, SUPPORTER_PRICING, type SupporterPlan } from '../../lib/supporterPricing';
import { useT } from '../../i18n/useT';

/**
 * Annual or monthly, side by side: annual (preselected) shows its monthly
 * equivalent with "Billed annually" and the saving, monthly its own price.
 * Prices come only from SUPPORTER_PRICING.
 */
export function SupporterPlanChoice({
  value,
  onChange,
  className,
}: {
  value: SupporterPlan;
  onChange: (plan: SupporterPlan) => void;
  className?: string;
}) {
  const t = useT();
  const options: { plan: SupporterPlan; price: string; billed: string; badge?: string }[] = [
    {
      plan: 'annual',
      price: t('supporterPlan.perMonth', { amount: String(SUPPORTER_PRICING.annual.perMonth) }),
      billed: t('supporterPlan.billedAnnually', { amount: String(SUPPORTER_PRICING.annual.perYear) }),
      badge: t('supporterPlan.save', { pct: String(ANNUAL_SAVING_PCT) }),
    },
    {
      plan: 'monthly',
      price: t('supporterPlan.perMonth', { amount: String(SUPPORTER_PRICING.monthly.perMonth) }),
      billed: t('supporterPlan.billedMonthly'),
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('supporterPlan.label')}
      className={clsx('grid grid-cols-2 gap-2', className)}
      data-testid="supporter-plan-choice"
    >
      {options.map((o) => {
        const selected = value === o.plan;
        return (
          <button
            key={o.plan}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.plan)}
            data-testid={`supporter-plan-${o.plan}`}
            className={clsx(
              'relative flex flex-col items-start gap-0.5 border-2 px-3 py-2.5 text-left transition-colors',
              selected ? 'border-gold-dark bg-accent/15' : 'border-text-primary/30 hover:border-text-primary',
            )}
          >
            <span className="label">{o.plan === 'annual' ? t('supporterPlan.annual') : t('supporterPlan.monthly')}</span>
            <span className="font-mono text-lg font-semibold text-text-primary">{o.price}</span>
            <span className="text-xs text-text-primary">{o.billed}</span>
            {o.badge && (
              <span className="absolute -top-2.5 right-2 border-2 border-gold-dark bg-gold-dark px-1.5 font-mono text-[10px] uppercase tracking-tight text-bg">
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
