import { parseGames } from '@mliebelt/pgn-parser';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { blunderFromJson } from '../../models/blunder';
import { gameRecordFromJson } from '../../models/gameRecord';
import type { GameLink } from '../../services/db/vault';
import {
  CSV_COLUMNS,
  csvCell,
  exportFilename,
  fenPly,
  gameUrl,
  playUci,
  positionToPgn,
  positionsToCsv,
  positionsToPgn,
  solutionUci,
  type ExportPosition,
} from './vaultExport';
import { positionFacts } from './vaultFilters';

const BLACK_FEN = 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
const WHITE_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

function blunder(over: Record<string, unknown>) {
  return blunderFromJson({
    id: 'b1',
    game_id: 'g1',
    fen: BLACK_FEN,
    move_number: 5,
    played_move: 'f6d5',
    correct_moves: [{ move: 'c6a5', eval: -40 }],
    eval_before: 0,
    eval_after: -300,
    eval_swing: 300,
    side_to_move: 'b',
    created_at: '2026-03-01T12:00:00Z',
    phase: 'middlegame',
    motifs: ['leftPieceHanging', 'allowedFork'],
    solution_line: { pv: ['c6a5', 'c4b5', 'c7c6'], playedPv: ['g5f7', 'e8f7', 'd1f3'], v: 1 },
    kind: 'tactic',
    ...over,
  });
}

const game = gameRecordFromJson({
  id: 'g1',
  platform: 'lichess',
  username: 'hero',
  opponent: 'Vil"lain',
  created_at: '2026-01-01T00:00:00Z',
  played_at: '2026-02-10T12:00:00Z',
  user_color: 'black',
  eco: 'C57',
  opening_name: 'Italian Game: Two Knights Defense, Fried Liver Attack',
  opening_family: 'Italian Game',
});

const lichessLink: GameLink = { gameId: 'g1', platform: 'lichess', externalGameId: 'AbCd1234', timeControl: '600+5' };

function item(b = blunder({}), link: GameLink | null = lichessLink, g = game): ExportPosition {
  return { facts: positionFacts(b, g), link };
}

describe('links', () => {
  it('counts plies before a FEN', () => {
    expect(fenPly(BLACK_FEN)).toBe(9);
    expect(fenPly(WHITE_FEN)).toBe(4);
    expect(fenPly('8/8/8/8/8/8/8/8 x - - 0 0')).toBeNull();
  });

  it('opens Lichess games at the position from the user side', () => {
    expect(gameUrl(lichessLink, { fen: BLACK_FEN, color: 'black' })).toBe('https://lichess.org/AbCd1234/black#9');
    expect(gameUrl(lichessLink, { fen: WHITE_FEN, color: 'white' })).toBe('https://lichess.org/AbCd1234#4');
  });

  it('links chess.com live and daily games, and nothing for uploads', () => {
    const cc = (timeControl: string | null): GameLink => ({
      gameId: 'g',
      platform: 'chess.com',
      externalGameId: '123456',
      timeControl,
    });
    expect(gameUrl(cc('600'))).toBe('https://www.chess.com/game/live/123456');
    expect(gameUrl(cc('180+2'))).toBe('https://www.chess.com/game/live/123456');
    expect(gameUrl(cc('1/86400'))).toBe('https://www.chess.com/game/daily/123456');
    expect(gameUrl({ gameId: 'g', platform: 'pgn', externalGameId: 'sha', timeControl: null })).toBeNull();
    expect(gameUrl(null)).toBeNull();
  });
});

describe('moves', () => {
  it('uses the stored PV when it starts with the best move', () => {
    expect(solutionUci(blunder({}))).toEqual(['c6a5', 'c4b5', 'c7c6']);
    expect(solutionUci(blunder({ solution_line: { pv: ['h7h6'], playedPv: [], v: 1 } }))).toEqual(['c6a5']);
    expect(solutionUci(blunder({ solution_line: null, correct_moves: [] }))).toEqual([]);
  });

  it('stops at the first illegal move', () => {
    expect(playUci(BLACK_FEN, ['c6a5', 'e1e8', 'c7c6']).map((m) => m.san)).toEqual(['Na5']);
    expect(playUci('not a fen', ['e2e4'])).toEqual([]);
  });
});

