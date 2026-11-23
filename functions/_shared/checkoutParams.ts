import type Stripe from 'stripe';

/**
 * PatternChess look for the hosted Checkout page: each session carries its own
 * display name, colours (the default board theme's paper and gold,
 * src/styles/themes.css) and copy, so it never depends on the account's
 * dashboard branding. The public business name on card statements and receipts
 * is a dashboard setting, outside this code.
 */
export const CHECKOUT_BRANDING = {
  display_name: 'PatternChess',
  background_color: '#F4F4F0',
  button_color: '#8B6914',
  border_style: 'rectangular',
  font_family: 'inter',
} as const satisfies Stripe.Checkout.SessionCreateParams.BrandingSettings;

/** Shown above the pay button. */
export const CHECKOUT_SUBMIT_MESSAGE =
  'PatternChess Supporter: $5 a month to keep daily training free for everyone. Cancel any time from your profile.';

/** Shown under the pay button, before payment. */
export const CHECKOUT_AFTER_SUBMIT_MESSAGE =
  'Billed by EH Solutions LLC, the company behind PatternChess. Your daily training stays free either way.';

/** Stripe fetches the icon itself, so only a public https origin can serve it. */
function publicIconUrl(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null;
  return `${url.origin}/app-icon-512.png`;
}

/**
 * Where Checkout returns to: a same-origin app path the client passed (the page
 * the player upgraded from), else the dashboard. Never another origin and
 * never a fragment (Stripe keeps the URL as given).
 */
export function checkoutReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/dashboard';
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/dashboard';
  const base = 'https://return.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return '/dashboard';
  }
  if (url.origin !== base || url.pathname === '/login' || url.pathname === '/') return '/dashboard';
  url.searchParams.delete('supporter');
  url.searchParams.delete('checkout');
  return url.pathname + url.search;
}

/** `path` with `supporter=thanks` added (the app shell shows the thank-you notice). */
export function withThanks(path: string): string {
  return path + (path.includes('?') ? '&' : '?') + 'supporter=thanks';
}

export interface CheckoutInput {
  origin: string;
  /** Same-origin path to come back to (checkoutReturnPath). */
  returnPath: string;
  customerId: string;
  userId: string;
  priceId: string;
  /** Suffix for Stripe's integration_identifier. */
  integrationSuffix: string;
}

/** The supporter subscription's Checkout Session, branded as PatternChess. */
export function supporterCheckoutParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  const icon = publicIconUrl(input.origin);
  return {
    mode: 'subscription',
    customer: input.customerId,
    client_reference_id: input.userId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    subscription_data: { metadata: { user_id: input.userId, app: 'patternchess' } },
    success_url: `${input.origin}${withThanks(input.returnPath)}`,
    cancel_url: `${input.origin}${input.returnPath}`,
    integration_identifier: `patternchess_supporter_${input.integrationSuffix}`,
    branding_settings: {
      ...CHECKOUT_BRANDING,
      ...(icon ? { icon: { type: 'url', url: icon } } : {}),
    },
    custom_text: {
      submit: { message: CHECKOUT_SUBMIT_MESSAGE },
      after_submit: { message: CHECKOUT_AFTER_SUBMIT_MESSAGE },
    },
  };
}
