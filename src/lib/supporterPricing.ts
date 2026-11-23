/**
 * Supporter prices (USD), the one source for every price the app shows. The
 * Stripe prices behind them are STRIPE_PRICE_ID_ANNUAL ($60/year) and
 * STRIPE_PRICE_ID_MONTHLY ($12/month) on the Pages project; subscribers on the
 * original $5/month price (STRIPE_PRICE_ID) keep it.
 */
export type SupporterPlan = 'annual' | 'monthly';

export const SUPPORTER_PRICING = {
  annual: { perMonth: 5, perYear: 60 },
  monthly: { perMonth: 12 },
} as const;

/** Annual's saving over twelve monthly payments, in whole percent (58). */
export const ANNUAL_SAVING_PCT = Math.round(
  (1 - SUPPORTER_PRICING.annual.perYear / (SUPPORTER_PRICING.monthly.perMonth * 12)) * 100,
);

export const DEFAULT_SUPPORTER_PLAN: SupporterPlan = 'annual';

export function isSupporterPlan(v: unknown): v is SupporterPlan {
  return v === 'annual' || v === 'monthly';
}
