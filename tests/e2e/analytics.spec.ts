import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { stubApp } from './helpers/api';

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
      trained: true,
      games: 10,
      blunders: 4,
      lichessUsername: 'playerlich',
      chesscomUsername: 'playercc',
      trainingSessions: 7,
      lastSessionAt: '2026-05-31T09:00:00Z',
      lastActive: '2026-05-31T09:00:00Z',
    },
  ],
  landingFunnel: { views: 200, entered: 60, converted: 12 },
  viewsByDay: [
    { date: '2026-05-29', count: 90 },
    { date: '2026-05-30', count: 110 },
  ],
  leads: [
    {
      username: 'magnus',
      platform: 'lichess',
      attempts: 2,
      lastSeen: '2026-05-30T11:00:00Z',
      converted: true,
    },
    {
      username: 'hikaru',
      platform: 'chesscom',
      attempts: 1,
      lastSeen: '2026-05-29T08:00:00Z',
      converted: false,
    },
  ],
  trainingAnalytics: {
    avgDurationSeconds: 720,
    medianDurationSeconds: 540,
    sessionsWithDuration: 24,
    sessionsByDay: [
      { date: '2026-05-29', count: 2 },
      { date: '2026-05-30', count: 5 },
      { date: '2026-05-31', count: 3 },
    ],
    topTrainees: [
      { email: 'big@trainer.com', displayName: 'Big Trainer', sessions: 17 },
      { email: 'medium@trainer.com', displayName: null, sessions: 12 },
      { email: 'small@trainer.com', displayName: null, sessions: 4 },
    ],
  },
};

// admin.outreachLeads payload for the win-back panel's default `demo_only` tab.
const OUTREACH = {
  segment: 'demo_only',
  counts: { demo_only: 1 },
  rows: [
    {
      leadKey: 'lichess:magnus',
      platform: 'lichess',
      username: 'magnus',
      email: null,
      since: '2026-05-29T08:00:00Z',
      lastSeen: '2026-05-30T11:00:00Z',
      attempts: 2,
      blunders: null,
      contactedAt: null,
      note: null,
      signedUp: false,
      trainedSinceContact: false,
    },
  ],
};

const EMAIL_STATS = {
  optedIn: 12,
  reachable: 10,
  noAddress: 70,
  prompted: 40,
  confirmPending: 2,
  unsubscribed30d: 1,
  returnRate: { reachable: { accounts: 10, trained: 4 }, other: { accounts: 160, trained: 8 } },
  kinds: [{ kind: 'daily_plan', sent: 20, returned: 5 }],
};

// Signs in as `email` (the admin gate is ADMIN_EMAILS vs the session email)
// and answers the admin.* RPCs; a positive game count keeps the onboarding
// gate hidden.
async function stub(
  page: Page,
  email: string,
  opts: {
    gameCount?: number;
    kpis?: unknown;
    userList?: unknown;
    retention?: unknown;
    outreach?: unknown;
    socialQueue?: unknown;
  } = {},
) {
  const { gameCount = 3, kpis = null, userList = null, retention = null, outreach = null, socialQueue = null } = opts;
  return stubApp(page, {
    user: { id: '00000000-0000-0000-0000-000000000001', email, name: 'Tester', emailVerified: true },
    gameCount,
    rpc: {
      'admin.kpis': () => kpis,
      'admin.retention': () => retention,
      'admin.emailStats': () => EMAIL_STATS,
      'admin.outreachLeads': () => outreach,
      'admin.userList': () => userList ?? [],
      'admin.socialQueue': () => socialQueue,
      'admin.socialSetStatus': () => null,
    },
  });
}

