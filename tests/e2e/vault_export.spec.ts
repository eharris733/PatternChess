import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Chess } from 'chess.js';
import { stubApp } from './helpers/api';

// Vault position filters (motif / phase / opening / color / date, all in the
// URL) and the CSV + PGN export of the filtered set.

const NOW = new Date().toISOString();

function gameRow(overrides: Record<string, unknown>) {
  return {
    user_id: 'e2e-user',
    platform: 'lichess',
    username: 'hero',
    pgn: '1. e4 e5 *',
    time_control: '600+5',
    rated: true,
    result: '1-0',
    created_at: NOW,
    analyzed_at: NOW,
    eco: null,
    opening_name: null,
    user_rating: 1500,
    opponent_rating: 1500,
    clock_per_ply: null,
    total_plies: 40,
    parsed_metadata_at: null,
    ...overrides,
  };
}

const GAMES = [
  gameRow({
    id: 'g-italian',
    opponent: 'Rival',
    user_color: 'black',
    played_at: '2026-03-10T12:00:00Z',
    opening_family: 'Italian Game',
    external_game_id: 'AbCd1234',
  }),
  gameRow({
    id: 'g-sicilian',
    platform: 'chess.com',
    opponent: 'Other',
    user_color: 'white',
    played_at: '2026-06-01T12:00:00Z',
    opening_family: 'Sicilian Defense',
    external_game_id: '987654321',
    time_control: '180+2',
  }),
];

function blunderRow(overrides: Record<string, unknown>) {
  return {
    user_id: 'e2e-user',
    eval_before: 50,
    eval_after: -350,
    eval_swing: 400,
    cycle_number: 0,
    last_drilled_at: null,
    next_drill_at: NOW,
    times_correct: 0,
    times_attempted: 0,
    last_drill_failed: false,
    created_at: NOW,
    phase: 'middlegame',
    solution_line: null,
    kind: 'tactic',
    drill_data: null,
    analysis_depth: 12,
    retired_at: null,
    ...overrides,
  };
}

const FRIED_LIVER = 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
const BLUNDERS = [
  // Italian, black, middlegame, two motifs, with a full solution + refutation.
  blunderRow({
    id: 'b-fork',
    game_id: 'g-italian',
    fen: FRIED_LIVER,
    side_to_move: 'b',
    move_number: 5,
    played_move: 'f6d5',
    correct_moves: [{ move: 'c6a5', eval: -40 }],
    solution_line: { pv: ['c6a5', 'c4b5', 'c7c6'], playedPv: ['g5f7', 'e8f7', 'd1f3'], v: 1 },
    motifs: ['leftPieceHanging', 'allowedFork'],
  }),
  // Italian, black, opening phase, one motif.
  blunderRow({
    id: 'b-open',
    game_id: 'g-italian',
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    side_to_move: 'b',
    move_number: 1,
    played_move: 'g8f6',
    correct_moves: [{ move: 'e7e5', eval: -20 }],
    motifs: ['allowedFork'],
    phase: 'opening',
  }),
  // Sicilian, white, endgame phase, no motifs.
  blunderRow({
    id: 'b-end',
    game_id: 'g-sicilian',
    fen: '8/5k2/8/8/8/8/4PK2/8 w - - 0 50',
    side_to_move: 'w',
    move_number: 50,
    played_move: 'f2f3',
    correct_moves: [{ move: 'e2e4', eval: 300 }],
    motifs: [],
    phase: 'endgame',
  }),
];

async function stubVault(page: Page) {
  return stubApp(page, { games: GAMES, blunders: BLUNDERS });
}

