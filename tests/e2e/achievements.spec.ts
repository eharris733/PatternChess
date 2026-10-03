import { expect, test, type Page } from '@playwright/test';

// New "Discovery" achievements: endgame rescues (/endgames) and using a
// training-picker focus (opening/motif/phase/situation) at least once.

const SUPABASE_PROJECT = 'ydfwppthwnlgxnntzrvg';

const FAKE_SESSION = {
  access_token: 'fake',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'fake-refresh',
  user: {
    id: 'e2e-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e@example.com',
    user_metadata: { full_name: 'E2E User', avatar_url: null },
    app_metadata: {},
    created_at: new Date().toISOString(),
  },
};

function makeProfile(usedTrainingFilter: boolean, extra: Record<string, unknown> = {}) {
  return {
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
    autoplay_refutation: true,
    used_training_filter: usedTrainingFilter,
    sounds_enabled: true,
    leaderboard_opt_out: false,
    followed_instagram: false,
    shares_count: 0,
    opening_reviews_opened: 0,
    learn_chapters_done: [],
    flair: null,
    ...extra,
  };
}

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KQK_WIN = '7k/8/5K2/6Q1/8/8/8/8 w - - 0 60';

function makeTacticBlunder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    game_id: 'g1',
    fen: STARTPOS,
    move_number: 1,
    played_move: 'f2f3',
    correct_moves: [{ move: 'd2d4', eval: 30 }],
    eval_before: 20,
    eval_after: 150,
    eval_swing: 17,
    side_to_move: 'white',
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: PAST,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: PAST,
    phase: 'opening',
    ...overrides,
  };
}

function makeScenario(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    user_id: 'e2e-user',
    game_id: 'g1',
    blunder_id: 'b1',
    start_fen: KQK_WIN,
    user_color: 'white',
    deserved_result: 'win',
    actual_result: 'loss',
    status: 'passed',
    attempts: 1,
    last_played_at: PAST,
    created_at: PAST,
    ...overrides,
  };
}

const GAME = {
  id: 'g1',
  platform: 'lichess',
  username: 'tester',
  opponent: 'rival',
  pgn: '',
  time_control: '600',
  rated: false,
  result: null,
  played_at: PAST,
  created_at: PAST,
  analyzed_at: PAST,
  eco: null,
  opening_name: null,
  user_color: 'white',
  user_rating: null,
  opponent_rating: null,
  clock_per_ply: null,
  total_plies: 2,
  parsed_metadata_at: null,
};

async function stubAuth(
  page: Page,
  opts: {
    usedTrainingFilter: boolean;
    blunders: Record<string, unknown>[];
    scenarios: Record<string, unknown>[];
    profile?: Record<string, unknown>;
    rpc?: Record<string, unknown>;
  },
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, scenarios, game, rpc }) => {
      // addInitScript re-runs on every navigation (page.goto does a real
      // reload), so a PATCH's effect has to survive in localStorage — an
      // in-memory variable here would reset on the next goto().
      const profileKey = `e2e-profile-${project}`;
      const loadProfile = (): Record<string, unknown> => {
        try {
          const raw = localStorage.getItem(profileKey);
          if (raw) return JSON.parse(raw);
        } catch {
          /* fall through to the seed profile */
        }
        return { ...(profile as Record<string, unknown>) };
      };
      let currentProfile = loadProfile();
      const saveProfile = () => localStorage.setItem(profileKey, JSON.stringify(currentProfile));

      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (
            init?.method ??
            (typeof input === 'object' ? input?.method : undefined) ??
            'GET'
          ).toUpperCase();
          const json = (body: unknown) =>
            Promise.resolve(
              new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          if (url.includes('/auth/v1/user')) return json(session.user);
          if (method === 'HEAD') {
            return Promise.resolve(
              new Response(null, { status: 200, headers: { 'content-range': '*/3' } }),
            );
          }
          if (url.includes('/rest/v1/rpc/')) {
            const name = url.split('/rpc/')[1].split('?')[0];
            return json((rpc as Record<string, unknown>)[name] ?? null);
          }
          if (url.includes('/rest/v1/profiles')) {
            if (method === 'PATCH' && init?.body) {
              const patch = JSON.parse(init.body as string);
              currentProfile = { ...currentProfile, ...patch };
              saveProfile();
            }
            return json(currentProfile);
          }
          if (url.includes('/rest/v1/endgame_scenarios')) return json(scenarios);
          if (url.includes('/rest/v1/blunders')) return json(blunders);
          if (url.includes('/rest/v1/games')) {
            return /[?&]id=eq\./.test(url) ? json(game) : json([game]);
          }
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    {
      session: FAKE_SESSION,
      project: SUPABASE_PROJECT,
      profile: makeProfile(opts.usedTrainingFilter, opts.profile),
      rpc: opts.rpc ?? {},
      blunders: opts.blunders,
      scenarios: opts.scenarios,
      game: GAME,
    },
  );
}

test('the Discovery category lists endgame and focused-training milestones', async ({ page }) => {
  await stubAuth(page, { usedTrainingFilter: false, blunders: [], scenarios: [] });
  await page.goto('/achievements');

  // Scoped: the flair picker on the same page reuses some titles.
  const section = page.getByTestId('achievements-section');
  await expect(section.getByRole('heading', { name: 'Discovery' })).toBeVisible();
  await expect(section.getByText('First Rescue')).toBeVisible();
  await expect(section.getByText('Endgame Medic')).toBeVisible();
  await expect(section.getByText('Point Guard')).toBeVisible();
  await expect(section.getByText('Focused Training')).toBeVisible();
  await expect(section.getByTestId('achievement-invite-1')).toBeVisible();
});

