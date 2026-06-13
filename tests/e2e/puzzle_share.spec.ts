import { expect, test } from '@playwright/test';

// The public shared-puzzle page (/p?d=...) — no auth stub on purpose: the
// whole point is that logged-out visitors can open and solve a shared link.

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PUZZLE = {
  v: 1,
  fen: STARTPOS,
  pm: 'f2f3',
  cm: [{ m: 'e2e4', e: 30 }],
  eb: 20,
  ea: 50,
  stm: 'white',
  lbl: 'Alice vs Bob',
  op: 'King’s Pawn Game · C20',
};

// Mirrors encodeSharedPuzzle (base64url JSON, no padding).
const ENCODED = Buffer.from(JSON.stringify(PUZZLE)).toString('base64url');

test('a shared puzzle link renders a solvable board without auth', async ({ page }) => {
  await page.goto(`/p?d=${ENCODED}`);

  // No redirect to /login — this is a public route.
  await expect(page).toHaveURL(/\/p\?d=/);
  await expect(page.locator('cg-board')).toBeVisible();
  await expect(page.getByText('White to play')).toBeVisible();
  await expect(page.getByText('Alice vs Bob')).toBeVisible();
});

test('an anonymous link (no lbl) shows the generic label, not player names', async ({ page }) => {
  const { lbl: _lbl, ...anon } = PUZZLE;
  const encoded = Buffer.from(JSON.stringify(anon)).toString('base64url');
  await page.goto(`/p?d=${encoded}`);

  await expect(page.locator('cg-board')).toBeVisible();
  await expect(page.getByText('Shared puzzle')).toBeVisible();
  await expect(page.getByText('Alice vs Bob')).toHaveCount(0);
});

test('reveal buttons show the best move and the played move', async ({ page }) => {
  await page.goto(`/p?d=${ENCODED}`);

  await page.getByRole('button', { name: /Reveal best move/i }).click();
  await expect(page.getByText(/Best move: e4/)).toBeVisible();

  await page.getByRole('button', { name: /Show what they played/i }).click();
  await expect(page.getByText(/Played in the game: f3/)).toBeVisible();

  // Arrow color language: green = best move, red = the blunder. No blue.
  const readBrushes = () =>
    page.evaluate(() => {
      const svg = document.querySelector('.cg-shapes');
      const hashes = Array.from(svg?.querySelectorAll('[cgHash]') ?? []).map(
        (el) => el.getAttribute('cgHash') ?? '',
      );
      return hashes.join('|');
    });
  await expect.poll(readBrushes).toContain('red');
  const brushes = await readBrushes();
  expect(brushes).toContain('green');
  expect(brushes).not.toContain('blue');
});

test('solving with the stored best move succeeds without the engine', async ({ page }) => {
  await page.goto(`/p?d=${ENCODED}`);

  const board = page.locator('cg-board');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width } = box!;
  const sq = width / 8;
  // White on bottom: e2 = file 4, rank index 6 from top; e4 = rank index 4.
  await page.mouse.move(x + sq * 4 + sq / 2, y + sq * 6 + sq / 2);
  await page.mouse.down();
  await page.mouse.move(x + sq * 4 + sq / 2, y + sq * 4 + sq / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText('Solution correct')).toBeVisible();
  await expect(page.getByText('Win chance')).toBeVisible();
});

test('a garbage payload shows the invalid-link card with a signup CTA', async ({ page }) => {
  await page.goto('/p?d=garbage-not-base64-json');
  await expect(page.getByText('This puzzle link is invalid')).toBeVisible();
  const cta = page.getByRole('link', { name: /Train your own blunders/i });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/login');
});
