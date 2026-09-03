// Pure FEN material helpers — string parsing only, no chess.js, so they're
// cheap enough to run over every scenario card and every play-out move.

export type PieceLetter = 'p' | 'n' | 'b' | 'r' | 'q';
export type PieceCounts = Record<PieceLetter, number>;
export type SquareColor = 'light' | 'dark';

export interface MaterialSides<T> {
  white: T;
  black: T;
}

const EMPTY: PieceCounts = { p: 0, n: 0, b: 0, r: 0, q: 0 };

function isPieceLetter(c: string): c is PieceLetter {
  return c === 'p' || c === 'n' || c === 'b' || c === 'r' || c === 'q';
}

/** Walks the board field of a FEN, yielding each non-king piece with its square. */
function* pieces(fen: string): Generator<{ piece: PieceLetter; white: boolean; file: number; rank: number }> {
  const board = fen.split(' ')[0] ?? '';
  let rank = 8;
  let file = 0;
  for (const ch of board) {
    if (ch === '/') {
      rank -= 1;
      file = 0;
      continue;
    }
    if (ch >= '1' && ch <= '8') {
      file += Number(ch);
      continue;
    }
    const lower = ch.toLowerCase();
    if (isPieceLetter(lower)) {
      yield { piece: lower, white: ch !== lower, file, rank };
    }
    file += 1;
  }
}

/** Non-king piece counts per side. */
export function pieceCounts(fen: string): MaterialSides<PieceCounts> {
  const white = { ...EMPTY };
  const black = { ...EMPTY };
  for (const p of pieces(fen)) (p.white ? white : black)[p.piece] += 1;
  return { white, black };
}

/** Square colour of every bishop, per side (a1 is dark). */
export function bishopSquareColors(fen: string): MaterialSides<SquareColor[]> {
  const out: MaterialSides<SquareColor[]> = { white: [], black: [] };
  for (const p of pieces(fen)) {
    if (p.piece !== 'b') continue;
    const color: SquareColor = (p.file + p.rank) % 2 === 1 ? 'dark' : 'light';
    out[p.white ? 'white' : 'black'].push(color);
  }
  return out;
}

/** Plies since the last pawn move or capture (FEN field 5); 0 when malformed. */
export function halfmoveClock(fen: string): number {
  const n = Number.parseInt(fen.split(' ')[4] ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Total non-king pieces (pawns included) for one side. */
export function totalPieces(counts: PieceCounts): number {
  return counts.p + counts.n + counts.b + counts.r + counts.q;
}
