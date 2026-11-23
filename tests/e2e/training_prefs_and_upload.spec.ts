import { expect, test, type Page } from '@playwright/test';
import { rpcError, stubApp, type RpcHandlers, type RpcRecorder } from './helpers/api';

// Covers two of the testing-feedback features:
//  - the profile "Training" card persists the two new preference columns
//  - the PGN upload modal surfaces a color override when the entered name
//    doesn't match a game's White/Black headers (Lichess study exports).

const PROFILE = {
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
  current_streak_days: 0,
  longest_streak_days: 0,
  last_drill_local_date: null,
  timezone: null,
  board_theme: 'default',
  show_engine_evals: false,
  reveal_before_solve: false,
};

async function stubAuth(
  page: Page,
  opts: { patchBehavior?: 'ok' | 'slow' | 'fail' } = {},
) {
  const patchBehavior = opts.patchBehavior ?? 'ok';
  const rpc: RpcHandlers = {};
  if (patchBehavior === 'fail') {
    rpc['profile.update'] = () => rpcError(400, 'column does not exist', 'bad_request');
  } else if (patchBehavior === 'slow') {
    rpc['profile.update'] = () => new Promise((resolve) => setTimeout(() => resolve(null), 2000));
  }
  return stubApp(page, { profile: PROFILE, rpc });
}

/** Every profile.update patch sent so far. */
function patches(rec: RpcRecorder) {
  return rec.callsTo('profile.update').map((c) => c.args.patch as Record<string, unknown>);
}

test('profile training card saves the two preferences on toggle', async ({ page }) => {
  const rec = await stubAuth(page);
  await page.goto('/profile');

  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  // "Hide extra info" starts checked (reveal_before_solve: false); unchecking
  // it persists reveal_before_solve = true.
  await page.getByText('Hide extra info when solving').click();
  await expect.poll(() => patches(rec)).toContainEqual(expect.objectContaining({ reveal_before_solve: true }));

  await page.getByText('Show raw engine evals').click();
  await expect.poll(() => patches(rec)).toContainEqual(expect.objectContaining({ show_engine_evals: true }));

  // Drill-feedback prefs (shared with the board gear via useDrillFeedbackPrefs).
  await page.getByText('Show the answer after a miss').click();
  await expect.poll(() => patches(rec)).toContainEqual(expect.objectContaining({ show_answer_on_miss: true }));
});

test('linked-account fields are labelled and save the usernames', async ({ page }) => {
  const rec = await stubAuth(page);
  await page.goto('/profile');

  const lichess = page.getByLabel('Lichess username');
  await expect(lichess).toHaveValue('tester');
  await page.getByLabel('Chess.com username').fill('hikaru');
  await expect(page.getByRole('group', { name: 'Time controls' })).toBeVisible();

  await page.locator('#settings').getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => patches(rec))
    .toContainEqual(expect.objectContaining({ lichess_username: 'tester', chesscom_username: 'hikaru' }));
});

test('training toggles flip optimistically while the profile write is in flight', async ({ page }) => {
  await stubAuth(page, { patchBehavior: 'slow' });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  const checkbox = page
    .locator('label', { hasText: 'Hide extra info when solving' })
    .locator('input[type="checkbox"]');
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  // The write takes 2s in this stub; the checkbox must be unchecked well
  // before that — assert within 500ms.
  await expect(checkbox).not.toBeChecked({ timeout: 500 });
});

test('training toggles revert when the profile write fails', async ({ page }) => {
  await stubAuth(page, { patchBehavior: 'fail' });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();

  const checkbox = page
    .locator('label', { hasText: 'Hide extra info when solving' })
    .locator('input[type="checkbox"]');
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(page.getByText(/Could not save this preference/)).toBeVisible();
  await expect(checkbox).toBeChecked();
});

const UNMATCHED_PGN = `[Event "Club Championship"]
[Site "OTB"]
[White "Someone Else"]
[Black "Another Player"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

test('pgn upload surfaces the color override for unmatched games', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/vault');

  await page.getByRole('button', { name: 'Upload PGNs' }).first().click();
  await expect(page.getByRole('heading', { name: 'Upload PGNs' })).toBeVisible();

  // The modal's labels aren't htmlFor-associated — target by placeholder.
  await page.locator('textarea.input').fill(UNMATCHED_PGN);
  const nameInput = page.getByPlaceholder('e.g. drnykterstein');
  await nameInput.fill('tester');

  // The entered name matches neither header — the override appears.
  await expect(page.getByText(/don't list|doesn't list/)).toBeVisible();
  await expect(page.getByText('Not sure (analyze both sides)')).toBeVisible();
  await page.getByText('Black', { exact: true }).click();

  // A matching name makes the override disappear again.
  await nameInput.fill('Someone Else');
  await expect(page.getByText(/don't list|doesn't list/)).toHaveCount(0);
});
