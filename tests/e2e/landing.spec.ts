import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('renders public landing at / with brand, auth CTAs, hero, demo input, how-it-works, footer', async ({
    page,
  }) => {
    await page.goto('/');

    // Brand lockup in the top bar (PatternChess aria-label exists on BrandMark + outer wrappers — match by role=img).
    await expect(page.getByRole('img', { name: /PatternChess/i }).first()).toBeVisible();

    // Auth CTAs both link to /login.
    const loginLink = page.getByRole('link', { name: /^Log in$/i });
    const signupLink = page.getByRole('link', { name: /^Sign up$/i });
    await expect(loginLink).toBeVisible();
    await expect(signupLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
    await expect(signupLink).toHaveAttribute('href', '/login');

    // Hero headline mentions "blunder".
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/blunder/i);

    // Username input + platform toggle.
    await expect(page.getByPlaceholder(/ENTER USERNAME/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lichess$/i, exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Chess\.com$/i, exact: false })).toBeVisible();

    // Submit button.
    await expect(page.getByRole('button', { name: /Analyze Blunders/i })).toBeVisible();

    // "How it works" section heading.
    await expect(page.getByRole('heading', { name: /How it works/i })).toBeVisible();

    // Footer placeholder links.
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: /^Privacy$/i })).toBeVisible();
    await expect(footer.getByRole('link', { name: /^Terms$/i })).toBeVisible();

    // About-the-creator section is present.
    await expect(page.getByRole('heading', { name: /Who built this/i })).toBeVisible();
  });

  test('clicking Log in navigates to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^Log in$/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('toggling platform pill updates aria-pressed', async ({ page }) => {
    await page.goto('/');
    const lichess = page.getByRole('button', { name: /^Lichess$/i });
    const chesscom = page.getByRole('button', { name: /^Chess\.com$/i });
    await expect(lichess).toHaveAttribute('aria-pressed', 'true');
    await chesscom.click();
    await expect(chesscom).toHaveAttribute('aria-pressed', 'true');
    await expect(lichess).toHaveAttribute('aria-pressed', 'false');
  });
});
