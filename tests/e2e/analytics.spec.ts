import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PROJECT = 'ydfwppthwnlgxnntzrvg';
const ADMIN_EMAIL = 'elliotmharris@gmail.com';

const KPIS = {
  totals: { signups: 12, connected: 9, synced: 7, foundBlunders: 5, trained: 3 },
  activity: { dau: 2, wau: 5, mau: 8 },
  signupsByDay: [
    { date: '2026-05-20', count: 3 },
    { date: '2026-05-21', count: 1 },
    { date: '2026-05-25', count: 5 },
    { date: '2026-05-30', count: 3 },
  ],
  platforms: [
    { platform: 'lichess', users: 6, games: 120 },
    { platform: 'chess.com', users: 4, games: 80 },
  ],
  recentSignups: [
    {
      email: 'player@example.com',
      displayName: 'Player One',
      createdAt: '2026-05-30T10:00:00Z',
      connected: true,
      synced: true,
      foundBlunders: true,
      trained: false,
      games: 10,
      blunders: 4,
    },
  ],
};

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// supabase-js decodes the access_token JWT to populate session.user, so the
// stub needs a real (unsigned) JWT carrying the email claim — an opaque token
// leaves session.user.email undefined and the admin gate can't see it.
function makeSession(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const uid = '00000000-0000-0000-0000-000000000001';
  const meta = { user_metadata: { full_name: 'Tester' }, app_metadata: { provider: 'google' } };
  const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: uid,
    email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    ...meta,
  })}.sig`;
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'fake-refresh',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, ...meta },
  };
}

// Inline auth stub (the repo has no shared helper). Signs the session into
// localStorage and shorts out outbound supabase calls — including a positive
// HEAD game count so the onboarding gate stays hidden, and the admin_kpis RPC.
async function stub(
  page: Page,
  email: string,
  opts: { gameCount?: number; kpis?: unknown } = {},
): Promise<void> {
  const session = makeSession(email);
  const { gameCount = 3, kpis = null } = opts;
  await page.addInitScript(
    ({ session, project, gameCount, kpis }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (
            init?.method ??
            (typeof input === 'object' ? input?.method : undefined) ??
            'GET'
          ).toUpperCase();
          if (url.includes('/auth/v1/user')) {
            return Promise.resolve(
              new Response(JSON.stringify(session.user), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          if (url.includes('/rest/v1/rpc/admin_kpis')) {
            return Promise.resolve(
              new Response(JSON.stringify(kpis), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': `*/${gameCount}` } }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session, project: PROJECT, gameCount, kpis },
  );
}

test('admin sees the KPI dashboard at /analytics', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await stub(page, ADMIN_EMAIL, { kpis: KPIS });
  await page.goto('/analytics');

  await expect(page).toHaveURL(/\/analytics$/);
  // Wait for the admin-gated content (not the auth "Loading…" placeholder).
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Find-your-blunders funnel', { exact: true })).toBeVisible();
  await expect(page.getByText('player@example.com')).toBeVisible();
  await expect(page.getByRole('link', { name: /analytics/i })).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('non-admin is redirected away from /analytics', async ({ page }) => {
  await stub(page, 'tester@example.com', { gameCount: 3 });
  await page.goto('/analytics');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: /analytics/i })).toHaveCount(0);
});
