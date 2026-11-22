import { supabase } from '../../lib/supabase';

/** The player's own `supporters` row (RLS: read own), mirrored from Stripe by the webhook. */
export interface SupporterStatus {
  status: string;
  /** Perks on now: active, trialing or past_due (same rule as `is_supporter`). */
  active: boolean;
  /** Ever subscribed; keeps the Early Supporter flair after lapsing. */
  early: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  firstSupportedAt: Date | null;
}

const PERK_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function getMySupporterStatus(): Promise<SupporterStatus | null> {
  const { data, error } = await supabase
    .from('supporters')
    .select('status, current_period_end, cancel_at_period_end, first_supported_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    status: data.status,
    active: PERK_STATUSES.has(data.status),
    early: data.first_supported_at != null,
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    firstSupportedAt: data.first_supported_at ? new Date(data.first_supported_at) : null,
  };
}

async function postStripe(path: 'checkout' | 'portal'): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(`/api/stripe/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.url;
}

/** URL of a Stripe Checkout page for the $5/month supporter subscription. */
export function createSupporterCheckout(): Promise<string> {
  return postStripe('checkout');
}

/** URL of the Stripe Customer Portal (update card, cancel, invoices). */
export function createSupporterPortal(): Promise<string> {
  return postStripe('portal');
}

export interface AdminSupporter {
  userId: string;
  label: string;
  email: string | null;
  status: string;
  firstSupportedAt: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  betaInvitedAt: string | null;
}

/** Everyone who has ever subscribed (admin only), for thanks and the mobile-app beta. */
export async function getAdminSupporters(): Promise<AdminSupporter[]> {
  const { data, error } = await supabase.rpc('admin_supporters');
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((r) => ({
    userId: r.user_id,
    label: r.label,
    email: r.email,
    status: r.status,
    firstSupportedAt: r.first_supported_at,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    betaInvitedAt: r.beta_invited_at,
  }));
}
