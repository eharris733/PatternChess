import { Chess } from 'chess.js';

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
