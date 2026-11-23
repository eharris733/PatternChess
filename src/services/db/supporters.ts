import { rpc } from '../../lib/api';

interface SupporterRow {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  first_supported_at: string | null;
  /** End of a running supporter grant (the referral reward), if any. */
  grant_ends_at?: string | null;
}

/** The player's own `supporters` row (server-scoped to the session), mirrored from Stripe by the webhook. */
export interface SupporterStatus {
  status: string;
  /**
   * Perks on now: a subscription in active/trialing/past_due, or a running
   * supporter grant (functions/_shared/supporterGrants.ts hasSupporterPerks).
   */
  active: boolean;
  /** Perks from the subscription itself (what "Manage subscription" is about). */
  subscribed: boolean;
  /** End of the perks earned by inviting friends; null without a running grant. */
  grantEndsAt: Date | null;
  /** Ever subscribed; keeps the Early Supporter flair after lapsing. */
  early: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  firstSupportedAt: Date | null;
}

const PERK_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function getMySupporterStatus(): Promise<SupporterStatus | null> {
  const data = await rpc<SupporterRow | null>('supporters.mine');
  if (!data) return null;
  const subscribed = PERK_STATUSES.has(data.status);
  const grantEndsAt = data.grant_ends_at ? new Date(data.grant_ends_at) : null;
  const granted = grantEndsAt != null && grantEndsAt.getTime() > Date.now();
  return {
    status: data.status,
    active: subscribed || granted,
    subscribed,
    grantEndsAt: granted ? grantEndsAt : null,
    early: data.first_supported_at != null,
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    firstSupportedAt: data.first_supported_at ? new Date(data.first_supported_at) : null,
  };
}

// Same-origin Pages Functions: the better-auth session cookie authenticates.
async function postStripe(path: 'checkout' | 'portal'): Promise<string> {
  const res = await fetch(`/api/stripe/${path}`, { method: 'POST', credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (res.status === 401) throw new Error('Sign in first.');
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
  const data = await rpc<
    {
      user_id: string;
      label: string;
      email: string | null;
      status: string;
      first_supported_at: string;
      current_period_end: string | null;
      cancel_at_period_end: boolean;
      beta_invited_at: string | null;
    }[]
  >('admin.supporters');
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

export interface ReferralSummary {
  /** Friends whose first positions earned you the reward (each is up to 3 months). */
  rewardsEarned: number;
  /** End of the perks those rewards give; null when none is running. */
  perksUntil: Date | null;
  /** Positions a friend trains to earn it (20). */
  positionsNeeded: number;
}

/** `referral.summary`: what the InviteCard shows about the referral reward. */
export async function getReferralSummary(): Promise<ReferralSummary> {
  const d = (await rpc<{ rewardsEarned?: number; perksUntil?: string | null; positionsNeeded?: number } | null>(
    'referral.summary',
  )) ?? {};
  return {
    rewardsEarned: Number(d.rewardsEarned ?? 0),
    perksUntil: d.perksUntil ? new Date(d.perksUntil) : null,
    positionsNeeded: Number(d.positionsNeeded ?? 20),
  };
}

/** A /path article body (functions/api/articles/[slug].ts): supporters only, null otherwise. */
export async function getSupporterContent(slug: string): Promise<string | null> {
  const res = await fetch(`/api/articles/${encodeURIComponent(slug)}`, { credentials: 'same-origin' });
  // 401 = signed out, 403 = not a supporter, 404 = no such article.
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { html?: string };
  return body.html ?? null;
}
