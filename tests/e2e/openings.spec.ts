import { expect, test, type Page } from '@playwright/test';

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

// After 1.e4 e5: white plays 2.Qh5 instead of the book's 2.Nf3 / 2.Bc4.
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const EPD = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -';

function row(o: Record<string, unknown>) {
  return {
    id: `d-${Math.random().toString(36).slice(2)}`,
    user_id: 'e2e-user',
    game_id: 'g1',
    status: 'user_left',
    rule_version: 2,
    ply: 2,
    move_number: 2,
    user_color: 'white',
    fen_before: FEN,
    epd_before: EPD,
    played_uci: 'd1h5',
    played_san: 'Qh5',
    reason: 'not_in_book',
    theory_moves: [
      { uci: 'g1f3', san: 'Nf3', games: 900, share: 80, moverWinPct: 38, titledShare: 86, tier: 'otb' },
      { uci: 'f1c4', san: 'Bc4', games: 100, share: 9, moverWinPct: 35, titledShare: 14, tier: 'otb' },
    ],
    position_games: 1100,
    played_games: 0,
    played_mover_win_pct: null,
    eval_before: 30,
    eval_after: 60,
    chances_lost: 12,
    classification: 'inaccuracy',
    eval_depth: 18,
    evaluated_at: new Date().toISOString(),
    book_tier: 'otb',
    book_end_ply: null,
    past_book_checked_at: null,
    blunder_id: 'b1',
    opening_family: "King's Pawn Game",
    opening_name: "King's Pawn Game: Wayward Queen Attack",
    eco: 'C20',
    created_at: new Date().toISOString(),
    ...o,
  };
}

const ROWS = [
  row({ game_id: 'g1' }),
  row({ game_id: 'g2', chances_lost: 14 }),
  row({
    game_id: 'g3',
    status: 'opponent_left',
    played_uci: 'a7a5',
    played_san: 'a5',
    move_number: 1,
    classification: null,
    chances_lost: null,
    opening_family: 'Sicilian Defense',
    user_color: 'black',
  }),
  // Past the book: the engine found the mistake and supplies the answer.
  row({
    game_id: 'g4',
    reason: 'past_book',
    ply: 20,
    move_number: 11,
    fen_before: 'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 11',
    epd_before: 'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2QK2R w KQ -',
    played_uci: 'e1f1',
    played_san: 'Kf1',
    theory_moves: [{ uci: 'e1g1', san: 'O-O', games: 0, share: 0, moverWinPct: 0, engineBest: true }],
    chances_lost: 18,
    classification: 'mistake',
    opening_family: "Queen's Gambit Declined",
  }),
];

async function stubAuth(page: Page, deviations: unknown[]) {
  await page.addInitScript(
    ({ session, project, deviations }) => {
      const origFetch = window.fetch.bind(window);
      window.fetch = (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (typeof url === 'string' && url.includes(`${project}.supabase.co`)) {
          const method = (init?.method ?? (typeof input === 'object' ? input?.method : undefined) ?? 'GET').toUpperCase();
          if (url.includes('/auth/v1/user')) {
            return Promise.resolve(new Response(JSON.stringify(session.user), { status: 200 }));
          }
          if (method === 'HEAD') {
            // Nothing left to walk or score: the scan exits without touching the engine.
            const n = url.includes('/games') && !url.includes('opening_deviation_version') ? 3 : 0;
            return Promise.resolve(new Response(null, { status: 200, headers: { 'content-range': `*/${n}` } }));
          }
          // The King's Pawn exit has an opening drill (b1), one rung up and due.
          const drill = {
            id: 'b1', game_id: 'g1', kind: 'opening', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
            move_number: 2, played_move: 'd1h5', correct_moves: [{ move: 'g1f3', eval: 30 }],
            eval_before: 30, eval_after: 60, eval_swing: 30, side_to_move: 'white',
            cycle_number: 1, times_correct: 1, times_attempted: 1, last_drill_failed: false,
            last_drilled_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            next_drill_at: new Date(Date.now() - 86_400_000).toISOString(),
            created_at: new Date().toISOString(), phase: 'opening', drill_data: null,
          };
          const body = url.includes('/rest/v1/opening_deviations')
            ? deviations
            : url.includes('/rest/v1/blunders') &&
                (url.includes('kind=eq.opening') || url.includes('id=in.')) &&
                deviations.length > 0
              ? [drill]
              : [];
          return Promise.resolve(
            new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
          );
        }
        return origFetch(input, init);
      };
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session));
    },
    { session: FAKE_SESSION, project: SUPABASE_PROJECT, deviations },
  );
}

test('groups recurring theory exits per opening with theory arrows', async ({ page }) => {
  await stubAuth(page, ROWS);
  await page.goto('/openings');
  await expect(page.getByRole('heading', { name: /Where you leave theory/i })).toBeVisible();

  const sections = page.getByTestId('opening-section');
  await expect(sections).toHaveCount(3);
  // Most costly first, expanded by default.
  await expect(sections.first()).toContainText("King's Pawn Game");
  const card = page.getByTestId('deviation-card');
  await expect(card).toHaveCount(1); // two games, same position + move → one leak
  await expect(card).toContainText('You played 2.Qh5');
  await expect(card).toContainText('in 2 games');
  await expect(card).toContainText('Players rated 2200+ (OTB) play');
  await expect(card).toContainText('Nf380%');
  await expect(card.getByTestId('deviation-reason')).toHaveText('Left the book');
  // The drill's place on the mastery chain, and a way to train just it.
  await expect(card.getByTestId('mastery-dots')).toHaveAttribute('aria-label', '1 of 4 cycles completed');
  await expect(card.getByTestId('train-position')).toBeVisible();
  // Board shows the red played arrow and green theory arrows.
  await expect(card.locator('svg.cg-shapes line, svg.cg-shapes g')).not.toHaveCount(0);

  // A past-book mistake shows the engine's move instead of book stats.
  await sections.filter({ hasText: "Queen's Gambit Declined" }).getByRole('button').first().click();
  const engineCard = page.getByTestId('deviation-card').filter({ hasText: 'Kf1' });
  await expect(engineCard.getByTestId('deviation-reason')).toHaveText('Mistake after theory');
  await expect(engineCard).toContainText('Best');
  await expect(engineCard).toContainText('O-O');
  await expect(page.getByTestId('book-attribution')).toContainText('CC BY-SA 4.0');

  // Colour filter.
  await page.getByTestId('tab-black').click();
  await expect(sections).toHaveCount(1);
  await expect(sections.first()).toContainText('Sicilian Defense');
});

test('leads with the biggest leak and offers to drill it', async ({ page }) => {
  await stubAuth(page, ROWS);
  await page.goto('/openings');
  const hero = page.getByTestId('openings-hero');
  await expect(hero).toContainText("King's Pawn Game as White: you left theory by move 2 in 2 games.");
  await expect(hero).toContainText('Most repeated: 2.Qh5 in 2 games');
  await expect(hero).toContainText('Players rated 2200+ (OTB) play Nf3 80% of the time');
  await expect(page.getByTestId('review-due')).toHaveText('Review 1 due');

  await hero.getByTestId('hero-drill').click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByText(/King's Pawn Game · 1 position/)).toBeVisible();
});

test('empty state points at the dashboard', async ({ page }) => {
  await stubAuth(page, []);
  await page.goto('/openings');
  await expect(page.getByTestId('openings-empty')).toBeVisible();
  await expect(page.getByRole('link', { name: /Go to dashboard/i })).toBeVisible();
});
