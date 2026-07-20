import { Chess } from 'chess.js';

// Some PGN/UCI sources encode castling as "king-to-rook-square" (e.g. e8a8 / e1h1)
// instead of standard "king-to-destination" (e8c8 / e1g1). chess.js v1 throws on
// the rook-square form, so map known cases before parsing.
export const CASTLING_NORMALIZE: Record<string, string> = {
  e1a1: 'e1c1',
  e1h1: 'e1g1',
  e8a8: 'e8c8',
  e8h8: 'e8g8',
};

export interface UciMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export function parseUciMove(uci: string): UciMove {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
  return { from, to, promotion: promo };
}

export function moveToUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/** SAN of a UCI move played from a given FEN. Returns null on illegal move. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = parseUciMove(uci);
    const result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    return result?.san ?? null;
  } catch {
    return null;
  }
}

/** Side to move from a FEN ('w' / 'b' field). */
export function fenSideToMove(fen: string): 'white' | 'black' {
  const fields = fen.split(' ');
  return fields[1] === 'w' ? 'white' : 'black';
}
