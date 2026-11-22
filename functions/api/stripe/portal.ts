import { authedUser, json, stripeClient, supporterBy, type StripeEnv } from '../../_shared/supporters';

/** POST → { url } of a Stripe Customer Portal session (update card, cancel, invoices). */
export const onRequestPost: PagesFunction<StripeEnv> = async ({ request, env }) => {
  const user = await authedUser(request, env);
  if (!user) return json({ error: 'sign_in_required' }, 401);

  const row = await supporterBy(env, 'user_id', user.id);
  if (!row) return json({ error: 'not_a_customer' }, 404);

  const session = await stripeClient(env).billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    configuration: env.STRIPE_PORTAL_CONFIG_ID,
    return_url: `${new URL(request.url).origin}/profile#supporter`,
  });
  return json({ url: session.url });
};
