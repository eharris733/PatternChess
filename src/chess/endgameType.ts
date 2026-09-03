import { bishopSquareColors, pieceCounts, type PieceCounts } from './material';

/**
 * Coarse endgame family from the material on the board (kings and pawns
 * ignored). Drives the grouping on the Endgames tab. Client-side only — no
 * column, derived from the start FEN on demand.
 */
export type EndgameType =
  | 'pawn'
  | 'rook'
  | 'minor'
  | 'queen'
  | 'rook-minor'
  | 'queen-minor'
  | 'mixed';

/** Section order on the Endgames tab. */
export const ENDGAME_TYPE_ORDER: readonly EndgameType[] = [
  'pawn',
  'rook',
  'minor',
  'queen',
  'rook-minor',
  'queen-minor',
  'mixed',
];

/**
 * UI text for each family — the ONLY place these labels live (same rule as
 * SR_BUCKET_LABEL / MOTIF_LABEL: components import, never invent).
 */
export const ENDGAME_TYPE_LABEL: Record<EndgameType, string> = {
  pawn: 'Pawn endgames',
  rook: 'Rook endgames',
  minor: 'Minor-piece endgames',
  queen: 'Queen endgames',
  'rook-minor': 'Rook + minor piece',
  'queen-minor': 'Queen + minor piece',
  mixed: 'Mixed endgames',
};

function has(c: PieceCounts, k: keyof PieceCounts): boolean {
  return c[k] > 0;
}

export function classifyEndgameType(fen: string): EndgameType {
  const { white, black } = pieceCounts(fen);
  const queen = has(white, 'q') || has(black, 'q');
  const rook = has(white, 'r') || has(black, 'r');
  const minor = has(white, 'n') || has(black, 'n') || has(white, 'b') || has(black, 'b');

  if (!queen && !rook && !minor) return 'pawn';
  if (queen && rook) return 'mixed';
  if (queen) return minor ? 'queen-minor' : 'queen';
  if (rook) return minor ? 'rook-minor' : 'rook';
  return 'minor';
}

/**
 * Exactly one bishop each, on opposite square colours, and no other pieces
 * (pawns allowed) — the classic "drawish even a pawn or two down" family.
 */
export function isOppositeColoredBishops(fen: string): boolean {
  const { white, black } = pieceCounts(fen);
  const onlyBishop = (c: PieceCounts) => c.b === 1 && c.n === 0 && c.r === 0 && c.q === 0;
  if (!onlyBishop(white) || !onlyBishop(black)) return false;
  const colors = bishopSquareColors(fen);
  return colors.white[0] !== colors.black[0];
}
