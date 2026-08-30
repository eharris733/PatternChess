import { Chess } from 'chess.js';
import { parseUciMove } from './moveUtils';
import type { MovePair } from '../components/MoveSequencePanel';

export interface ReviewMove {
  fenBefore: string;
  san: string;
  uci: string;
}

export function buildLineMoves(initialFen: string, uciList: string[]): ReviewMove[] {
  const out: ReviewMove[] = [];
  let chess: Chess;
  try {
    chess = new Chess(initialFen);
  } catch {
    return out;
  }
  for (const uci of uciList) {
    const m = parseUciMove(uci);
    const fenBefore = chess.fen();
    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!result) break;
    out.push({ fenBefore, san: result.san, uci });
  }
  return out;
}

/**
 * Build the move-pair table for a refutation line: a first move (the original
 * blunder, or the wrong move the user just played) tagged with its grade,
 * followed by the engine's principal variation. Shared by the reviewing-phase
 * refutation, the played-move refutation, and the endgame play-out slip view.
 */
export function buildRefutationPairs(opts: {
  fen: string;
  moveNumber: number;
  sideToMove: string;
  firstSan: string;
  firstUci: string;
  tag?: string;
  contextTags?: string[];
  pvMoves: ReviewMove[];
}): { pairs: MovePair[]; movesPlusFirst: ReviewMove[] } {
  const { fen, moveNumber, sideToMove, firstSan, firstUci, tag, contextTags, pvMoves } = opts;
  const moves: ReviewMove[] = [
    { fenBefore: fen, san: firstSan, uci: firstUci },
    ...pvMoves,
  ];
  const startMoveNum = moveNumber;
  const firstIsWhite = sideToMove === 'white';
  const tagsForFirst = contextTags && contextTags.length > 0 ? contextTags : undefined;

  const pairs: MovePair[] = [];
  if (firstIsWhite) {
    pairs.push({
      moveNumber: startMoveNum,
      white: { san: firstSan, key: 'r0', tag, contextTags: tagsForFirst },
      black: moves[1] ? { san: moves[1].san, key: 'r1' } : undefined,
    });
    for (let i = 2; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: startMoveNum + Math.floor(i / 2),
        white: { san: moves[i].san, key: `r${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `r${i + 1}` } : undefined,
      });
    }
  } else {
    pairs.push({
      moveNumber: startMoveNum,
      white: undefined,
      black: { san: firstSan, key: 'r0', tag, contextTags: tagsForFirst },
    });
    for (let i = 1; i < moves.length; i += 2) {
      pairs.push({
        moveNumber: startMoveNum + Math.floor((i + 1) / 2),
        white: { san: moves[i].san, key: `r${i}` },
        black: moves[i + 1] ? { san: moves[i + 1].san, key: `r${i + 1}` } : undefined,
      });
    }
  }
  return { pairs, movesPlusFirst: moves };
}