async function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('vault filters narrow positions and live in the URL', async ({ page }) => {
  const errors = await watchErrors(page);
  await stubVault(page);
  await page.goto('/vault');
  const cards = page.getByTestId('vault-position');
  await expect(cards).toHaveCount(3);

  // Motif select, with per-option counts.
  const motif = page.getByTestId('vault-filter-motif');
  await expect(motif.locator('option', { hasText: 'Allowed fork (2)' })).toHaveCount(1);
  await motif.selectOption('allowedFork');
  await expect(page).toHaveURL(/motif=allowedFork/);
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('vault-count')).toHaveText('2 positions of 3');

  // Phase narrows further.
  await page.getByTestId('vault-filter-phase').selectOption('opening');
  await expect(page).toHaveURL(/phase=opening/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Move 1');

  await page.getByTestId('vault-filters-clear').click();
  await expect(cards).toHaveCount(3);
  await expect(page).not.toHaveURL(/motif=|phase=/);

  // Opening family and color.
  await page.getByTestId('vault-filter-opening').selectOption('Sicilian Defense');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Move 50');
  await page.getByTestId('vault-filter-opening').selectOption('');
  await page.getByTestId('vault-filter-color').selectOption('black');
  await expect(page).toHaveURL(/color=black/);
  await expect(cards).toHaveCount(2);
  await page.getByTestId('vault-filters-clear').click();

  // Date range (inclusive; the Sicilian game is from June).
  await page.getByTestId('vault-filter-from').fill('2026-05-01');
  await expect(page).toHaveURL(/from=2026-05-01/);
  await expect(cards).toHaveCount(1);
  await page.getByTestId('vault-filter-to').fill('2026-05-31');
  await expect(page.getByTestId('vault-no-matches')).toBeVisible();
  await page.getByTestId('vault-no-matches').getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(3);

  // A motif chip on a card filters by that motif; clicking it again clears it.
  const chip = cards.first().getByRole('button', { name: 'Left a piece hanging' });
  await chip.click();
  await expect(page).toHaveURL(/motif=leftPieceHanging/);
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('button', { name: 'Left a piece hanging' }).click();
  await expect(cards).toHaveCount(3);

  // Deep link, carried to Mastered and dropped on Games.
  await page.goto('/vault?phase=endgame&color=white');
  await expect(cards).toHaveCount(1);
  await page.getByTestId('vault-tab-mastered').click();
  await expect(page).toHaveURL(/phase=endgame/);
  await page.getByTestId('vault-tab-games').click();
  await expect(page).not.toHaveURL(/phase=|color=/);

  expect(errors).toEqual([]);
});

test('exports the filtered positions as CSV and PGN', async ({ page }) => {
  const errors = await watchErrors(page);
  const rec = await stubVault(page);
  await page.goto('/vault?color=black');
  await expect(page.getByTestId('vault-position')).toHaveCount(2);

  // CSV: a header plus one row per filtered position, with game links.
  await page.getByTestId('vault-export').click();
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('vault-export-csv').click()]);
  expect(csvDl.suggestedFilename()).toMatch(/^patternchess-blunders-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await csvDl.path(), 'utf8').replace(/^﻿/, '');
  const lines = csv.trimEnd().split('\r\n');
  expect(lines[0]).toBe(
    'Date,Type,Progress,Phase,Color,Opening,Motifs,FEN,Move,Played move,Best move,Solution line,Game link',
  );
  expect(lines).toHaveLength(3);
  const forkRow = lines.find((l) => l.includes(FRIED_LIVER));
  expect(forkRow).toContain('Tactic,New,Middlegame,Black,Italian Game,Left a piece hanging; Allowed fork');
  expect(forkRow).toContain('5...,Nxd5,Na5,5... Na5 6. Bb5+ c6,https://lichess.org/AbCd1234/black#9');
  expect(rec.callsTo('vault.gameLinks')[0].args.ids).toEqual(['g-italian']);

  // PGN: one setup game per position, each replayable.
  await page.getByTestId('vault-filter-color').selectOption('');
  await expect(page.getByTestId('vault-position')).toHaveCount(3);
  await page.getByTestId('vault-export').click();
  const [pgnDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('vault-export-pgn').click()]);
  expect(pgnDl.suggestedFilename()).toMatch(/\.pgn$/);
  const pgn = readFileSync(await pgnDl.path(), 'utf8');
  const games = pgn.trim().split(/\n(?=\[Event )/);
  expect(games).toHaveLength(3);
  for (const g of games) {
    expect(g).toContain('[SetUp "1"]');
    const chess = new Chess();
    chess.loadPgn(g);
    expect(chess.history().length).toBeGreaterThan(0);
  }
  expect(pgn).toContain('5... Na5 (5... Nxd5 $4 6. Nxf7 Kxf7 7. Qf3+) 6. Bb5+ c6 *');
  expect(pgn).toContain('[Site "https://www.chess.com/game/live/987654321"]');

  expect(errors).toEqual([]);
});
