import { expect, test, type Page } from '@playwright/test';
import { E2E_USER, stubApp } from './helpers/api';

// Personalization (feedback round, 2026-11-22): pixel avatars, reward themes
// and piece sets on /profile, the reward reveal, avatars on leaderboards,
// training-setting previews and the referral reward copy.

const AVATAR = {
  background: 'sky',
  skin: 's3',
  hair: 'spiky',
  hairColor: 'brown',
  eyes: 'dots',
  mouth: 'smile',
  outfit: 'hoodie',
  outfitColor: 'gold',
  accessory: 'none',
};

/** One blunder row carrying `solved` first-attempt solves (blunder stats; the path reads sessions, below). */
function blunders(solved: number) {
  return solved
    ? [
        {
          id: 'b1',
          fen: '8/8/8/8/8/8/8/8 w - - 0 1',
          kind: 'tactic',
          times_correct: solved,
          times_attempted: solved,
          cycle_number: 1,
          last_drilled_at: new Date().toISOString(),
          next_drill_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ]
    : [];
}

/**
 * The path counts first-attempt positions like the daily goal: the sum of
 * training_sessions.blunders_attempted (profile.trainingTotals -> positions).
 */
function sessions(solved: number) {
  if (!solved) return [];
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return [
    { id: 's1', local_date: day, started_at: new Date().toISOString(), ended_at: null, blunders_attempted: solved, blunders_correct: solved, cycles_completed: 0 },
  ];
}

async function stub(page: Page, opts: { solved?: number; profile?: Record<string, unknown>; rpc?: Record<string, (a: any) => unknown> } = {}) {
  const rec = await stubApp(page, {
    profile: { lichess_username: 'tester', ...opts.profile },
    blunders: blunders(opts.solved ?? 0),
    sessions: sessions(opts.solved ?? 0),
    gameCount: 3,
    rpc: opts.rpc,
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('pc:last-auto-sync', JSON.stringify({ fp: 'e2e-user|tester||0|', at: Date.now() }));
  });
  return rec;
}

const patches = (rec: Awaited<ReturnType<typeof stub>>) =>
  rec.callsTo('profile.update').map((c) => c.args.patch as Record<string, unknown>);

test('the Look section picks unlocked themes and pieces, and locks the rest', async ({ page }) => {
  const rec = await stub(page, { solved: 30 });
  await page.goto('/profile#look');
  const look = page.getByTestId('look-section');
  await expect(look).toBeVisible();

  // 30 positions: Walnut (10) and Chessnut (25) are open, Tournament (100) is not.
  await expect(look.getByTestId('theme-option-tournament')).toHaveAttribute('data-locked', 'true');
  await expect(look.getByTestId('theme-option-tournament')).toContainText('Unlocks at 100 positions trained');
  // A locked look leads to Supporter instead of a dead button.
  await look.getByTestId('theme-option-tournament').click();
  const sheet = page.getByTestId('supporter-unlock');
  await expect(sheet).toContainText('Tournament theme');
  await expect(sheet).toContainText('Unlocks at 100 positions trained, or unlock it now with Supporter.');
  await expect(sheet.getByTestId('supporter-unlock-checkout')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'tournament');
  await look.getByTestId('theme-option-walnut').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'walnut');
  await expect.poll(() => patches(rec)).toContainEqual({ theme: 'walnut' });

  await expect(look.getByTestId('piece-set-option-fantasy')).toHaveAttribute('data-locked', 'true');
  await look.getByTestId('piece-set-option-chessnut').click();
  await expect(page.locator('html')).toHaveAttribute('data-piece-set', 'chessnut');
  await expect.poll(() => patches(rec)).toContainEqual({ piece_set: 'chessnut' });
  // Classic is the default and stores NULL.
  await look.getByTestId('piece-set-option-cburnett').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-piece-set', /.+/);
  await expect.poll(() => patches(rec)).toContainEqual({ piece_set: null });
});

