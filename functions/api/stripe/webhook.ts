import Stripe from 'stripe';
import { json, stripeClient, supporterBy, syncSubscription, type StripeEnv } from '../../_shared/supporters';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/**
 * Stripe webhook → `supporters`. Subscribe the endpoint to:
 *   checkout.session.completed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   invoice.paid, invoice.payment_failed, charge.dispute.created
 * Every subscription event re-reads the subscription (syncSubscription), so
 * retries and out-of-order deliveries are harmless. A non-2xx makes Stripe retry.
 */
export const onRequestPost: PagesFunction<StripeEnv> = async ({ request, env }) => {
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return json({ error: 'missing signature' }, 400);

  const stripe = stripeClient(env);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.warn('[stripe] bad signature', err);
    return json({ error: 'bad signature' }, 400);
  }

  let outcome = 'ignored';
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const subId = session.mode === 'subscription' ? idOf(session.subscription) : null;
      if (subId) outcome = await syncSubscription(env, stripe, subId);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      outcome = await syncSubscription(env, stripe, event.data.object.id);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId = idOf(event.data.object.parent?.subscription_details?.subscription);
      if (subId) outcome = await syncSubscription(env, stripe, subId);
      break;
    }
    case 'charge.dispute.created': {
      // A chargeback on a $5 support payment ends the subscription; the
      // resulting customer.subscription.deleted event updates the row.
      const charge = await stripe.charges.retrieve(idOf(event.data.object.charge)!);
      const customerId = idOf(charge.customer);
      const row = customerId ? await supporterBy(env, 'stripe_customer_id', customerId) : null;
      if (row?.stripe_subscription_id) {
        await stripe.subscriptions.cancel(row.stripe_subscription_id);
        outcome = `cancelled ${row.stripe_subscription_id} after dispute`;
      }
      break;
    }
  }
  console.log(`[stripe] ${event.type} ${event.id}: ${outcome}`);
  return json({ received: true });
};
