import { describe, expect, it } from 'vitest';
import { CHECKOUT_BRANDING, supporterCheckoutParams } from './checkoutParams';

const base = { customerId: 'cus_1', userId: 'u-1', priceId: 'price_1', integrationSuffix: 'abcdefgh' };

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

  it('keeps the subscription wiring unchanged', () => {
    const p = supporterCheckoutParams({ ...base, origin: 'https://patternchess.com' });
    expect(p).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: 'u-1',
      line_items: [{ price: 'price_1', quantity: 1 }],
      subscription_data: { metadata: { user_id: 'u-1', app: 'patternchess' } },
      success_url: 'https://patternchess.com/supporter?thanks=1',
      cancel_url: 'https://patternchess.com/supporter',
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
});