test('a legacy theme also writes board_theme; a reward theme writes only theme', async ({ page }) => {
  const rec = await stub(page, { solved: 10 });
  await page.goto('/profile#look');
  await page.getByTestId('theme-option-green').click();
  await expect.poll(() => patches(rec)).toContainEqual({ theme: 'green', board_theme: 'green' });
});

test('the avatar builder saves parts and shows them in the sidebar and header', async ({ page }) => {
  const rec = await stub(page, { solved: 0 });
  await page.goto('/profile#look');
  const builder = page.getByTestId('avatar-builder');
  await expect(builder).toBeVisible();
  // Reward accessories are locked at 0 positions.
  await builder.getByRole('tab', { name: 'Extra' }).click();
  await expect(builder.getByTestId('avatar-option-accessory-crown')).toHaveAttribute('data-locked', 'true');
  await builder.getByTestId('avatar-option-accessory-glasses').click();
  await builder.getByRole('tab', { name: 'Hair', exact: true }).click();
  await builder.getByTestId('avatar-option-hair-bob').click();
  await builder.getByTestId('avatar-save').click();
  const saved = await rec.waitFor('profile.update', (a) => a.patch?.avatar != null);
  expect(saved.args.patch.avatar).toMatchObject({ accessory: 'glasses', hair: 'bob' });
  await expect(builder.getByTestId('avatar-save')).toHaveText('Avatar saved');
  await expect(page.getByTestId('profile-avatar').locator('svg rect').first()).toBeVisible();
});

test('a stored avatar is drawn on the leaderboard next to each player', async ({ page }) => {
  await stub(page, {
    profile: { avatar: AVATAR },
    rpc: {
      'leaderboard.get': () => ({
        rows: [
          { rank: 1, label: 'rival', value: 12, isMe: false, flair: null, supporter: 'supporter', avatar: { ...AVATAR, hair: 'long' } },
          { rank: 2, label: 'tester', value: 7, isMe: true, flair: null, supporter: null, avatar: AVATAR },
        ],
        me: { rank: 2, label: 'tester', value: 7, isMe: true, flair: null, supporter: null, avatar: AVATAR },
      }),
    },
  });
  await page.goto('/leaderboards');
  const board = page.getByTestId('leaderboard');
  await expect(board.getByText('rival')).toBeVisible();
  await expect(board.locator('li', { hasText: 'rival' }).locator('svg rect').first()).toBeVisible();
  await expect(page.getByTestId('leaderboard-me').locator('svg rect').first()).toBeVisible();
});

test('reaching a rung reveals its reward once, and "Use it now" puts it on', async ({ page }) => {
  // A returning player whose seen-set predates the 10-position rung.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pc:test-seeded')) {
      localStorage.setItem('pc:rewards-seen:e2e-user', JSON.stringify({ ids: [], ach: true }));
      sessionStorage.setItem('pc:test-seeded', '1');
    }
  });
  const rec = await stub(page, { solved: 12 });
  await page.goto('/path');
  const reveal = page.getByTestId('reward-reveal');
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText('Walnut theme');
  await expect(reveal).toContainText('For 10 positions trained');
  await reveal.getByTestId('reward-use').click();
  await expect(reveal).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'walnut');
  await expect.poll(() => patches(rec)).toContainEqual({ theme: 'walnut' });

  // Seen: a reload doesn't show it again.
  await page.reload();
  await expect(page.getByRole('heading', { name: '12 positions trained' })).toBeVisible();
  await expect(page.getByTestId('reward-reveal')).toHaveCount(0);
});

test('first visit seeds the seen-set silently (history never pops up)', async ({ page }) => {
  await stub(page, { solved: 120 });
  await page.goto('/path');
  await expect(page.getByRole('heading', { name: '120 positions trained' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('reward-reveal')).toHaveCount(0);
});

test('a freeze rung banks a streak freeze through the server and reveals it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pc:rewards-seen:e2e-user', JSON.stringify({ ids: ['rung-10-walnut', 'rung-25-chessnut', 'rung-50-beanie'], ach: true }));
  });
  const rec = await stub(page, {
    solved: 55,
    rpc: { 'profile.claimPathReward': () => ({ granted: true, reason: null, streakFreezes: 1 }) },
  });
  await page.goto('/path');
  const reveal = page.getByTestId('reward-reveal');
  await expect(reveal).toContainText('A streak freeze');
  expect(rec.callsTo('profile.claimPathReward').map((c) => c.args)).toEqual([{ rung: 50 }]);
});

