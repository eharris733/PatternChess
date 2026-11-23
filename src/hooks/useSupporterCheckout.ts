import { useState } from 'react';
import { supabaseService } from '../services/supabaseService';
import { DEFAULT_SUPPORTER_PLAN, type SupporterPlan } from '../lib/supporterPricing';

/** Sends the player to Stripe Checkout (subscribe) or the Customer Portal (manage). */
export function useSupporterCheckout() {
  const [pending, setPending] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (kind: 'checkout' | 'portal', plan: SupporterPlan = DEFAULT_SUPPORTER_PLAN) => {
    setPending(kind);
    setError(null);
    try {
      const url =
        kind === 'checkout'
          ? await supabaseService.createSupporterCheckout(plan)
          : await supabaseService.createSupporterPortal();
      window.location.assign(url);
    } catch (err) {
      console.warn(`[supporter] ${kind} failed`, err);
      setError(
        err instanceof Error && err.message === 'already_supporter'
          ? "You're already a supporter. Thank you!"
          : "Couldn't reach the payment page. Try again in a moment.",
      );
      setPending(null);
    }
  };

  return {
    pending,
    error,
    /** Annual unless a plan is given. */
    checkout: (plan: SupporterPlan = DEFAULT_SUPPORTER_PLAN) => void go('checkout', plan),
    manage: () => void go('portal'),
  };
}