test('a rescued endgame scenario earns First Rescue', async ({ page }) => {
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [],
    scenarios: [makeScenario({ status: 'passed' })],
  });
  await page.goto('/achievements');

  await expect(page.getByTestId('achievement-endgame-rescue-1').getByText('Unlocked')).toBeVisible();
  // Still short of the 5-rescue tier.
  await expect(page.getByTestId('achievement-endgame-rescue-5').getByText('1/5')).toBeVisible();
});

test('picking a training filter earns Focused Training on the next visit', async ({ page }) => {
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [makeTacticBlunder()],
    scenarios: [],
  });
  await page.goto('/training');
  await page.getByRole('button', { name: 'Opening', exact: true }).click();
  await expect(page.getByText('White to play')).toBeVisible();

  await page.goto('/achievements');
  await expect(
    page.getByTestId('achievement-filtered-training-1').getByText('Unlocked'),
  ).toBeVisible();
});

test('the Openings category tracks reviews, opening drills and Learn chapters', async ({ page }) => {
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [makeTacticBlunder({ kind: 'opening', times_correct: 1, times_attempted: 1 })],
    scenarios: [],
    profile: { opening_reviews_opened: 1, learn_chapters_done: ['italian/ch1'] },
    rpc: { training_totals: { minutes: 125, activeDays: 4 } },
  });
  await page.goto('/achievements');

  await expect(page.getByTestId('achievements-section').getByRole('heading', { name: 'Openings' })).toBeVisible();
  await expect(page.getByTestId('achievement-opening-review-1').getByText('Unlocked')).toBeVisible();
  await expect(page.getByTestId('achievement-opening-drill-1').getByText('Unlocked')).toBeVisible();
  await expect(page.getByTestId('achievement-learn-chapter-1').getByText('Unlocked')).toBeVisible();
  await expect(page.getByTestId('achievement-opening-review-10').getByText('1/10')).toBeVisible();
  // Time put in comes from training_totals().
  await expect(page.getByTestId('achievement-time-10h').getByText('125/600')).toBeVisible();
  await expect(page.getByTestId('achievement-active-days-30').getByText('4/30')).toBeVisible();
});

test('an unlocked flair can be picked on the profile and shows on leaderboards', async ({ page }) => {
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [],
    scenarios: [],
    profile: { longest_streak_days: 7 },
    rpc: {
      training_totals: { minutes: 0, activeDays: 0 },
      leaderboard: {
        metric: 'solved',
        window: 'all',
        since: null,
        rows: [{ rank: 1, label: 'rival', value: 40, isMe: false, flair: 'grinder' }],
        me: null,
      },
    },
  });
  await page.goto('/profile');

  const picker = page.getByTestId('flair-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId('flair-option-grinder')).toBeDisabled();
  await picker.getByTestId('flair-option-regular').click();
  await expect(picker.getByTestId('flair-option-regular')).toHaveAttribute('aria-pressed', 'true');
  // Header badge after the PATCH round-trip.
  await expect(page.locator('header').getByTestId('flair-badge')).toHaveText(/Regular/);

  await page.goto('/leaderboards');
  await expect(page.getByTestId('flair-badge').filter({ hasText: 'Grinder' })).toBeVisible();
});

test('the profile links to /achievements; ?tab=leaderboards goes to /leaderboards', async ({ page }) => {
  await stubAuth(page, { usedTrainingFilter: false, blunders: [], scenarios: [] });
  await page.goto('/profile');
  await expect(page.getByTestId('achievements-section')).toHaveCount(0);
  await page.getByTestId('achievements-link').click();
  await expect(page).toHaveURL(/\/achievements$/);
  await expect(page.getByTestId('achievements-section')).toBeVisible();
  await page.goto('/achievements?tab=leaderboards');
  await expect(page).toHaveURL(/\/leaderboards$/);
});

test('an earned achievement can be shared as a branded image card', async ({ page }) => {
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [],
    scenarios: [makeScenario({ status: 'passed' })],
  });
  await page.goto('/achievements');
  await page.getByTestId('share-achievement-endgame-rescue-1').click();
  await expect(page.getByTestId('share-preview')).toBeVisible({ timeout: 10_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('share-download').click();
  expect((await download).suggestedFilename()).toBe('patternchess-endgame-rescue-1.png');
  // Unearned tiles have no share button.
  await expect(page.getByTestId('share-achievement-endgame-rescue-5')).toHaveCount(0);
});

test('the invite card copies a referral link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubAuth(page, {
    usedTrainingFilter: false,
    blunders: [],
    scenarios: [],
    profile: { referral_code: 'abcd2345', referrals_count: 2 },
    rpc: {
      leaderboard: { metric: 'solved', window: 'all', since: null, rows: [], me: { rank: 7, label: 'me', value: 3, isMe: true, flair: null } },
    },
  });
  await page.goto('/leaderboards');
  const card = page.getByTestId('invite-card');
  await expect(card).toContainText('2 friends have joined so far.');
  await card.getByTestId('invite-copy').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("I'm #7 on the PatternChess leaderboard");
  expect(copied).toContain('https://patternchess.com/?ref=abcd2345');
});