test('training settings show a preview that follows the switch', async ({ page }) => {
  const rec = await stub(page);
  await page.goto('/profile#training');
  const card = page.getByTestId('pref-show-answer');
  await expect(card.locator('svg').first()).toBeVisible();
  await expect(card).not.toContainText('Best: Nc7+');
  await card.getByRole('checkbox').check();
  await expect(card.locator('svg text', { hasText: 'Best: Nc7+' })).toBeVisible();
  await expect.poll(() => patches(rec)).toContainEqual(expect.objectContaining({ show_answer_on_miss: true }));
  for (const id of ['pref-hide-info', 'pref-raw-evals', 'pref-autoplay', 'pref-sounds']) {
    await expect(page.getByTestId(id).locator('svg').first()).toBeVisible();
  }
});

test('the invite card states the referral reward, and a grant shows as Supporter perks', async ({ page }) => {
  const until = new Date(Date.now() + 80 * 86_400_000).toISOString();
  await stub(page, {
    rpc: {
      'referral.summary': () => ({ rewardsEarned: 1, perksUntil: until, positionsNeeded: 20 }),
      'supporters.mine': () => ({
        status: 'none',
        current_period_end: null,
        cancel_at_period_end: false,
        first_supported_at: null,
        grant_ends_at: until,
      }),
    },
  });
  await page.goto('/leaderboards');
  await expect(page.getByTestId('invite-reward')).toContainText('trains their first 20 positions, you get 3 months of Supporter perks');
  await expect(page.getByTestId('invite-earned')).toContainText('Supporter perks until');

  await page.goto('/profile#supporter');
  await expect(page.getByTestId('supporter-setting')).toContainText('thanks to the friends you invited');
  await expect(page.getByTestId('supporter-setting').getByRole('button', { name: 'Manage subscription' })).toHaveCount(0);

  // Perks: every reward theme is open to a supporter.
  await page.goto('/profile#look');
  await expect(page.getByTestId('theme-option-midnight')).toBeEnabled();
});

test('a comp grant reads as on the house, and the invite card drops the reward pitch', async ({ page }) => {
  const forever = '2099-12-31T00:00:00.000Z';
  await stub(page, {
    rpc: {
      'referral.summary': () => ({ rewardsEarned: 0, perksUntil: null, positionsNeeded: 20 }),
      'supporters.mine': () => ({
        status: 'none',
        current_period_end: null,
        cancel_at_period_end: false,
        first_supported_at: null,
        grant_ends_at: forever,
        comp_ends_at: forever,
      }),
    },
  });
  await page.goto('/leaderboards');
  await expect(page.getByTestId('invite-reward')).toHaveText('Send your link and see how your friends stack up against you.');
  await expect(page.getByTestId('invite-earned')).toHaveCount(0);

  await page.goto('/profile#supporter');
  const card = page.getByTestId('supporter-setting');
  await expect(card.getByTestId('supporter-comp')).toHaveText(
    'Your Supporter perks are on the house. Thank you for being part of PatternChess.',
  );
  await expect(card).not.toContainText('friends you invited');
  await expect(card).not.toContainText('2099');
});

test('signed-in pages use the chosen piece set; public pages keep the classic pieces', async ({ page }) => {
  await stub(page, { solved: 30, profile: { piece_set: 'chessnut', theme: 'walnut' } });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-piece-set', 'chessnut');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'walnut');
  // Public pages (useForceDefaultTheme) keep the default look and pieces.
  await page.goto('/no-such-page-anywhere');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await expect(page.locator('html')).not.toHaveAttribute('data-piece-set', /.+/);
});

test('regular players see the Path in the sidebar', async ({ page }) => {
  await stubApp(page, { user: E2E_USER });
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Path' }).first()).toBeVisible();
});
