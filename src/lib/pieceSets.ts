/**
 * Piece sets. `cburnett` ships inside chessground (the default); the others
 * are SVGs bundled under public/pieces/<id>/{wK,…,bP}.svg, each with a
 * licence that permits bundling, recorded in public/pieces/LICENSES.md
 * (never add an AGPL, non-commercial or unknown-licence set).
 *
 * The pick lives in `profiles.piece_set` (NULL = cburnett) and on
 * `<html data-piece-set>` (src/state/pieceSetStore.ts), which the board CSS
 * (src/styles/pieceSets.css) and the share canvas (boardCanvas
 * loadPieceImages) both read. Pure module: the server validates ids with it.
 */

export const PIECE_SETS = ['cburnett', 'chessnut', 'rhosgfx', 'fantasy', 'celtic', 'spatial', 'sticker'] as const;
export type PieceSet = (typeof PIECE_SETS)[number];

export interface PieceSetInfo {
  id: PieceSet;
  label: string;
  author: string;
  licence: string;
}

export const PIECE_SET_INFO: Record<PieceSet, PieceSetInfo> = {
  cburnett: { id: 'cburnett', label: 'Classic', author: 'Colin M.L. Burnett', licence: 'GPLv2+ (via chessground)' },
  chessnut: { id: 'chessnut', label: 'Chessnut', author: 'Alexis Luengas', licence: 'Apache 2.0' },
  rhosgfx: { id: 'rhosgfx', label: 'Vector', author: 'RhosGFX', licence: 'CC0 1.0' },
  fantasy: { id: 'fantasy', label: 'Fantasy', author: 'Maurizio Monge', licence: 'MIT' },
  celtic: { id: 'celtic', label: 'Celtic', author: 'Maurizio Monge', licence: 'MIT' },
  spatial: { id: 'spatial', label: 'Spatial', author: 'Maurizio Monge', licence: 'MIT' },
  // Drawn for PatternChess (scripts/gen-sticker-pieces.py), 2026-11-23.
  sticker: { id: 'sticker', label: 'Sticker', author: 'PatternChess', licence: 'Original' },
};

export const DEFAULT_PIECE_SET: PieceSet = 'cburnett';

export function isPieceSet(v: unknown): v is PieceSet {
  return typeof v === 'string' && (PIECE_SETS as readonly string[]).includes(v);
}

/** Piece keys in chess.js colour+type form, matching the bundled file names (wK.svg, bp → bP.svg). */
export const PIECE_KEYS = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'] as const;

/** URL of one bundled piece SVG (not for cburnett, which comes from chessground's CSS). */
export function pieceUrl(set: Exclude<PieceSet, 'cburnett'>, key: (typeof PIECE_KEYS)[number]): string {
  return `/pieces/${set}/${key}.svg`;
}
