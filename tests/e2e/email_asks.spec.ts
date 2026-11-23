import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, stubApp, type RpcHandlers, type RpcRecorder } from './helpers/api';

// Dashboard email asks (src/lib/asks.ts): from the 2nd app open, accounts with
// reminders off are asked to turn them on. Lichess sign-ins without an address
// can't pass the required email step (OnboardingEmail) until they add one
// (confirmed by link). /profile carries the same form.

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
  opts: { profile?: Record<string, unknown>; lichess?: boolean; opens: number; rpc?: RpcHandlers },
) {
  const rec = await stubApp(page, {
    // A Lichess sign-in has no email: better-auth stores a placeholder.
    user: opts.lichess
      ? { id: 'e2e-user', email: 'tester@lichess.invalid', name: 'tester', emailVerified: false }
      : E2E_USER,
    profile: { ...BASE_PROFILE, email_opt_in: false, app_opens: opts.opens - 1, ...opts.profile },
    gameCount: 1,
    rpc: { 'profile.bumpAppOpen': () => opts.opens, ...opts.rpc },
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
}

const profilePatches = (rec: RpcRecorder) => rec.callsTo('profile.update').map((c) => c.args.patch as Record<string, any>);

test('no ask on the first open', async ({ page }) => {
  const rec = await stub(page, { opens: 1 });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
  expect(rec.calls.map((c) => c.name)).toContain('profile.bumpAppOpen');
});

test('the 2nd open asks a Google account to turn reminders on', async ({ page }) => {
  const rec = await stub(page, { opens: 2 });
  await page.goto('/dashboard');
  const card = page.getByTestId('email-ask');
  await expect(card.getByText("Want a nudge when it's time to train?")).toBeVisible();
  await card.getByRole('button', { name: 'Yes, remind me' }).click();
  await expect(page.getByTestId('email-ask-done')).toBeVisible();
  await expect.poll(() => profilePatches(rec).some((p) => p.email_opt_in === true)).toBe(true);
});

test('"Not now" records the answer and hides the card', async ({ page }) => {
  const rec = await stub(page, { opens: 3 });
  await page.goto('/dashboard');
  await page.getByTestId('email-ask').getByRole('button', { name: 'Not now' }).first().click();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
  await expect.poll(() => rec.callsTo('profile.markAskPrompted')[0]?.args).toEqual({ ask: 'email' });
});

test('an ask answered 2 weeks ago twice never comes back', async ({ page }) => {
  await stub(page, {
    opens: 9,
    profile: { email_prompted_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), email_prompt_count: 2 },
  });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
});

test('a Lichess sign-in must add and confirm an address before the dashboard', async ({ page }) => {
  // A stateful profile whose address is confirmed when the test says so (the
  // email's link, clicked in another tab).
  const row: Record<string, unknown> = { ...BASE_PROFILE, email_opt_in: false, app_opens: 1 };
  let confirmed = false;
  const read = () => ({ ...row, contact_email_verified_at: confirmed ? new Date().toISOString() : null });
  const rec = await stub(page, {
    opens: 2,
    lichess: true,
    rpc: {
      'profile.get': read,
      'profile.getOrCreate': read,
      'profile.update': (a) => {
        Object.assign(row, a.patch ?? {});
        return null;
      },
      'profile.resendConfirm': () => ({ sent: true }),
    },
  });
  await page.goto('/dashboard');
  const step = page.getByTestId('onboarding-email');
  await expect(step.getByRole('heading', { name: 'Where should we send your daily plan?' })).toBeVisible();
  await expect(step.getByTestId('logo-lichess')).toBeVisible();
  // No skip: the dashboard stays behind the step, on every protected route.
  await expect(page.getByText('Train 10 positions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /not now|skip/i })).toHaveCount(0);
  await page.goto('/profile');
  await expect(page.getByTestId('onboarding-email')).toBeVisible();

  const continueBtn = step.getByRole('button', { name: 'Continue' });
  await expect(continueBtn).toBeDisabled();
  await step.getByLabel('Email address').fill('player@example.com');
  await continueBtn.click();
  // Saved, not confirmed: still no app, just "check your inbox".
  const check = page.getByTestId('onboarding-email-check');
  await expect(check).toContainText('We sent a link to player@example.com');
  const p = profilePatches(rec).find((x) => x.contact_email);
  expect(p).toMatchObject({ contact_email: 'player@example.com', email_opt_in: true });
  await check.getByTestId('resend-confirm').click();
  await expect(check).toContainText('Sent. Check your inbox.');
  await check.getByTestId('email-clicked').click();
  await expect(page.getByTestId('onboarding-email-check')).toBeVisible();

  // The link is clicked elsewhere: the gate notices on its own and opens the app.
  confirmed = true;
  await expect(page.getByTestId('onboarding-email')).toHaveCount(0, { timeout: 10_000 });
  await page.goto('/dashboard');
  await expect(page.getByText('Train 10 positions')).toBeVisible();
  // The address is in, so the dashboard's own email ask has nothing to ask.
  await expect(page.getByTestId('email-ask')).toHaveCount(0);
});

test('/profile shows a typed-in address waiting for its confirmation click', async ({ page }) => {
  // A Google account that switched to another address (a Lichess one waits at the gate).
  await stub(page, { opens: 1, profile: { contact_email: 'me@example.com', email_opt_in: true } });
  await page.goto('/profile');
  await expect(page.getByTestId('contact-email-pending')).toContainText('me@example.com');
});

test('/profile picks the reminder hour', async ({ page }) => {
  const rec = await stub(page, { opens: 1, profile: { email_opt_in: true, email_hour: 18 } });
  await page.goto('/profile');
  const hour = page.getByTestId('email-hour');
  await expect(hour).toHaveValue('18');
  await hour.selectOption('8');
  await expect.poll(() => profilePatches(rec).some((p) => p.email_hour === 8)).toBe(true);
});