const SOCIAL_POST = {
  blunder_id: 'b1',
  hook_template: 'blundered-at',
  motif: 'missedMate',
  caption: 'I blundered this at 2056 blitz. Can you find what I missed?',
  tiktok_caption: 'I blundered this at 2056 blitz. patternchess.com #chesstok',
  puzzle: {
    fen: '5rrk/pp3p1p/4bPpQ/n2p4/3P2P1/4BR2/P1r2RKP/3q4 w - - 0 30',
    side: 'white',
    rating: 2056,
    timeControl: 'blitz',
    played: 'Rxc2',
    solution: ['Qxh7+', 'Kxh7', 'Rh3#'],
    motifLabel: 'Missed mate',
    hook: 'blundered-at',
  },
  // Same-origin so the test never reaches the network (production media is on social.patternchess.com).
  media_url: '/video/none.mp4',
  poster_url: null,
  permalink: null,
  ig_error: null,
  tiktok_status: null,
  tiktok_error: null,
  plays: null,
  reach: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  insights_at: null,
  posted_at: null,
  format: 'blunder',
  fell_count: null,
  script: null,
  script_source: null,
  voice: null,
  buffer_ig_post_id: null,
  buffer_tiktok_post_id: null,
  buffer_error: null,
};

const FALL_POST = {
  ...SOCIAL_POST,
  blunder_id: 'trap:rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq -|g7g6',
  format: 'fall',
  fell_count: 11,
  puzzle: {
    format: 'fall',
    fen: 'rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2',
    side: 'black',
    rating: null,
    timeControl: null,
    played: 'g6',
    refutation: ['Qxe5+', 'Qe7', 'Qxh8'],
    solution: ['Nc6'],
    motifLabel: null,
    fellCount: 11,
    headline: '11 players fell for this',
    hook: 'would-you-fall',
  },
  script: {
    hookStyle: 'would-you-fall',
    headline: '11 players fell for this',
    subline: 'Black to move. Find it.',
    beats: {
      hook: '11 PatternChess players fell for this. Would you?',
      challenge: 'Pause now. Find the move for Black.',
      played: 'Most people play g6. It loses the rook.',
      refutation: 'Queen takes e5, check. Queen e7. Then queen takes h8.',
      reveal: 'The answer is knight c6.',
      cta: 'PatternChess finds the traps you fall for.',
    },
    captionLead: '11 PatternChess players fell for this. Would you?',
  },
  script_source: 'claude',
  voice: 'am_michael',
};

const SOCIAL_QUEUE = {
  today: '2026-11-22',
  upcoming: [
    { ...SOCIAL_POST, id: 'q1', scheduled_for: '2026-11-23', status: 'queued' },
    { ...SOCIAL_POST, id: 'v1', scheduled_for: '2026-11-24', status: 'vetoed' },
    { ...FALL_POST, id: 'f1', scheduled_for: '2026-11-25', status: 'queued' },
  ],
  recent: [
    {
      ...SOCIAL_POST,
      id: 'p1',
      scheduled_for: '2026-11-21',
      status: 'posted',
      permalink: 'https://www.instagram.com/reel/abc/',
      tiktok_status: 'SEND_TO_USER_INBOX',
      plays: 1234,
      saves: 12,
    },
    {
      ...SOCIAL_POST,
      id: 'p2',
      scheduled_for: '2026-11-20',
      status: 'posted',
      buffer_ig_post_id: 'buf-ig-1',
      buffer_tiktok_post_id: 'buf-tt-1',
      tiktok_status: 'sent',
      buffer_error: null,
    },
  ],
};

