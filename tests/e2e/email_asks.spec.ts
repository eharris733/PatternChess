import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, stubApp, type RpcRecorder } from './helpers/api';

// Dashboard email asks (src/lib/asks.ts): from the 2nd app open, accounts with
// reminders off are asked to turn them on, and Lichess sign-ins without an
// address are asked for one (confirmed by link). /profile carries the same form.

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
  opts: { profile?: Record<string, unknown>; lichess?: boolean; opens: number },
) {
  const rec = await stubApp(page, {
    // A Lichess sign-in has no email: better-auth stores a placeholder.
    user: opts.lichess
      ? { id: 'e2e-user', email: 'tester@lichess.invalid', name: 'tester', emailVerified: false }
      : E2E_USER,
    profile: { ...BASE_PROFILE, email_opt_in: false, app_opens: opts.opens - 1, ...opts.profile },
    gameCount: 1,
    rpc: { 'profile.bumpAppOpen': () => opts.opens },
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

test('a Lichess sign-in adds an address from the ask', async ({ page }) => {
  const rec = await stub(page, { opens: 2, lichess: true });
  await page.goto('/dashboard');
  const card = page.getByTestId('email-ask');
  await card.getByLabel('Email address').fill('player@example.com');
  await card.getByRole('button', { name: 'Yes, remind me' }).click();
  await expect(page.getByTestId('contact-email-pending')).toContainText('player@example.com');
  const p = profilePatches(rec).find((x) => x.contact_email);
  expect(p).toMatchObject({ contact_email: 'player@example.com', email_opt_in: true });
});

test('/profile lets a Lichess sign-in add an address', async ({ page }) => {
  await stub(page, { opens: 1, lichess: true });
  await page.goto('/profile');
  const section = page.getByTestId('email-reminders-setting');
  await expect(section.getByText(/doesn't share an email address/)).toBeVisible();
  await expect(section.getByTestId('contact-email-form')).toBeVisible();
});

test('/profile shows a typed-in address waiting for its confirmation click', async ({ page }) => {
  await stub(page, { opens: 1, lichess: true, profile: { contact_email: 'me@example.com', email_opt_in: true } });
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
