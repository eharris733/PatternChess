import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PROFILE_ROW, rpcError, stubApp, stubRpc, stubSession, type RpcRecorder, type StubUser } from './helpers/api';

// /courses on the Cloudflare backend: the session (better-auth) and every
// RPC are stubbed by tests/e2e/helpers/api.ts, so no local D1 or Functions
// are needed. The dev server shows pending courses (import.meta.env.DEV),
// which is all of the catalog until creators agree.
//
// The lesson-drill tests don't depend on the real lessons: the free-day test
// serves Vite's module for the catalog with one day pointing at a tiny fixture
// lesson (and serves that lesson's module too); the supporter-day test returns
// a fixture lesson from courses.dayContent, the way KV serves it.

const USER: StubUser = {
  id: 'e2e-courses',
  name: 'E2E Courses',
  email: 'e2e-courses@example.com',
  emailVerified: true,
  image: null,
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
};

const FORK_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

function blunderRow(id: string, motifs: string[], gameId = 'g-other') {
  return {
    id,
    user_id: USER.id,
    game_id: gameId,
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

type ProgressRow = { course_slug: string; day: number; local_date: string; completed_at: string };

interface CourseState {
  rec: RpcRecorder;
  progress: ProgressRow[];
  focus: string | null;
}

/** Games for the opening share: 8 Caro-Kann and 12 Sicilian, all as Black. */
function gameRow(i: number, family: string) {
  return {
    id: `g${i}`,
    user_id: USER.id,
    platform: 'lichess',
    external_game_id: `ext${i}`,
    pgn: '',
    played_at: new Date(Date.now() - i * 3_600_000).toISOString(),
    user_color: 'black',
    result: '0-1',
    opening_family: family,
    opening_name: family,
    eco: null,
    time_control: '600+0',
    rated: true,
    user_rating: 1500,
    analyzed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}
const GAMES = [
  ...Array.from({ length: 8 }, (_, i) => gameRow(i + 1, 'Caro-Kann Defense')),
  ...Array.from({ length: 12 }, (_, i) => gameRow(i + 9, 'Sicilian Defense')),
];

async function stub(
  page: Page,
  opts: {
    supporter?: boolean;
    progress?: ProgressRow[];
    focus?: string | null;
    games?: boolean;
    /** A built lesson served with the supporter day (KV `lessonStudy`). */
    dayLesson?: object;
  } = {},
) {
  const state = { progress: opts.progress ?? [], focus: opts.focus ?? null } as CourseState;
  const profile = () => ({ ...DEFAULT_PROFILE_ROW, ...PROFILE });
  state.rec = await stubApp(page, {
    user: USER,
    ...(opts.games ? { games: GAMES } : {}),
    blunders: [
      blunderRow('b-fork-1', ['allowedFork']),
      blunderRow('b-fork-2', ['missedFork']),
      blunderRow('b-pin', ['allowedPin']),
      // An opening-phase mistake in a Caro-Kann game, for "Now your games".
      { ...blunderRow('b-caro', [], 'g1'), phase: 'opening', move_number: 6 },
    ],
    rpc: {
      'profile.get': profile,
      'profile.getOrCreate': profile,
      'profile.bumpAppOpen': () => 1,
      'supporters.mine': () =>
        opts.supporter
          ? { status: 'active', current_period_end: null, cancel_at_period_end: false, first_supported_at: new Date().toISOString() }
          : null,
      'courses.progress': () => ({ focus: state.focus, days: state.progress }),
      'courses.setFocus': (args) => {
        state.focus = (args.slug as string | null) ?? null;
        return { focus: state.focus };
      },
      'courses.completeDay': (args) => {
        state.progress.push({
          course_slug: args.slug,
          day: args.day,
          local_date: args.localDate,
          completed_at: new Date().toISOString(),
        });
        return state.progress.filter((r) => r.course_slug === args.slug);
      },
      'courses.dayContent': () =>
        opts.supporter
          ? {
              youtubeId: 'FGx28GrVrY8',
              start: 659,
              end: 1128,
              takeaway: 'Supporter takeaway.',
              lesson: opts.dayLesson ? 'avoid-knight-forks-d3' : null,
              lessonStudy: opts.dayLesson ?? null,
            }
          : rpcError(403, 'This lesson is for supporters', 'supporters_only'),
      // The server's aggregate, not the seeded rows' (those carry no solution line).
      'stats.motifCounts': () => ({ counts: { allowedFork: 12, missedFork: 2, defensiveMistake: 6 }, tagged: 20, untagged: 0, total: 20 }),
    },
  });
  return state;
}

// A built course-day lesson (its file must exist for the lazy loader); the
// test serves TINY_LESSON in its place.
const LESSON_SLUG = 'king-and-pawn-endgames-d1';

/** A one-move lesson: an intro beat, 1.e4 for the learner, then ...e5 ends it. */
const TINY_LESSON = {
  slug: LESSON_SLUG,
  studyId: 'yt-fixture',
  title: 'Fixture lesson',
  category: 'openings',
  openingFamilies: [],
  color: 'white',
  level: 'beginner',
  author: 'Fixture',
  authorUrl: 'https://www.youtube.com/@fixture',
  studyUrl: 'https://www.youtube.com/watch?v=FGx28GrVrY8',
  description: '',
  permissionNote: '',
  // Built from the day's own video, so the day's clip plays alongside.
  source: {
    kind: 'youtube',
    url: 'https://www.youtube.com/watch?v=Jiz7KLKjLas',
    channel: 'Hanging Pawns',
    channelUrl: 'https://www.youtube.com/@HangingPawns',
    title: 'Caro-Kann Defense',
  },
  chapters: [{ id: 'c1', name: 'Take the centre' }],
  chapterData: [
    {
      id: 'c1',
      name: 'Take the centre',
      url: '',
      annotator: null,
      orientation: 'white',
      startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      intro: 'Start by taking the centre.',
      introTs: 12,
      gamebook: false,
      moves: [
        {
          id: 'n0',
          san: 'e4',
          uci: 'e2e4',
          fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          children: [
            {
              id: 'n1',
              san: 'e5',
              uci: 'e7e5',
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * A supporter-day lesson with an opponent sideline: main line 1.e4 e5; the
 * sideline 1...c5 is its own line, answered by 2.Nf3.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SUPPORTER_LESSON = {
  ...TINY_LESSON,
  slug: 'avoid-knight-forks-d3',
  source: { ...TINY_LESSON.source, url: 'https://www.youtube.com/watch?v=FGx28GrVrY8' },
  chapters: [{ id: 'c1', name: 'Meet the Sicilian' }],
  chapterData: [
    {
      id: 'c1',
      name: 'Meet the Sicilian',
      url: '',
      annotator: null,
      orientation: 'white',
      startFen: START,
      gamebook: false,
      moves: [
        {
          id: 'n0',
          san: 'e4',
          uci: 'e2e4',
          fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          children: [
            { id: 'n1', san: 'e5', uci: 'e7e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', children: [] },
            {
              id: 'n2',
              san: 'c5',
              uci: 'c7c5',
              fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              comment: 'If Black plays the Sicilian instead, develop.',
              ts: 700,
              children: [
                {
                  id: 'n3',
                  san: 'Nf3',
                  uci: 'g1f3',
                  fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Serve the catalog with `slug` day 1 pointing at the fixture lesson, and the lesson itself. */
async function withLessonDay(page: Page, slug: string) {
  const catalog = JSON.parse(readFileSync('src/generated/courses-catalog.json', 'utf8'));
  const course = catalog.courses.find((c: { slug: string }) => c.slug === slug);
  course.days[0].lesson = LESSON_SLUG;
  await page.route(/\/src\/generated\/courses-catalog\.json/, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: `export default ${JSON.stringify(catalog)};` }),
  );
  await page.route(new RegExp(`/src/generated/course-lessons/${LESSON_SLUG}\\.json`), (route) =>
    route.fulfill({ contentType: 'text/javascript', body: `export default ${JSON.stringify(TINY_LESSON)};` }),
  );
}

async function dragMove(page: Page, from: { file: number; rank: number }, to: { file: number; rank: number }) {
  const board = page.locator('cg-board');
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width } = box!;
  const sq = width / 8;
  const fromPx = { x: x + sq * from.file + sq / 2, y: y + sq * (8 - from.rank) + sq / 2 };
  const toPx = { x: x + sq * to.file + sq / 2, y: y + sq * (8 - to.rank) + sq / 2 };
  await page.mouse.move(fromPx.x, fromPx.y);
  await page.mouse.down();
  await page.mouse.move(toPx.x, toPx.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('courses', () => {
  test('recommends from your games with the share of games, and shows the sidebar entry', async ({ page }) => {
    await stub(page, { games: true });
    await page.goto('/courses');
    await expect(page.getByTestId('courses-page')).toBeVisible();
    const recs = page.getByTestId('course-recommendations');
    await expect(recs.locator('[data-testid=course-card][data-slug=caro-kann-foundations]')).toContainText(
      'You play the Caro-Kann Defense in 40% of your games as Black.',
    );
    await expect(recs.locator('[data-testid=course-card][data-slug=sicilian-essentials]')).toContainText(
      'You play the Sicilian Defense in 60% of your games as Black.',
    );
    await expect(recs.locator('[data-testid=course-card][data-slug=avoid-knight-forks]')).toContainText(
      '14 of your blunders (70%) are tagged "Allowed fork" or "Missed fork".',
    );
    await expect(page.getByRole('link', { name: 'Courses', exact: true })).toBeVisible();
  });

  test('a watch-only day: clip with credit, then your games, and the next lesson opens at once', async ({ page }) => {
    const state = await stub(page);
    await page.goto('/courses/avoid-knight-forks');
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/1$/);
    const frame = page.getByTestId('course-video').locator('iframe');
    await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/FGx28GrVrY8\?.*end=378/);
    await expect(frame).toHaveAttribute('credentialless', '');
    await expect(page.getByTestId('course-credit').getByRole('link')).toHaveAttribute('href', /youtube\.com\/@GMIgorSmirnov/);
    await expect(page.getByTestId('course-takeaway')).toBeVisible();
    await expect(page.getByTestId('course-mistakes')).toHaveText('2 mistakes with this pattern');

    await page.getByTestId('course-complete').click();
    await expect(page.getByTestId('course-day-done')).toContainText('Lesson done. Now your games.');
    const done = state.rec.callsTo('courses.completeDay')[0];
    expect(done?.args).toEqual({ slug: 'avoid-knight-forks', day: 1, localDate: today });
    // Finishing a lesson follows the course.
    await expect.poll(() => state.focus).toBe('avoid-knight-forks');

    // No waiting for tomorrow: day 2 is open right away.
    await expect(page.getByTestId('course-day-link').nth(1)).toHaveAttribute('data-status', 'open');
    await expect(page.getByTestId('course-next-lesson')).toContainText('Next: day 2');

    await page.getByTestId('course-drill-start').click();
    await expect(page).toHaveURL(/\/training$/);
    await expect.poll(() => state.rec.callsTo('blunders.byIds')[0]?.args.ids).toEqual(['b-fork-1', 'b-fork-2']);
    await expect(page.getByRole('button', { name: 'Back to the lesson' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to the lesson' }).first().click();
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/1$/);

    await page.getByRole('link', { name: 'Next lesson' }).click();
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/2$/);
    await expect(page.getByTestId('course-video')).toBeVisible();
    await page.getByTestId('course-complete').click();
    await expect(state.rec.callsTo('courses.completeDay')).toHaveLength(2);
  });

  test('a day with a lesson PGN: play the lesson drill, then your mistakes in this opening', async ({ page }) => {
    await withLessonDay(page, 'caro-kann-foundations');
    const state = await stub(page, { games: true });
    await page.goto('/courses/caro-kann-foundations/1');
    await expect(page.getByTestId('course-lesson-drill')).toBeVisible();
    await expect(page.getByTestId('course-day-steps')).toContainText('Lesson drill');
    await expect(page.getByTestId('course-message')).toContainText('Start by taking the centre.');
    // The day's clip plays alongside, and the note links to its moment.
    await expect(page.getByTestId('course-video').locator('iframe')).toHaveAttribute('src', /embed\/Jiz7KLKjLas\?.*end=811/);
    await expect(page.getByTestId('course-watch')).toContainText('0:12');
    await expect(page.getByTestId('course-mistakes')).toHaveText('1 mistake in this opening');

    await page.getByTestId('course-continue').click();
    await expect(page.getByTestId('course-status')).toHaveText('Your move as White.');
    await dragMove(page, { file: 4, rank: 2 }, { file: 4, rank: 4 });
    await expect(page.getByTestId('course-next')).toContainText('Finish the lesson');
    await page.getByTestId('course-next').click();

    await expect.poll(() => state.rec.callsTo('courses.completeDay')[0]?.args).toEqual({
      slug: 'caro-kann-foundations',
      day: 1,
      localDate: today,
    });
    await expect(page.getByTestId('course-day-done')).toContainText('Lesson done. Now your games.');
    await expect(page.getByTestId('course-takeaway')).toBeVisible();
    await page.getByTestId('course-drill-start').click();
    await expect.poll(() => state.rec.callsTo('blunders.byIds')[0]?.args.ids).toEqual(['b-caro']);
  });

  test("the plan's Today's lesson step comes first and never waits for tomorrow", async ({ page }) => {
    const state = await stub(page, {
      focus: 'avoid-knight-forks',
      progress: [{ course_slug: 'avoid-knight-forks', day: 1, local_date: today, completed_at: new Date().toISOString() }],
    });
    await page.goto('/dashboard');
    const plan = page.getByTestId('daily-plan');
    const lesson = plan.getByTestId('plan-step-lesson');
    await expect(lesson).toHaveAttribute('data-state', 'done');
    await expect(lesson).toContainText('Avoid Knight Forks: done for today');
    // The lesson is the first step, ahead of Train.
    await expect(plan.locator('[data-plan-step]').first()).toHaveAttribute('data-testid', 'plan-step-lesson');
    await lesson.getByRole('button', { name: 'Next lesson' }).click();
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/2$/);
    await expect(page.getByTestId('course-video')).toBeVisible();
    expect(state.rec.callsTo('courses.progress').length).toBeGreaterThan(0);
  });

  test('an open lesson shows as a to-do step', async ({ page }) => {
    await stub(page, { focus: 'avoid-knight-forks' });
    await page.goto('/dashboard');
    const lesson = page.getByTestId('plan-step-lesson');
    await expect(lesson).toHaveAttribute('data-state', 'open');
    await expect(lesson).toContainText('Avoid Knight Forks · Day 1: Tips 1 to 3');
    await lesson.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/courses\/avoid-knight-forks\/1$/);
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
    // Your games stay free.
    await expect(page.getByTestId('course-mistakes')).toBeVisible();
    expect(state.rec.callsTo('courses.dayContent')).toHaveLength(0);
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
    expect(state.rec.callsTo('courses.dayContent')[0]?.args).toEqual({ slug: 'avoid-knight-forks', day: 3 });
  });

  test("a supporter day's lesson comes with the day, and its opponent sidelines are lines to train", async ({ page }) => {
    const state = await stub(page, {
      supporter: true,
      dayLesson: SUPPORTER_LESSON,
      progress: [
        { course_slug: 'avoid-knight-forks', day: 1, local_date: daysAgo(3), completed_at: new Date().toISOString() },
        { course_slug: 'avoid-knight-forks', day: 2, local_date: daysAgo(1), completed_at: new Date().toISOString() },
      ],
    });
    await page.goto('/courses/avoid-knight-forks/3');
    await expect(page.getByTestId('course-lesson-drill')).toBeVisible();
    await expect(page.getByTestId('course-chapter-label')).toContainText('Line 1 of 2');
    await expect(page.getByTestId('course-status')).toHaveText('Your move as White.');
    await dragMove(page, { file: 4, rank: 2 }, { file: 4, rank: 4 });
    // Main line done: the sideline is next, not the finish.
    await expect(page.getByTestId('course-next')).toContainText('Next line');
    await page.getByTestId('course-next').click();
    await expect(page.getByTestId('course-chapter-label')).toContainText('Line 2 of 2');
    await expect(page.getByTestId('course-branch')).toHaveText('Instead: 1...c5');
    await expect(page.getByTestId('course-message')).toContainText('If Black plays the Sicilian instead, develop.');
    await expect(page.getByTestId('course-watch')).toContainText('11:40');
    await page.getByTestId('course-continue').click();
    await dragMove(page, { file: 6, rank: 1 }, { file: 5, rank: 3 });
    await expect(page.getByTestId('course-next')).toContainText('Finish the lesson');
    await page.getByTestId('course-next').click();
    await expect.poll(() => state.rec.callsTo('courses.completeDay')[0]?.args.day).toBe(3);
  });
});

test('/c/:slug opens creator demos only, never a course-day lesson', async ({ page }) => {
  await stubSession(page, null);
  await stubRpc(page);
  // A course lesson's slug is guessable and its course may not be granted yet.
  await page.goto(`/c/${LESSON_SLUG}`);
  await expect(page.getByTestId('course-not-found')).toBeVisible();
  // An outreach demo still plays.
  await page.goto('/c/hp-sicilian-pin-dzp2it');
  await expect(page.getByText('Punishing the Sicilian Pin Variation').first()).toBeVisible();
  await expect(page.getByTestId('course-not-found')).toHaveCount(0);
});
