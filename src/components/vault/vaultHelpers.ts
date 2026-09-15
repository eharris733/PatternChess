import { extractHeaders } from '../../services/pgnParserService';
import { resolveOutcome, type GameOutcome } from '../../models/gameRecord';
import type { GameRecord } from '../../models/gameRecord';
import type { Blunder } from '../../models/blunder';
import { fenSideToMove } from '../../chess/moveUtils';

export type Outcome = GameOutcome;

export type BlunderFilter = 'all' | 'min1' | 'min2' | 'min3' | 'clean' | 'unanalyzed';
export type ResultFilter = 'all' | 'win' | 'loss' | 'draw';
export type SortOrder = 'newest' | 'oldest' | 'blunders';

export const BLUNDER_FILTERS: Array<{ key: BlunderFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'min1', label: 'Has blunders' },
  { key: 'min2', label: '2+' },
  { key: 'min3', label: '3+' },
  { key: 'clean', label: 'No blunders' },
  { key: 'unanalyzed', label: 'Not analyzed' },
];

export function gameOutcome(game: GameRecord): Outcome | null {
  // Prefer the stored color; fall back to PGN headers for older rows where
  // user_color was never parsed. The list query omits `pgn`, so this fallback
  // only fires for a single full-row fetch; legacy null-color rows have been
  // backfilled server-side, so `game.pgn` is normally empty here.
  let color = game.userColor;
  if (!color && game.pgn && (game.platform === 'lichess' || game.platform === 'pgn')) {
    const isWhite =
      extractHeaders(game.pgn).White?.toLowerCase() === game.username.toLowerCase();
    color = isWhite ? 'white' : 'black';
  }
  return resolveOutcome(game.platform, game.result, color);
}

export function matchesBlunderFilter(
  filter: BlunderFilter,
  game: GameRecord,
  count: number,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'min1':
      return !!game.analyzedAt && count >= 1;
    case 'min2':
      return !!game.analyzedAt && count >= 2;
    case 'min3':
      return !!game.analyzedAt && count >= 3;
    case 'clean':
      return !!game.analyzedAt && count === 0;
    case 'unanalyzed':
      return !game.analyzedAt;
  }
}

export function gameSortTime(g: GameRecord): number {
  return (g.playedAt ?? g.createdAt).getTime();
}

/** The blunder positions are the user's mistakes, so the side to move is the user. */
export function blunderOrientation(game: GameRecord, blunder: Blunder): 'white' | 'black' {
  return game.userColor ?? fenSideToMove(blunder.fen);
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
