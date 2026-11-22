import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, stubApp } from './helpers/api';

// $5/month supporter tier: /supporter hands off to Stripe Checkout through
// /api/stripe/checkout, shows the thank-you state for active supporters,
// /profile carries "Manage subscription", and the dashboard ask appears from
// the 4th open after a finished session.

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');
}

const BASE_PROFILE = {
  id: 'e2e-user',
  display_name: 'E2E User',
  avatar_url: null,
  lichess_username: 'tester',
  chesscom_username: null,
  preferred_rated_only: false,
  preferred_time_controls: [],
  last_synced_lichess_at: null,
  last_synced_chesscom_at: null,
  created_at: new Date().toISOString(),
  current_streak_days: 9,
  longest_streak_days: 9,
  last_drill_local_date: daysAgo(1),
  timezone: null,
  board_theme: 'default',
  commitment_level: 'regular',
  daily_positions_goal: 10,
  daily_games_goal: 1,
  streak_freezes: 0,
};



async function stub(
  page: Page,
  opts: { signedIn?: boolean; supporter?: Record<string, unknown> | null; opens?: number; profile?: Record<string, unknown> } = {},
) {
  const rec = await stubApp(page, {
    user: (opts.signedIn ?? true) ? E2E_USER : null,
    profile: { ...BASE_PROFILE, email_opt_in: true, app_opens: (opts.opens ?? 1) - 1, ...opts.profile },
    gameCount: 1,
    rpc: {
      'profile.bumpAppOpen': () => opts.opens ?? 1,
      'supporters.mine': () => opts.supporter ?? null,
    },
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
}

const ACTIVE = {
  status: 'active',
  current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  cancel_at_period_end: false,
  first_supported_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
};

test('signed out, /supporter asks to sign up first', async ({ page }) => {
  await stub(page, { signedIn: false });
  await page.goto('/supporter');
  await expect(page.getByRole('heading', { name: "Back the thing that's backing your chess." })).toBeVisible();
  await expect(page.getByTestId('supporter-cta').getByRole('link', { name: 'Sign up free' })).toBeVisible();
  await expect(page.getByText('First in line for the beta when it opens.')).toBeVisible();
});

test('"Become a supporter" posts to /api/stripe/checkout and goes to Stripe', async ({ page }) => {
  await stub(page);
  // Same-origin POST: the better-auth session cookie authenticates it.
  let method: string | null = null;
  await page.route('**/api/stripe/checkout', async (route) => {
    method = route.request().method();
    await route.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/cs_test_e2e' } });
  });
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ body: '<h1>Stripe Checkout</h1>', contentType: 'text/html' }));
  await page.goto('/supporter');
  await page.getByTestId('supporter-checkout').click();
  await page.waitForURL('https://checkout.stripe.com/**');
  expect(method).toBe('POST');
});

test('an active supporter sees thanks, and /profile offers "Manage subscription"', async ({ page }) => {
  await stub(page, { supporter: ACTIVE });
  await page.goto('/supporter');
  await expect(page.getByText("You're a supporter. Thank you.")).toBeVisible();
  await page.goto('/profile');
  const section = page.getByTestId('supporter-setting');
  await expect(section.getByText(/Thank you for supporting PatternChess/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Manage subscription' })).toBeVisible();
});

test('the dashboard asks for support from the 4th open after a finished session', async ({ page }) => {
  // The course ask (open 3) comes first while a course is available and none is
  // followed; this player already answered it.
  const rec = await stub(page, {
    opens: 4,
    profile: { course_prompted_at: new Date().toISOString(), course_prompt_count: 1 },
  });
  await page.goto('/dashboard');
  const card = page.getByTestId('supporter-ask');
  await expect(card.getByText('Enjoying the plan? Help keep it running.')).toBeVisible();
  await card.getByRole('button', { name: 'Maybe later' }).first().click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => rec.callsTo('profile.markAskPrompted')[0]?.args).toEqual({ ask: 'supporter' });
});

test('supporters are never asked for support', async ({ page }) => {
  await stub(page, { opens: 6, supporter: ACTIVE });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('supporter-ask')).toHaveCount(0);
});
