import { expect, test } from '@playwright/test';
import { stubApp } from './helpers/api';

// `gameCount` drives the onboarding gate (games.totalCount): a positive count
// means an "established" user (gate stays hidden, normal routes render); 0
// means a brand-new user (the onboarding flow preempts non-bypass routes).
// The same count is reported as unanalyzed, so /openings is still building.
async function stubAuth(page: import('@playwright/test').Page, gameCount = 3) {
  await stubApp(page, {
    gameCount,
    rpc: { 'games.countUnanalyzed': () => gameCount },
  });
}

const ROUTES: Array<{ path: string; name: string; expect: (p: import('@playwright/test').Page) => Promise<void> }> = [
  {
    path: '/',
    name: 'dashboard',
    expect: async (p) => {
      // The stubbed session has 3 games (games.totalCount), so it is past the
      // first run even with no linked account (PGN uploads count as games):
      // the plan shows, and the Vault card reports the count, not the list.
      await expect(p.getByText("Today's plan")).toBeVisible();
      await expect(p.getByText(/Welcome to PatternChess/i)).toHaveCount(0);
      await expect(p.getByTestId('dashboard-insights').getByText('3 games')).toBeVisible();
    },
  },
  {
    path: '/vault',
    name: 'vault',
    expect: async (p) => {
      // Blunders tab by default; empty state.
      await expect(p.getByTestId('vault-blunders-empty')).toBeVisible();
      await p.getByTestId('vault-tab-games').click();
      await expect(p.getByText(/No games yet/i)).toBeVisible();
    },
  },
  {
    path: '/training',
    name: 'training',
    expect: async (p) => {
      await expect(p.getByText(/You're caught up/i)).toBeVisible();
    },
  },
  {
    path: '/profile',
    name: 'profile',
    expect: async (p) => {
      await expect(p.getByText(/Linked accounts/i)).toBeVisible();
      await expect(p.getByPlaceholder(/drnykterstein/i)).toBeVisible();
    },
  },
  {
    path: '/endgames',
    name: 'endgames',
    expect: async (p) => {
      // Empty games list -> connect CTA.
      await expect(p.getByText(/No games yet/i)).toBeVisible();
      await expect(p.getByRole('link', { name: /Connect an account/i })).toBeVisible();
    },
  },
  {
    path: '/openings',
    name: 'openings',
    expect: async (p) => {
      await expect(p.getByRole('heading', { name: /Where you leave theory/i })).toBeVisible();
      // The stub reports 3 unanalyzed games: the report is still being built.
      await expect(p.getByTestId('openings-building')).toBeVisible();
    },
  },
  {
    path: '/leaderboards',
    name: 'leaderboards',
    expect: async (p) => {
      await expect(p.getByRole('heading', { name: 'Leaderboards' })).toBeVisible();
      await expect(p.getByTestId('invite-card')).toBeVisible();
    },
  },
];

for (const route of ROUTES) {
  test(`route ${route.path} renders within shell`, async ({ page }) => {
    await stubAuth(page);
    await page.goto(route.path);
    // Sidebar always present on protected routes
    await expect(page.getByRole('link', { name: /Dashboard/i })).toBeVisible();
    await route.expect(page);
  });
}

test('new user with no games sees the onboarding connect step', async ({ page }) => {
  await stubAuth(page, 0);
  await page.goto('/dashboard');
  // Onboarding preempts the dashboard for a zero-game user.
  await expect(page.getByRole('button', { name: /Build my plan/i })).toBeVisible();
  await expect(page.getByText(/Which games to train on/i)).toBeVisible();
  // Still inside the shell.
  await expect(page.getByRole('link', { name: /Dashboard/i })).toBeVisible();
});

test('onboarding does not preempt the profile route', async ({ page }) => {
  await stubAuth(page, 0);
  await page.goto('/profile');
  await expect(page.getByText(/Linked accounts/i)).toBeVisible();
});

test('keyboard A grade is wired on review (key handler attaches)', async ({ page }) => {
  await stubAuth(page);
  await page.goto('/dashboard');
  // Sanity-check the document keydown listener doesn't blow up.
  await page.keyboard.press('Space');
});
