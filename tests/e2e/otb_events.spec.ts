import { expect, test, type Page } from '@playwright/test';
import { stubApp, type RpcHandlers } from './helpers/api';

// Upcoming OTB events card on the dashboard + Tournaments sidebar link.
// The events API (events.patternchess.com) is stubbed via page.route so the
// suite never leaves localhost.

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
  events_state: 'MA',
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
  {
    // A season-long aggregator listing: never a "next meeting day".
    id: 13,
    title: 'Scholastic Season Listing',
    club_name: 'US Chess TLA — Massachusetts',
    club_city: null,
    start_date: isoDaysFromNow(-100),
    end_date: isoDaysFromNow(200),
    start_time: null,
    sections: null,
    entry_fee: null,
    time_control: null,
    registration_url: null,
  },
];

/** Stubs the events API (recording each requested state) and the app. */
async function stubAuthAndEvents(
  page: Page,
  events: unknown[] | 'error' = API_EVENTS,
  opts: { profile?: Record<string, unknown>; rpc?: RpcHandlers; byState?: Record<string, unknown[]> } = {},
) {
  const requestedStates: string[] = [];
  await page.route('**/events.patternchess.com/api/events*', (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? '';
    requestedStates.push(state);
    if (events === 'error') return route.fulfill({ status: 500, body: '{}' });
    const rows = opts.byState?.[state] ?? events;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: rows, meta: { count: rows.length } }),
    });
  });
  const rec = await stubApp(page, {
    profile: { ...PROFILE, ...(opts.profile ?? {}) },
    blunders: BLUNDERS,
    gameCount: 1,
    rpc: opts.rpc,
  });
  return { rec, requestedStates };
}

test('dashboard shows the three nearest OTB events in the saved state', async ({ page }) => {
  const { requestedStates } = await stubAuthAndEvents(page);
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
  await expect(page.getByText('Scholastic Season Listing')).toHaveCount(0);

  const link = page.getByRole('link', { name: /MCC - Monthly Swiss/ });
  await expect(link).toHaveAttribute('href', 'https://events.patternchess.com/events/41');
  await expect(link).toHaveAttribute('target', '_blank');

  await expect(page.getByRole('link', { name: /All Massachusetts tournaments/i })).toHaveAttribute(
    'href',
    'https://events.patternchess.com/ma',
  );
  // The saved state drives the API call; no guess, so no "Save" prompt.
  expect(requestedStates).toContain('MA');
  await expect(page.getByTestId('events-state')).toHaveValue('MA');
  await expect(page.getByTestId('events-state-guess')).toHaveCount(0);
});

test('picking a state saves it and lists that state', async ({ page }) => {
  const NJ_EVENT = { ...API_EVENTS[1], id: 77, title: 'Jersey Shore Rapid', club_name: 'Shore Chess Club', club_city: 'Asbury Park' };
  const { rec, requestedStates } = await stubAuthAndEvents(page, API_EVENTS, { byState: { NJ: [NJ_EVENT] } });
  await page.goto('/dashboard');
  await expect(page.getByText('Boylston Saturday Open')).toBeVisible();

  await page.getByTestId('events-state').selectOption('NJ');
  await rec.waitFor('profile.update', (a) => a.patch?.events_state === 'NJ');
  await expect(page.getByText('Jersey Shore Rapid')).toBeVisible();
  await expect(page.getByText('Boylston Saturday Open')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /All New Jersey tournaments/i })).toHaveAttribute(
    'href',
    'https://events.patternchess.com/nj',
  );
  expect(requestedStates).toContain('NJ');
});

test('with no saved state the card guesses from location and offers to save it', async ({ page }) => {
  const { rec, requestedStates } = await stubAuthAndEvents(page, API_EVENTS, {
    profile: { events_state: null },
    rpc: { 'events.locate': () => ({ country: 'US', region: 'RI' }) },
  });
  await page.goto('/dashboard');
  await expect(page.getByTestId('events-state')).toHaveValue('RI');
  await expect(page.getByTestId('events-state-guess')).toContainText('Showing Rhode Island');
  expect(requestedStates).toContain('RI');
  // Nothing is saved until the player says so.
  expect(rec.callsTo('profile.update').filter((c) => 'events_state' in (c.args.patch ?? {}))).toHaveLength(0);

  await page.getByRole('button', { name: 'Save Rhode Island' }).click();
  await rec.waitFor('profile.update', (a) => a.patch?.events_state === 'RI');
  await expect(page.getByTestId('events-state-guess')).toHaveCount(0);
});

test.describe('outside the US', () => {
  test.use({ timezoneId: 'Europe/London' });
  test('no saved state and no US location: no events card', async ({ page }) => {
    const { requestedStates } = await stubAuthAndEvents(page, API_EVENTS, {
      profile: { events_state: null },
      rpc: { 'events.locate': () => ({ country: 'GB', region: null }) },
    });
    await page.goto('/dashboard');
    await expect(page.getByText("Today's plan")).toBeVisible();
    await expect(page.getByText('Upcoming OTB events')).toHaveCount(0);
    expect(requestedStates).toHaveLength(0);
  });
});

test.describe('in Arizona', () => {
  test.use({ timezoneId: 'America/Phoenix' });
  test('falls back to the timezone when the location lookup has no US state', async ({ page }) => {
    const { requestedStates } = await stubAuthAndEvents(page, API_EVENTS, {
      profile: { events_state: null },
      rpc: { 'events.locate': () => ({ country: null, region: null }) },
    });
    await page.goto('/dashboard');
    await expect(page.getByTestId('events-state')).toHaveValue('AZ');
    expect(requestedStates).toContain('AZ');
  });
});

test('a state with nothing listed keeps the card and its picker', async ({ page }) => {
  await stubAuthAndEvents(page, [], { profile: { events_state: 'WY' } });
  await page.goto('/dashboard');
  await expect(page.getByText('No tournaments listed in Wyoming right now.')).toBeVisible();
  await expect(page.getByTestId('events-state')).toHaveValue('WY');
});

test('events card disappears quietly when the API is down', async ({ page }) => {
  await stubAuthAndEvents(page, 'error');
  await page.goto('/dashboard');
  await expect(page.getByText("Today's plan")).toBeVisible();
  await expect(page.getByText('Upcoming OTB events')).toHaveCount(0);
});

test('sidebar no longer links Tournaments or Learn, and shows Leaderboards', async ({ page }) => {
  await stubAuthAndEvents(page);
  await page.goto('/dashboard');
  const nav = page.locator('nav').first();
  await expect(nav.getByRole('link', { name: /Leaderboards/i })).toHaveAttribute('href', '/leaderboards');
  await expect(nav.getByRole('link', { name: /Tournaments/i })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Learn$/i })).toHaveCount(0);
});
