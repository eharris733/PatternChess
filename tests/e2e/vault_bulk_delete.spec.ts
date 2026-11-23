import { expect, test } from '@playwright/test';
import { stubApp } from './helpers/api';

// Vault "Delete games…": pick a cutoff date, see the count, and delete exactly
// the games played before it.

const PROFILE = { lichess_username: 'tester' };

const DAY = 86_400_000;
const game = (id: string, daysAgo: number) => ({
  id,
  user_id: 'e2e-user',
  platform: 'lichess',
  username: 'tester',
  opponent: `opp-${id}`,
  time_control: '600+0',
  rated: true,
  result: '1-0',
  user_color: 'white',
  played_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  created_at: new Date().toISOString(),
  analyzed_at: new Date().toISOString(),
});
const GAMES = [game('g-new', 1), game('g-old1', 400), game('g-old2', 500)];

test('bulk delete removes only games played before the chosen date', async ({ page }) => {
  const deleted: string[] = [];
  const remaining = () => GAMES.filter((g) => !deleted.includes(g.id));
  await stubApp(page, {
    profile: PROFILE,
    rpc: {
      'games.list': () => remaining(),
      'games.totalCount': () => remaining().length,
      // deleteGames sends id chunks; the server answers with the count removed.
      'games.deleteMany': (args) => {
        const ids = (args.ids as string[]).filter((id) => !deleted.includes(id));
        deleted.push(...ids);
        return ids.length;
      },
    },
  });

  await page.goto('/vault?tab=games');
  await expect(page.getByText('3 games synced')).toBeVisible();
  await page.getByRole('button', { name: 'Delete games…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete games' });
  await expect(dialog.getByRole('button', { name: /^Delete \d+ game/ })).toBeDisabled();

  const cutoff = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  await dialog.getByLabel('Delete games played before this date').fill(cutoff);
  await dialog.getByRole('button', { name: 'Delete 2 games' }).click();

  await expect(dialog).toBeHidden();
  expect([...deleted].sort()).toEqual(['g-old1', 'g-old2']);
  await expect(page.getByText('1 game synced')).toBeVisible();
});