const RETENTION = {
  cohorts: [
    {
      cohort: 'all',
      signups: 92,
      trained: 72,
      trained2Days: 32,
      trained5Days: 11,
      curve: [
        { day: 1, eligible: 89, retained: 35 },
        { day: 7, eligible: 60, retained: 20 },
        { day: 14, eligible: 45, retained: 12 },
        { day: 30, eligible: 30, retained: 7 },
        { day: 60, eligible: 23, retained: 4 },
      ],
    },
    {
      cohort: '2026-10',
      signups: 45,
      trained: 35,
      trained2Days: 14,
      trained5Days: 1,
      curve: [
        { day: 1, eligible: 42, retained: 16 },
        { day: 7, eligible: 13, retained: 3 },
        { day: 14, eligible: 0, retained: 0 },
        { day: 30, eligible: 0, retained: 0 },
        { day: 60, eligible: 0, retained: 0 },
      ],
    },
    {
      cohort: '2026-09',
      signups: 22,
      trained: 18,
      trained2Days: 8,
      trained5Days: 5,
      curve: [
        { day: 1, eligible: 22, retained: 8 },
        { day: 7, eligible: 22, retained: 6 },
        { day: 14, eligible: 20, retained: 4 },
        { day: 30, eligible: 5, retained: 1 },
        { day: 60, eligible: 0, retained: 0 },
      ],
    },
  ],
  weeks: [
    { week: '2026-09-28', active: 17, returning: 5 },
    { week: '2026-10-05', active: 31, returning: 7 },
  ],
};

