import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { DEFAULT_PROFILE_ROW, stubApp, stubRpc, stubSession } from './helpers/api';

// Area A of the 2026-11-22 feedback round: platform logos, the signed-out
// "Your plan for today" demo, the required Lichess email step, and the
// rated-only default on the connect step.

const LICHESS_USER = { id: 'e2e-user', email: 'tester@lichess.invalid', name: 'tester', emailVerified: false };

test.describe('platform logos', () => {
  test('login, landing pills and the connect step show the Lichess and Chess.com marks', async ({ page }) => {
    await stubSession(page, null);
    await stubRpc(page);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Continue with Lichess/ }).getByTestId('logo-lichess')).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Lichess$/ }).getByTestId('logo-lichess')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Chess\.com$/ }).getByTestId('logo-chesscom')).toBeVisible();
  });

  test('a new Google account connects with logos beside each field, rated games only by default', async ({ page }) => {
    // A brand-new profile: no usernames, the server's new-account default (rated only).
    const { preferred_rated_only: _omit, ...row } = DEFAULT_PROFILE_ROW;
    await stubApp(page, { profile: { ...row, lichess_username: null, chesscom_username: null, preferred_rated_only: true }, gameCount: 0 });
    await page.goto('/dashboard');
    await expect(page.getByText('Lichess username')).toBeVisible();
    await expect(page.locator('label[for="onboarding-lichess"]').getByTestId('logo-lichess')).toBeVisible();
    await expect(page.locator('label[for="onboarding-chesscom"]').getByTestId('logo-chesscom')).toBeVisible();
    await expect(page.getByLabel('Rated games only')).toBeChecked();
  });
});

test('a new Lichess sign-in adds an email before the import screen', async ({ page }) => {
  const rec = await stubApp(page, {
    user: LICHESS_USER,
    profile: { ...DEFAULT_PROFILE_ROW, lichess_username: 'tester', contact_email: null, email_opt_in: false },
    gameCount: 0,
  });
  await page.goto('/dashboard');
  const step = page.getByTestId('onboarding-email');
  await expect(step.getByRole('heading', { name: 'Where should we send your daily plan?' })).toBeVisible();
  await expect(step).toContainText('Signed in with Lichess as tester');
  await expect(page.getByText(/importing your last 200 games/)).toHaveCount(0);

  await step.getByLabel('Email address').fill('newplayer@example.com');
  await step.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('contact-email-pending')).toContainText('newplayer@example.com');
  expect(rec.callsTo('profile.update').some((c) => (c.args.patch as Record<string, unknown>).contact_email === 'newplayer@example.com')).toBe(true);
  await step.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/importing your last 200 games/)).toBeVisible();
});

// --- landing demo -------------------------------------------------------------

// Black (e2eplayer) leaves theory with 2...a6 and later blunders with 4...h6??
// (5.Nxf7 forks queen and rook).
const DEMO_MOVES = ['e4', 'e5', 'Nf3', 'a6', 'Bc4', 'Nf6', 'Ng5', 'h6', 'Nxf7', 'Qe7', 'Nxh8'];
const DEMO_PGN = [
  '[Event "Rated blitz game"]',
  '[Site "https://lichess.org/abcdefgh"]',
  '[White "opponent"]',
  '[Black "e2eplayer"]',
  '[Result "1-0"]',
  '',
  '1. e4 e5 2. Nf3 a6 3. Bc4 Nf6 4. Ng5 h6 5. Nxf7 Qe7 6. Nxh8 1-0',
  '',
].join('\n');

/** A book that knows the first three plies and, at move 2 for Black, only 2...Nc6 / 2...Nf6. */
function demoBook(): Map<string, unknown> {
  const chess = new Chess();
  const epd = () => chess.fen().split(' ').slice(0, 4).join(' ');
  const pos = (moves: { uci: string; san: string; n: number }[]) => ({
    tier: 'otb',
    white: 4000,
    draws: 4000,
    black: 2000,
    cp: 20,
    depth: 40,
    moves: moves.map((m) => ({ uci: m.uci, san: m.san, white: m.n * 0.4, draws: m.n * 0.4, black: m.n * 0.2, titled: 0, cp: 20, sound: true })),
  });
  const book = new Map<string, unknown>();
  book.set(epd(), pos([{ uci: 'e2e4', san: 'e4', n: 9000 }]));
  chess.move('e4');
  book.set(epd(), pos([{ uci: 'e7e5', san: 'e5', n: 9000 }]));
  chess.move('e5');
  book.set(epd(), pos([{ uci: 'g1f3', san: 'Nf3', n: 9000 }]));
  chess.move('Nf3');
  book.set(epd(), pos([{ uci: 'b8c6', san: 'Nc6', n: 8000 }, { uci: 'g8f6', san: 'Nf6', n: 1000 }]));
  return book;
}

async function stubDemo(page: Page) {
  await stubSession(page, null);
  await stubRpc(page);
  await page.route('https://lichess.org/api/games/user/**', (route) =>
    route.fulfill({ body: DEMO_PGN, contentType: 'application/x-chess-pgn', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  const book = demoBook();
  await page.route('**/api/book', async (route) => {
    const { fens } = route.request().postDataJSON() as { fens: string[] };
    const positions: Record<string, unknown> = {};
    for (const fen of fens) {
      const key = fen.split(' ').slice(0, 4).join(' ');
      if (book.has(key)) positions[key] = book.get(key);
    }
    await route.fulfill({ json: { positions } });
  });
}

test('signed out, the demo shows a plan: blunders, a playable position, the opening exit and endgames', async ({ page }) => {
  test.setTimeout(120_000);
  expect(DEMO_MOVES.length).toBe(11);
  await stubDemo(page);
  await page.goto('/');
  await page.locator('#demo-username').fill('e2eplayer');
  await page.getByRole('button', { name: /^Get my plan/i }).click();

  const plan = page.getByTestId('demo-plan');
  await expect(plan).toBeVisible({ timeout: 90_000 });
  await expect(plan.getByRole('heading', { name: 'Your plan for today' })).toBeVisible();
  await expect(plan.getByTestId('demo-plan-train')).toContainText(/Train \d+ of your blunders?/);
  const openings = plan.getByTestId('demo-plan-openings');
  await expect(openings).toContainText('You played it in 1 of 1 game (100%).');
  await expect(openings).toContainText('You left theory at move 2 with 2...a6.');
  await expect(openings).toContainText('Players rated 2200+ (OTB) mostly play 2...Nc6 there.');
  await expect(plan.getByTestId('demo-plan-endgames')).toBeVisible();
  await expect(plan.getByTestId('demo-plan-play')).toContainText('Play a game');

  // The playable blunder sits under the plan.
  await expect(page.getByText(/Find the better move/i)).toBeVisible();

  const cta = page.getByTestId('demo-plan-cta');
  await expect(cta).toContainText('Blunders cost you more rating than any opening');
  await expect(cta.getByRole('link', { name: /^Get my plan/ })).toHaveAttribute('href', '/login');
});
