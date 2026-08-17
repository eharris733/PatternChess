import { Chess } from 'chess.js';
import { RepertoireMove } from '../models/repertoire';
import { PositionStats } from './positionFrequencyService';
import { epdToFen, parseUciMove, toEpd } from '../chess/moveUtils';
import type { ExplorerMove, ExplorerResult } from './openingExplorerService';

export interface BuilderQueueItem {
  epd: string;
  fen: string;
  /** One UCI path from the start position that reaches this node (breadcrumb). */
  line: string[];
  /** Times the user actually reached this position (frequency index). */
  total: number;
}

function applyUciToFen(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = parseUciMove(uci);
    const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    return r ? chess.fen() : null;
  } catch {
    return null;
  }
}

/**
 * The guided-builder work list: own-side positions the user actually reaches,
 * most frequent first, that (a) have no repertoire move yet and (b) are
 * reachable through the current repertoire — own nodes follow the stored move,
 * opponent nodes branch over every reply observed in the user's games. Covered
 * nodes are walked through, not listed; an uncovered own node is a decision
 * point and is not expanded past.
 *
 * For a fresh repertoire this naturally starts at move one and works outward
 * as picks are made — the queue is recomputed after every pick.
 */
export function buildGuidedQueue(opts: {
  color: 'white' | 'black';
  repertoire: Map<string, RepertoireMove>;
  stats: Map<string, PositionStats>;
  minOccurrences?: number;
}): BuilderQueueItem[] {
  const { color, repertoire, stats } = opts;
  const startFen = new Chess().fen();
  const visited = new Set<string>();
  const found = new Map<string, BuilderQueueItem>();
  const frontier: Array<{ fen: string; line: string[] }> = [{ fen: startFen, line: [] }];

  while (frontier.length > 0) {
    const node = frontier.shift()!;
    const epd = toEpd(node.fen);
    if (visited.has(epd)) continue;
    visited.add(epd);

    const sideToMove = node.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    if (sideToMove === color) {
      const chosen = repertoire.get(epd);
      if (chosen) {
        const next = applyUciToFen(node.fen, chosen.uci);
        if (next) frontier.push({ fen: next, line: [...node.line, chosen.uci] });
      } else {
        found.set(epd, {
          epd,
          fen: node.fen,
          line: node.line,
          total: stats.get(epd)?.total ?? 0,
        });
      }
    } else {
      const replies = stats.get(epd)?.opponentMoves;
      if (replies) {
        for (const uci of replies.keys()) {
          const next = applyUciToFen(node.fen, uci);
          if (next) frontier.push({ fen: next, line: [...node.line, uci] });
        }
      }
    }
  }

  const min = opts.minOccurrences ?? 3;
  const all = [...found.values()].sort((a, b) => b.total - a.total);
  const frequent = all.filter((i) => i.total >= min);
  // Thin game libraries: better to guide through rarely-seen positions than
  // to show an empty builder.
  return frequent.length > 0 ? frequent : all.filter((i) => i.total >= 1 || i.line.length === 0);
}

/** Weighted-random explorer move by game count. Null when the book is empty. */
export function weightedExplorerMove(
  result: ExplorerResult,
  rng: () => number = Math.random,
): ExplorerMove | null {
  const weights = result.moves.map((m) => m.white + m.draws + m.black);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return null;
  let roll = rng() * totalWeight;
  for (let i = 0; i < result.moves.length; i++) {
    roll -= weights[i];
    if (roll < 0) return result.moves[i];
  }
  return result.moves[result.moves.length - 1] ?? null;
}

/** Re-derive a display FEN for a queue item (counters are irrelevant to play). */
export function queueItemFen(item: BuilderQueueItem): string {
  return item.fen || epdToFen(item.epd);
}
