// Finds the blunder that decided a pro game and checks the punishment is a
// clean, one-answer puzzle (the same rule as the blunder format: the winner's
// best reply is clearly better than anything else).
import { analyse, EngineSession, judge, MOVETIME_MS, type Line } from './engine.ts';
import { winPercent } from '../../src/chess/winningChances.ts';
import { buildProPuzzle, MATE_THRESHOLD, type Puzzle } from './puzzle.ts';
import { proBlunderId, replayPgn, type ProGame } from './pros.ts';

/** Screen each position this fast; only the candidate gets a full search. */
export const SCREEN_MS = 150;
/** Start looking from this full move (openings are theory, not blunders). */
export const FIRST_MOVE = 8;
/** The blunderer still had a game: at least this likely to win before the move… */
export const MIN_BEFORE = 40;
/** …and lost at least this many winning-chance points with it. */
export const MIN_DROP = 30;

const win = (cp: number) => (cp >= MATE_THRESHOLD ? 100 : cp <= -MATE_THRESHOLD ? 0 : winPercent(cp));

export interface Swing {
  /** Ply index of the blunder. */
  ply: number;
  before: number;
  after: number;
}

/**
 * Pure: the first loser move that dropped ≥ MIN_DROP from a playable position.
 * `evals[i]` is the engine score of the position before ply i, from the side
 * to move there (so after the loser's move the score is the winner's).
 */
export function findDecidingBlunder(evals: readonly (number | null)[], loserMovesFirst: boolean, firstPly: number): Swing | null {
  for (let i = firstPly; i + 1 < evals.length; i++) {
    const loserToMove = (i % 2 === 0) === loserMovesFirst;
    if (!loserToMove) continue;
    const a = evals[i];
    const b = evals[i + 1];
    if (a == null || b == null) continue;
    const before = win(a);
    const after = 100 - win(b);
    if (before >= MIN_BEFORE && before - after >= MIN_DROP) return { ply: i, before, after };
  }
  return null;
}

export type ProScan = { ok: true; puzzle: Puzzle } | { ok: false; reason: string; fen: string };

export async function scanProGame(g: ProGame, screenMs = SCREEN_MS, checkMs = MOVETIME_MS): Promise<ProScan> {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const game = replayPgn(g.pgn);
  if (!game || game.moves.length < FIRST_MOVE * 2 + 4) return { ok: false, reason: 'too short or unreadable', fen: START };
  const firstPly = (FIRST_MOVE - 1) * 2;
  const loserMovesFirst = g.winner === 'black'; // white moves at even plies
  const evals: (number | null)[] = new Array(game.fens.length).fill(null);
  const engine = new EngineSession();
  try {
    for (let i = firstPly; i < game.fens.length; i++) {
      const [line] = await engine.analyse(game.fens[i], 1, screenMs).catch(() => [] as Line[]);
      evals[i] = line?.cp ?? null;
    }
  } finally {
    engine.close();
  }
  const swing = findDecidingBlunder(evals, loserMovesFirst, firstPly);
  if (!swing) return { ok: false, reason: 'no single deciding blunder', fen: START };
  const fenBefore = game.fens[swing.ply];
  const fenAfter = game.fens[swing.ply + 1];
  const lines = await analyse(fenAfter, 2, checkMs);
  const verdict = judge(lines[0]?.move ?? '', lines);
  if (!verdict.ok) return { ok: false, reason: `punishment not unique: ${verdict.reason}`, fen: fenBefore };
  const best = lines[0];
  const puzzle = buildProPuzzle({
    blunderId: proBlunderId(g.id),
    fenBefore,
    blunder: game.moves[swing.ply],
    punishmentPv: best.pv ?? [best.move],
    info: {
      white: { name: g.white.player.name, short: g.white.player.short, title: g.white.player.title, rating: g.white.rating },
      black: { name: g.black.player.name, short: g.black.player.short, title: g.black.player.title, rating: g.black.rating },
      event: g.event,
      year: g.year,
      timeControl: g.timeControl,
      url: g.url,
      foundInGame: game.moves[swing.ply + 1] === best.move,
    },
  });
  if (!puzzle) return { ok: false, reason: 'moves do not replay', fen: fenBefore };
  return { ok: true, puzzle };
}
