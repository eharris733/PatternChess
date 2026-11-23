import { describe, expect, it } from 'vitest';
import { CHECKOUT_BRANDING, checkoutReturnPath, supporterCheckoutParams } from './checkoutParams';

const base = { returnPath: '/dashboard', customerId: 'cus_1', userId: 'u-1', priceId: 'price_1', plan: 'annual' as const, integrationSuffix: 'abcdefgh' };

describe('supporterCheckoutParams', () => {
  it('brands the session as PatternChess with its own copy', () => {
    const p = supporterCheckoutParams({ ...base, origin: 'https://feat-x.patternchess-1et.pages.dev' });
    expect(p.branding_settings).toMatchObject({
      display_name: 'PatternChess',
      background_color: CHECKOUT_BRANDING.background_color,
      button_color: CHECKOUT_BRANDING.button_color,
      icon: { type: 'url', url: 'https://feat-x.patternchess-1et.pages.dev/app-icon-512.png' },
    });
    expect(p.custom_text?.submit).toMatchObject({ message: expect.stringContaining('PatternChess Supporter') });
    expect(p.custom_text?.after_submit).toMatchObject({ message: expect.stringContaining('EH Solutions LLC') });
    for (const t of [p.custom_text?.submit, p.custom_text?.after_submit]) {
      expect((t as { message: string }).message.length).toBeLessThanOrEqual(1200); // Stripe's limit
    }
  });

  it('names the plan and its billing above the pay button', () => {
    const annual = supporterCheckoutParams({ ...base, origin: 'https://patternchess.com' });
    expect((annual.custom_text?.submit as { message: string }).message).toContain('$60 a year ($5 a month, billed annually)');
    const monthly = supporterCheckoutParams({ ...base, plan: 'monthly', origin: 'https://patternchess.com' });
    expect((monthly.custom_text?.submit as { message: string }).message).toContain('$12 a month');
  });

  it('keeps the subscription wiring unchanged', () => {
    const p = supporterCheckoutParams({ ...base, origin: 'https://patternchess.com' });
    expect(p).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: 'u-1',
      line_items: [{ price: 'price_1', quantity: 1 }],
      subscription_data: { metadata: { user_id: 'u-1', app: 'patternchess' } },
      success_url: 'https://patternchess.com/dashboard?supporter=thanks',
      cancel_url: 'https://patternchess.com/dashboard',
      integration_identifier: 'patternchess_supporter_abcdefgh',
    });
  });

  it('skips the icon when Stripe could not fetch it (local dev)', () => {
    for (const origin of ['http://localhost:8788', 'https://localhost:5173', 'http://127.0.0.1:8790']) {
      const p = supporterCheckoutParams({ ...base, origin });
      expect(p.branding_settings?.icon).toBeUndefined();
      expect(p.branding_settings?.display_name).toBe('PatternChess');
    }
  });

  it('comes back to the page checkout started from', () => {
    const p = supporterCheckoutParams({ ...base, returnPath: '/profile?tab=look', origin: 'https://patternchess.com' });
    expect(p.success_url).toBe('https://patternchess.com/profile?tab=look&supporter=thanks');
    expect(p.cancel_url).toBe('https://patternchess.com/profile?tab=look');
  });
});

describe('checkoutReturnPath', () => {
  it('keeps same-origin app paths, drops the fragment and stale flags', () => {
    expect(checkoutReturnPath('/profile#look')).toBe('/profile');
    expect(checkoutReturnPath('/training?x=1&supporter=thanks')).toBe('/training?x=1');
    expect(checkoutReturnPath('/supporter?checkout=1')).toBe('/supporter');
  });

  it('falls back to the dashboard for anything else', () => {
    for (const bad of [undefined, 42, '', 'https://evil.example/', '//evil.example', '/\\evil', '/login', '/']) {
      expect(checkoutReturnPath(bad)).toBe('/dashboard');
    }
  });
});