describe('CSV', () => {
  it('quotes RFC 4180 style and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell(null)).toBe('');
  });

  it('writes one row per position with every column', () => {
    const csv = positionsToCsv([item(), item(blunder({ id: 'b2', fen: WHITE_FEN, played_move: 'f3g5', correct_moves: [{ move: 'f1b5', eval: 40 }], solution_line: null, motifs: [] }), null, { ...game, userColor: 'white' })]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toBe(
      [
        '2026-02-10',
        'Tactic',
        'New',
        'Middlegame',
        'Black',
        'Italian Game',
        'Left a piece hanging; Allowed fork',
        BLACK_FEN,
        '5...',
        'Nxd5',
        'Na5',
        '5... Na5 6. Bb5+ c6',
        'https://lichess.org/AbCd1234/black#9',
      ].join(','),
    );
    expect(lines[2].split(',').slice(-5)).toEqual(['3.', 'Ng5', 'Bb5', '3. Bb5', '']);
  });
});

describe('PGN', () => {
  it('writes a setup game with the solution and the played move as a variation', () => {
    const pgn = positionToPgn(item());
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${BLACK_FEN}"]`);
    expect(pgn).toContain(`[White "Vil'lain"]`);
    expect(pgn).toContain('[Black "hero"]');
    expect(pgn).toContain('[Site "https://lichess.org/AbCd1234/black#9"]');
    expect(pgn).toContain('[Date "2026.02.10"]');
    expect(pgn).toContain('[ECO "C57"]');
    expect(pgn).toContain('5... Na5 (5... Nxd5 $4 6. Nxf7 Kxf7 7. Qf3+) 6. Bb5+ c6 *');
    expect(pgn).toContain('{You played 5... Nxd5 in the game. Left a piece hanging, Allowed fork.}');
    for (const line of pgn.split('\n')) expect(line.length).toBeLessThanOrEqual(79);
  });

  it('numbers a white-to-move line and handles a missing answer', () => {
    const w = blunder({
      fen: WHITE_FEN,
      played_move: 'f3g5',
      correct_moves: [{ move: 'f1b5', eval: 40 }],
      solution_line: { pv: ['f1b5', 'a7a6', 'b5a4'], playedPv: [], v: 1 },
      kind: 'endgame',
      motifs: [],
    });
    expect(positionToPgn(item(w, null, { ...game, userColor: 'white' }))).toContain('3. Bb5 (3. Ng5 $2) 3... a6 4. Ba4 *');
    const none = blunder({ correct_moves: [], solution_line: null, motifs: [] });
    expect(positionToPgn(item(none, null, game))).toMatch(/\} 5\.\.\. Nxd5 \$4 \*\n$/);
    expect(positionToPgn(item(none, null, game))).toContain('[Site "?"]');
  });

  it('is a valid multi-game PGN that chess.js replays to the end of each solution', () => {
    const items = [
      item(),
      item(blunder({ id: 'b2', fen: WHITE_FEN, played_move: 'f3g5', correct_moves: [{ move: 'f1b5', eval: 40 }], solution_line: { pv: ['f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'], playedPv: ['d8g5'], v: 1 } }), null, null as never),
    ];
    const pgn = positionsToPgn(items);
    const games = parseGames(pgn, { startRule: 'games' });
    expect(games).toHaveLength(2);
    expect(games[0].tags?.FEN).toBe(BLACK_FEN);
    expect(games[0].moves.map((m) => m.notation.notation)).toEqual(['Na5', 'Bb5+', 'c6']);
    expect(games[0].moves[0].variations[0].map((m) => m.notation.notation)).toEqual(['Nxd5', 'Nxf7', 'Kxf7', 'Qf3+']);
    expect(games[1].moves.map((m) => m.notation.notation)).toEqual(['Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);

    for (const chunk of pgn.split(/\n(?=\[Event )/)) {
      const chess = new Chess();
      chess.loadPgn(chunk);
      expect(chess.history().length).toBeGreaterThan(0);
    }
  });

  it('names export files by tab and date', () => {
    expect(exportFilename('mastered', 'pgn', new Date(2026, 10, 22))).toBe('patternchess-mastered-2026-11-22.pgn');
  });
});