test('admin sees signup-cohort retention at /analytics', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await stub(page, ADMIN_EMAIL, { kpis: KPIS, retention: RETENTION });
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 20_000 });

  const card = page.locator('section', { has: page.getByText('Retention', { exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('D30 retention')).toBeVisible();
  // 7 of 30 → 23%, over the 20% bar with n ≥ 20.
  await expect(card.getByText('target ≥ 20% · n = 30')).toBeVisible();
  await expect(card.getByRole('cell', { name: /^All users$/ })).toBeVisible();
  await expect(card.getByTitle('7 of 30 users')).toContainText('23%');
  await expect(card.getByText('7 + 24 new')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('admin sees the KPI dashboard at /analytics', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await stub(page, ADMIN_EMAIL, { kpis: KPIS, outreach: OUTREACH });
  await page.goto('/analytics');

  await expect(page).toHaveURL(/\/analytics$/);
  // Wait for the admin-gated content (not the auth "Loading…" placeholder).
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Find-your-blunders funnel', { exact: true })).toBeVisible();
  await expect(page.getByText('player@example.com')).toBeVisible();
  await expect(page.getByRole('link', { name: /analytics/i })).toBeVisible();
  // landing funnel (from the landing_funnel migration)
  await expect(page.getByText('Landing funnel', { exact: true })).toBeVisible();
  await expect(page.getByText('Entered a username', { exact: true })).toBeVisible();
  // win-back queue (replaced the leads card in the lead_outreach migration)
  await expect(page.getByText('Win-back', { exact: true })).toBeVisible();
  await expect(page.getByText('magnus', { exact: true })).toBeVisible();
  // training engagement card (from the admin_drilldown migration)
  await expect(page.getByText('Training engagement', { exact: true })).toBeVisible();
  await expect(page.getByText('Avg session')).toBeVisible();
  await expect(page.getByText('Median session')).toBeVisible();
  await expect(page.getByText('big@trainer.com')).toBeVisible();

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('clicking a KPI tile opens a drill-down with hyperlinked handles', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const userList = [
    {
      email: 'trained@example.com',
      displayName: null,
      createdAt: '2026-05-29T12:00:00Z',
      lichessUsername: 'magnusc',
      chesscomUsername: 'hikarunakamura',
      connected: true,
      synced: true,
      foundBlunders: true,
      trained: true,
      games: 25,
      blunders: 11,
      trainingSessions: 12,
      lastSessionAt: '2026-05-31T08:00:00Z',
      lastActive: '2026-05-31T08:00:00Z',
    },
  ];

  await stub(page, ADMIN_EMAIL, { kpis: KPIS, userList, outreach: OUTREACH });
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 20_000 });

  // Click the "Trained" KPI tile.
  await page.getByRole('button', { name: /Trained\s+3/ }).first().click();

  // Modal opens with the right title.
  const modal = page.getByRole('dialog', { name: 'Trained' });
  await expect(modal).toBeVisible();
  await expect(modal.getByText('trained@example.com')).toBeVisible();
  await expect(modal.getByText('12 sessions')).toBeVisible();

  // Handles are real hyperlinks opening in a new tab.
  const lichessLink = modal.getByRole('link', { name: 'lichess.org/@/magnusc' });
  await expect(lichessLink).toHaveAttribute('href', 'https://lichess.org/@/magnusc');
  await expect(lichessLink).toHaveAttribute('target', '_blank');
  await expect(lichessLink).toHaveAttribute('rel', /noopener/);

  const ccLink = modal.getByRole('link', { name: 'chess.com/member/hikarunakamura' });
  await expect(ccLink).toHaveAttribute('href', 'https://www.chess.com/member/hikarunakamura');

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  // Recent signups shows training-session count + linked handles.
  await expect(page.getByText('7 sessions · 10 games · 4 blunders')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'lichess.org/@/playerlich' }),
  ).toHaveAttribute('href', 'https://lichess.org/@/playerlich');

  // Win-back lead handle is a link.
  await expect(
    page.getByRole('link', { name: 'lichess.org/@/magnus' }),
  ).toHaveAttribute('href', 'https://lichess.org/@/magnus');

  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('admin sees email reach and return rates at /analytics', async ({ page }) => {
  await stub(page, ADMIN_EMAIL, { kpis: KPIS, retention: RETENTION });
  await page.goto('/analytics');
  const card = page.getByTestId('email-stats-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('10 reachable');
  await expect(card).toContainText('70 with no address');
  await expect(card).toContainText('reachable 40% (4/10) vs everyone else 5% (8/160)');
  await expect(card.getByRole('cell', { name: 'Daily plan' })).toBeVisible();
});

test('admin reviews the daily puzzle-video queue: veto and restore', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const rpc = await stub(page, ADMIN_EMAIL, { kpis: KPIS, retention: RETENTION, socialQueue: SOCIAL_QUEUE });
  await page.goto('/analytics');
  const card = page.getByTestId('social-queue-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  const posts = card.getByTestId('social-post');
  await expect(posts).toHaveCount(5);
  await expect(posts.nth(0)).toContainText('Queued');
  await expect(posts.nth(0)).toContainText('answer Qxh7+ Kxh7 Rh3#');
  await expect(posts.nth(1)).toContainText('Vetoed: will not post');
  // The fall format: counts, the punishment and the folded voiceover script.
  await expect(posts.nth(2).getByTestId('social-post-puzzle')).toContainText('11 players played g6');
  await expect(posts.nth(2).getByTestId('social-post-puzzle')).toContainText('Qxe5+ Qe7 Qxh8');
  const script = posts.nth(2).getByTestId('social-post-script');
  await expect(script).toContainText('written by Claude, voice am_michael');
  await script.locator('summary').click();
  await expect(script).toContainText('Queen takes e5, check.');
  await expect(posts.nth(3)).toContainText('1,234 views');
  await expect(posts.nth(3)).toContainText('TikTok draft is in your inbox');
  await expect(posts.nth(3).getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/reel/abc/');
  await expect(posts.nth(4).getByTestId('social-post-buffer')).toContainText('Instagram scheduled · TikTok sent');
  await posts.nth(0).getByRole('button', { name: 'Veto' }).click();
  await rpc.waitFor('admin.socialSetStatus', (a) => a.id === 'q1' && a.status === 'vetoed');
  await posts.nth(1).getByRole('button', { name: 'Restore' }).click();
  await rpc.waitFor('admin.socialSetStatus', (a) => a.id === 'v1' && a.status === 'queued');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('non-admin is redirected away from /analytics', async ({ page }) => {
  await stub(page, 'tester@example.com', { gameCount: 3 });
  await page.goto('/analytics');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: /analytics/i })).toHaveCount(0);
});
