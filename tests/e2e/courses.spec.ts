import { expect, test, type Page, type Route } from '@playwright/test';

// /courses on the Cloudflare backend: the session (better-auth) and every
// RPC are stubbed with page.route, so no local D1 or Functions are needed.
// The dev server shows pending courses (import.meta.env.DEV), which is all of
// the catalog until creators agree.

const USER = {
  id: 'e2e-courses',
  name: 'E2E Courses',
  email: 'e2e-courses@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const today = new Date().toLocaleDateString('en-CA');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

const PROFILE = {
  id: USER.id,
  display_name: 'E2E Courses',
  lichess_username: 'tester',
  chesscom_username: null,
  created_at: new Date().toISOString(),
  timezone: null,
  board_theme: 'default',
  commitment_level: 'regular',
  daily_positions_goal: 10,
  daily_games_goal: 1,
  email_opt_in: true,
  app_opens: 1,
  course_focus: null,
};

const FORK_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

function blunderRow(id: string, motifs: string[]) {
  return {
    id,
    user_id: USER.id,
    game_id: 'g1',
    fen: FORK_FEN,
    move_number: 14,
    played_move: 'Nc3',
    correct_moves: [{ uci: 'd2d4', san: 'd4', eval_cp: 30 }],
    eval_before: 30,
    eval_after: -300,
    eval_swing: 330,
    side_to_move: 'white',
    cycle_number: 0,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    last_drilled_at: null,
    next_drill_at: new Date(Date.now() - 1000).toISOString(),
    created_at: new Date().toISOString(),
    phase: 'middlegame',
    kind: 'tactic',
    motifs,
    solution_line: null,
    drill_data: null,
  };
}

interface Stub {
  rpcs: { name: string; args: Record<string, unknown> }[];
  progress: { course_slug: string; day: number; local_date: string; completed_at: string }[];
  focus: string | null;
}

async function stub(page: Page, opts: { supporter?: boolean; progress?: Stub['progress']; focus?: string | null } = {}) {
  const state: Stub = { rpcs: [], progress: opts.progress ?? [], focus: opts.focus ?? null };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/auth/**', (route) => {
    if (route.request().url().includes('/get-session')) {
      return json(route, { session: { id: 's1', userId: USER.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, user: USER });
    }
    return json(route, {});
  });

  await page.route('**/api/rpc/*', (route) => {
    const name = decodeURIComponent(route.request().url().split('/api/rpc/')[1].split('?')[0]);
    const args = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    state.rpcs.push({ name, args });
    switch (name) {
      case 'profile.get':
      case 'profile.getOrCreate':
        return json(route, { data: { ...PROFILE, course_focus: state.focus } });
      case 'profile.bumpAppOpen':
        return json(route, { data: 1 });
      case 'supporters.mine':
        return json(route, {
          data: opts.supporter
            ? { status: 'active', current_period_end: null, cancel_at_period_end: false, first_supported_at: new Date().toISOString() }
            : null,
        });
      case 'courses.progress':
        return json(route, { data: { focus: state.focus, days: state.progress } });
      case 'courses.setFocus':
        state.focus = (args.slug as string | null) ?? null;
        return json(route, { data: { focus: state.focus } });
      case 'courses.completeDay': {
        state.progress.push({
          course_slug: args.slug as string,
          day: args.day as number,
          local_date: args.localDate as string,
          completed_at: new Date().toISOString(),
        });
        return json(route, { data: state.progress.filter((r) => r.course_slug === args.slug) });
      }
      case 'courses.dayContent':
        return opts.supporter
          ? json(route, { data: { youtubeId: 'FGx28GrVrY8', start: 659, end: 1128, takeaway: 'Supporter takeaway.' } })
          : json(route, { error: { code: 'supporters_only', message: 'This lesson is for supporters' } }, 403);
      case 'stats.motifCounts':
        return json(route, { data: { counts: { allowedFork: 12, missedFork: 2, defensiveMistake: 6 }, tagged: 20, untagged: 0, total: 20 } });
      case 'blunders.allLive':
        return json(route, { data: [blunderRow('b-fork-1', ['allowedFork']), blunderRow('b-fork-2', ['missedFork']), blunderRow('b-pin', ['allowedPin'])] });
      case 'stats.gameRows':
      case 'stats.blunderRows':
      case 'openings.list':
      case 'endgameScenarios.list':
      case 'blunders.byIds':
      case 'blunders.due':
        return json(route, { data: [] });
      default:
        return json(route, { data: null });
    }
  });
  return state;
}

test.describe('courses', () => {
  test('lists courses, recommends from your blunders, and shows the sidebar entry', async ({ page }) => {
    await stub(page);
    await page.goto('/courses');
    await expect(page.getByTestId('courses-page')).toBeVisible();
    const recs = page.getByTestId('course-recommendations').getByTestId('course-card');
    await expect(recs.first()).toHaveAttribute('data-slug', 'avoid-knight-forks');
    await expect(recs.first()).toContainText('"Allowed fork" and "Missed fork" tag 14 blunders from your games.');
    await expect(page.getByRole('link', { name: 'Courses', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid=course-card][data-slug=caro-kann-foundations]').first()).toBeVisible();
  });

  test('a free day embeds the clip with credit, launches the drill, and paces the next day', async ({ page }) => {
    const state = await stub(page);
    await page.goto('/courses/avoid-knight-forks');
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/1$/);
    const frame = page.getByTestId('course-video').locator('iframe');
    await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/FGx28GrVrY8\?.*end=378/);
    await expect(frame).toHaveAttribute('credentialless', '');
    await expect(page.getByTestId('course-credit').getByRole('link')).toHaveAttribute('href', /youtube\.com\/@GMIgorSmirnov/);
    await expect(page.getByTestId('course-takeaway')).toBeVisible();
    await expect(page.getByTestId('course-drill')).toContainText('2 positions from your own games');

    await page.getByTestId('course-complete').click();
    await expect(page.getByTestId('course-day-done')).toContainText('Day 2 opens tomorrow');
    const done = state.rpcs.find((r) => r.name === 'courses.completeDay');
    expect(done?.args).toEqual({ slug: 'avoid-knight-forks', day: 1, localDate: today });
    // Finishing a lesson follows the course.
    await expect.poll(() => state.focus).toBe('avoid-knight-forks');

    await page.getByTestId('course-day-link').nth(1).click();
    await expect(page.getByTestId('course-day-tomorrow')).toBeVisible();
    await expect(page.getByTestId('course-video')).toHaveCount(0);

    await page.getByTestId('course-day-link').first().click();
    await page.getByTestId('course-drill-start').click();
    await expect(page).toHaveURL(/\/training$/);
    await expect.poll(() => state.rpcs.find((r) => r.name === 'blunders.byIds')?.args.ids).toEqual(['b-fork-1', 'b-fork-2']);
  });

  test('day 3 is gated for free players and never fetched', async ({ page }) => {
    const state = await stub(page, {
      progress: [
        { course_slug: 'avoid-knight-forks', day: 1, local_date: daysAgo(3), completed_at: new Date().toISOString() },
        { course_slug: 'avoid-knight-forks', day: 2, local_date: daysAgo(1), completed_at: new Date().toISOString() },
      ],
    });
    await page.goto('/courses/avoid-knight-forks');
    await expect(page).toHaveURL(/\/3$/);
    await expect(page.getByTestId('course-supporter-gate')).toContainText('Day 3 onward is for supporters');
    await expect(page.getByTestId('course-video')).toHaveCount(0);
    expect(state.rpcs.some((r) => r.name === 'courses.dayContent')).toBe(false);
  });

  test('supporters get day 3 from the server', async ({ page }) => {
    const state = await stub(page, {
      supporter: true,
      progress: [
        { course_slug: 'avoid-knight-forks', day: 1, local_date: daysAgo(3), completed_at: new Date().toISOString() },
        { course_slug: 'avoid-knight-forks', day: 2, local_date: daysAgo(1), completed_at: new Date().toISOString() },
      ],
    });
    await page.goto('/courses/avoid-knight-forks/3');
    await expect(page.getByTestId('course-video').locator('iframe')).toHaveAttribute('src', /start=659&end=1128/);
    await expect(page.getByTestId('course-takeaway')).toContainText('Supporter takeaway.');
    expect(state.rpcs.find((r) => r.name === 'courses.dayContent')?.args).toEqual({ slug: 'avoid-knight-forks', day: 3, localDate: today });
  });
});
