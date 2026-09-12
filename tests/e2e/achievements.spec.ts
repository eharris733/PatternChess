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

function makeProfile(usedTrainingFilter: boolean) {
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
  },
) {
  await page.addInitScript(
    ({ session, project, profile, blunders, scenarios, game }) => {
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
      profile: makeProfile(opts.usedTrainingFilter),
      blunders: opts.blunders,
      scenarios: opts.scenarios,
      game: GAME,
    },
  );
}

test('the Discovery category lists endgame and focused-training milestones', async ({ page }) => {
  await stubAuth(page, { usedTrainingFilter: false, blunders: [], scenarios: [] });
  await page.goto('/achievements');

  await expect(page.getByRole('heading', { name: 'Discovery' })).toBeVisible();
  await expect(page.getByText('First Rescue')).toBeVisible();
  await expect(page.getByText('Endgame Medic')).toBeVisible();
  await expect(page.getByText('Point Guard')).toBeVisible();
  await expect(page.getByText('Focused Training')).toBeVisible();
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
