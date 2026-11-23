import { extractHeaders } from '../../services/pgnParserService';
import { resolveOutcome, type GameOutcome } from '../../models/gameRecord';
import type { GameRecord } from '../../models/gameRecord';
import type { Blunder } from '../../models/blunder';
import { fenSideToMove } from '../../chess/moveUtils';
import type { MessageKey } from '../../i18n/i18n';

export type Outcome = GameOutcome;

export type BlunderFilter = 'all' | 'min1' | 'min2' | 'min3' | 'clean' | 'unanalyzed';
export type ResultFilter = 'all' | 'win' | 'loss' | 'draw';
export type SortOrder = 'newest' | 'oldest' | 'blunders';

export const BLUNDER_FILTERS: Array<{ key: BlunderFilter; label: MessageKey }> = [
  { key: 'all', label: 'vault.games.filter.all' },
  { key: 'min1', label: 'vault.games.filter.min1' },
  { key: 'min2', label: 'vault.games.filter.min2' },
  { key: 'min3', label: 'vault.games.filter.min3' },
  { key: 'clean', label: 'vault.games.filter.clean' },
  { key: 'unanalyzed', label: 'vault.games.filter.unanalyzed' },
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
