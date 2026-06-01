import { supabase } from '../lib/supabase';
import { getAnonId } from '../lib/anonId';

// Anonymous landing-funnel events. Inserts are fire-and-forget and never throw
// — analytics must never break the page. The funnel_events table allows anon
// inserts (see the landing_funnel migration); only the admin_kpis() RPC reads
// it back. Bot filtering happens at read time (user-agent) plus the human-signal
// gating in useLandingView.
type FunnelType = 'landing_view' | 'demo_submit';

async function track(type: FunnelType, fields: Record<string, unknown>): Promise<void> {
  const anonId = getAnonId();
  if (!anonId) return;
  try {
    await supabase.from('funnel_events').insert({
      anon_id: anonId,
      type,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
      ...fields,
    });
  } catch {
    // swallow — never surface analytics failures to the user
  }
}

export function trackLandingView(): void {
  void track('landing_view', {});
}

export function trackDemoSubmit(platform: string, username: string): void {
  void track('demo_submit', { platform, username });
}
