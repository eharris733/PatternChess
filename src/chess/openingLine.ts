import { bookEpd } from './bookFormat';
import { CASTLING_NORMALIZE, parseUciMove } from './moveUtils';
import type { RepertoireMap, RepertoireMove } from '../models/repertoire';

/** One replayed position: the move played FROM it (null at the end of the game). */
export interface LinePosition {
  fen: string;
  uciMove: string | null;
  sanMove: string | null;
  sideToMove: 'white' | 'black';
}

/** The opening as played up to a drill position, ready to step on the board. */
export interface IntroLine {
  /** fens[0] is the start; the last entry is the drill position. */
  fens: string[];
  /** Move that led into fens[i] (null for the start). */
  lastMoves: ([string, string] | null)[];
}

/** Opening intros never replay further than this (≈ the 13-move theory window + slack). */
export const MAX_INTRO_PLIES = 30;

function normalizeUci(uci: string): string {
  return CASTLING_NORMALIZE[uci] ?? uci;
}

/**
 * Replay a game up to the first position whose EPD matches `targetFen`.
 * Opening drill rows are deduped across games, so the drill's game may
 * reach the position by a different move order — any order is fine, it is
 * the user's own game. Null when the game never reaches it in the opening
 * window, or when the target is the start position (nothing to play out).
 */
export function introLineTo(positions: LinePosition[], targetFen: string): IntroLine | null {
  const target = bookEpd(targetFen);
  const limit = Math.min(positions.length, MAX_INTRO_PLIES + 1);
  for (let i = 1; i < limit; i++) {
    if (bookEpd(positions[i].fen) !== target) continue;
    const fens: string[] = [];
    const lastMoves: ([string, string] | null)[] = [];
    for (let j = 0; j <= i; j++) {
      fens.push(positions[j].fen);
      const prev = j > 0 ? positions[j - 1].uciMove : null;
      if (!prev) {
        lastMoves.push(null);
        continue;
      }
      const m = parseUciMove(prev);
      lastMoves.push([m.from, m.to]);
    }
    return { fens, lastMoves };
  }
  return null;
}

/** The first move in a game where the user played something other than their repertoire move. */
export interface RepertoireExit {
  ply: number;
  fenBefore: string;
  playedSan: string;
  playedUci: string;
  expected: RepertoireMove;
}

/**
 * Walk the user's moves (as `color`) through the opening window and return
 * the first one that differs from the repertoire move saved for that
 * position. Positions with no saved move are skipped.
 */
export function findRepertoireExit(
  positions: LinePosition[],
  color: 'white' | 'black',
  repertoire: RepertoireMap,
  maxPlies = MAX_INTRO_PLIES,
): RepertoireExit | null {
  if (repertoire.size === 0) return null;
  const limit = Math.min(positions.length, maxPlies);
  for (let i = 0; i < limit; i++) {
    const p = positions[i];
    if (p.sideToMove !== color || !p.uciMove || !p.sanMove) continue;
    const expected = repertoire.get(`${color}|${bookEpd(p.fen)}`);
    if (!expected) continue;
    if (normalizeUci(expected.uci) === normalizeUci(p.uciMove)) continue;
    return { ply: i, fenBefore: p.fen, playedSan: p.sanMove, playedUci: p.uciMove, expected };
  }
  return null;
}
