import { expect, test, type Page } from '@playwright/test';

// Upcoming OTB events card on the dashboard + Tournaments sidebar link.
// The events API (events.patternchess.com) is stubbed via page.route so the
// suite never leaves localhost.

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

const PROFILE = {
  id: 'e2e-user',
  display_name: 'E2E User',
  avatar_url: null,
  lichess_username: 'tester', // linked account -> not first-run
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
};

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// One catalogued blunder so the dashboard treats the user as established
// (linked account + zero blunders renders the importing-games hero instead).
const BLUNDERS = [
  { id: 'b1', game_id: 'g1', fen: STARTPOS, move_number: 10, played_move: 'e2e4', correct_moves: [{ move: 'd2d4', eval: 20 }], eval_before: 10, eval_after: -200, eval_swing: 210, side_to_move: 'white', cycle_number: 1, last_drilled_at: PAST, next_drill_at: PAST, times_correct: 1, times_attempted: 1, last_drill_failed: false, created_at: PAST, phase: 'opening' },
];

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const API_EVENTS = [
  {
    id: 41,
    title: 'MCC - Monthly Swiss',
    club_name: 'MetroWest Chess Club',
    club_city: 'Framingham',
    start_date: isoDaysFromNow(3),
    end_date: isoDaysFromNow(24),
    start_time: '19:30',
    sections: '["Open","U1700"]',
    entry_fee: '$40',
    time_control: 'G/90; d5',
    registration_url: 'https://www.nachesshub.com/Registrations/Create/x',
  },
  {
    id: 7,
    title: 'Boylston Saturday Open',
    club_name: 'Boylston Chess Foundation',
    club_city: 'Boston',
    start_date: isoDaysFromNow(1),
    end_date: isoDaysFromNow(1),
    start_time: '10:00',
    sections: null,
    entry_fee: '$30',
    time_control: 'G/60; d5',
    registration_url: null,
  },
  {
    id: 9,
    title: 'Newburyport Quads',
    club_name: 'Newburyport Chess Club',
    club_city: 'Newburyport',
    start_date: isoDaysFromNow(10),
    end_date: isoDaysFromNow(10),
    start_time: null,
    sections: null,
    entry_fee: null,
    time_control: null,
    registration_url: null,
  },
  {
    id: 12,
    title: 'Fourth Event Beyond The Cut',
    club_name: 'Wachusett Chess Club',
    club_city: 'Fitchburg',
    start_date: isoDaysFromNow(30),
    end_date: isoDaysFromNow(30),
    start_time: null,
    sections: null,
    entry_fee: null,
    time_control: null,
    registration_url: null,
  },
];

async function stubAuthAndEvents(page: Page, events: unknown[] | 'error' = API_EVENTS) {
  await page.route('**/events.patternchess.com/api/events*', (route) => {
    if (events === 'error') return route.fulfill({ status: 500, body: '{}' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: events, meta: { count: (events as unknown[]).length } }),
    });
  });
  await page.addInitScript(
    ({ session, project, profile, blunders }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
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
              new Response(null, { status: 200, headers: { 'content-range': '*/1' } }),
            );
          }
          if (url.includes('/rest/v1/profiles')) return json(profile);
          if (url.includes('/rest/v1/blunders')) return json(blunders);
          return json([]);
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, profile: PROFILE, blunders: BLUNDERS },
  );
}

test('dashboard shows the three nearest OTB events with external links', async ({ page }) => {
  await stubAuthAndEvents(page);
  await page.goto('/dashboard');

  await expect(page.getByText('Upcoming OTB events')).toBeVisible();
  // Sorted by next meeting day: Boylston (t+1) before MCC (t+3) before Newburyport (t+10).
  await expect(page.getByText('Boylston Saturday Open')).toBeVisible();
  await expect(page.getByText('MCC - Monthly Swiss')).toBeVisible();
  await expect(page.getByText('Newburyport Quads')).toBeVisible();
  // MCC spans t+3..t+24 (weekly cadence): the card shows the next round's
  // single day, not the month-long range.
  await expect(page.getByText(/Rd 1 of 4/)).toBeVisible();
  // Only the 3 nearest render.
  await expect(page.getByText('Fourth Event Beyond The Cut')).toHaveCount(0);

  const link = page.getByRole('link', { name: /MCC - Monthly Swiss/ });
  await expect(link).toHaveAttribute('href', 'https://events.patternchess.com/events/41');
  await expect(link).toHaveAttribute('target', '_blank');

  await expect(page.getByRole('link', { name: /All Massachusetts tournaments/i })).toHaveAttribute(
    'href',
    'https://events.patternchess.com',
  );
});

test('events card disappears quietly when the API is down or empty', async ({ page }) => {
  await stubAuthAndEvents(page, 'error');
  await page.goto('/dashboard');
  await expect(page.getByText('Daily habit')).toBeVisible();
  await expect(page.getByText('Upcoming OTB events')).toHaveCount(0);
});

test('sidebar has an external Tournaments link', async ({ page }) => {
  await stubAuthAndEvents(page);
  await page.goto('/dashboard');
  const nav = page.getByRole('link', { name: /Tournaments/i });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveAttribute('href', 'https://events.patternchess.com');
  await expect(nav).toHaveAttribute('target', '_blank');
});
