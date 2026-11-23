import { getSessionUser } from '../../_shared/auth';
import type { AppEnv } from '../../_shared/db';
import {
  PERK_STATUSES,
  crossSite,
  json,
  linkCustomer,
  stripeClient,
  supporterBy,
  type StripeEnv,
} from '../../_shared/supporters';

function randomLetters(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => String.fromCharCode(97 + (b % 26))).join('');
}

/**
 * POST → { url } of a Stripe Checkout Session for the $5/month supporter
 * subscription. The player's Stripe customer is created (or reused) and linked
 * in `supporters` first, so every later webhook maps back through the customer.
 * Perks start from the webhook, never from the success page.
 */
export const onRequestPost: PagesFunction<StripeEnv & AppEnv> = async ({ request, env }) => {
  if (crossSite(request)) return json({ error: 'cross_site' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'sign_in_required' }, 401);

  const stripe = stripeClient(env);
  let row = await supporterBy(env, 'user_id', user.id);
  if (row && PERK_STATUSES.has(row.status)) return json({ error: 'already_supporter' }, 409);

  if (!row) {
    const customer = await stripe.customers.create(
      { email: user.email ?? undefined, metadata: { user_id: user.id, app: 'patternchess' } },
      { idempotencyKey: `pc-customer-${user.id}` },
    );
    row = await linkCustomer(env, user.id, customer.id);
  }

  const origin = new URL(request.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: row.stripe_customer_id,
    client_reference_id: user.id,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id, app: 'patternchess' } },
    success_url: `${origin}/supporter?thanks=1`,
    cancel_url: `${origin}/supporter`,
    integration_identifier: `patternchess_supporter_${randomLetters(8)}`,
  });
  if (!session.url) return json({ error: 'no_checkout_url' }, 502);
  return json({ url: session.url });
};
