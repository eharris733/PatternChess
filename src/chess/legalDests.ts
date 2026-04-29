import { Chess, type Square } from 'chess.js';

/** Build chessground `dests` map from a FEN: every legal move grouped by origin square. */
export function legalDests(fen: string): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return dests;
  }
  const moves = chess.moves({ verbose: true });
  for (const m of moves) {
    const list = dests.get(m.from) ?? [];
    list.push(m.to);
    dests.set(m.from, list);
  }
  return dests;
}

export function turnColor(fen: string): 'white' | 'black' {
  const fields = fen.split(' ');
  return fields[1] === 'w' ? 'white' : 'black';
}

export function isCheck(fen: string): boolean {
  try {
    const c = new Chess(fen);
    return c.inCheck();
  } catch {
    return false;
  }
}

export type CgKey = Square;
