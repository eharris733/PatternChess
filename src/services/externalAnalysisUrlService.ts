import { extractHeaders } from './pgnParserService';
import type { GameRecord } from '../models/gameRecord';

export type ExternalPlatform = 'lichess' | 'chess.com';

export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
}

export function chesscomAnalysisUrl(fen: string): string {
  return `https://www.chess.com/analysis?tab=analysis&fen=${encodeURIComponent(fen)}`;
}

export function externalAnalysisUrl(
  platform: ExternalPlatform,
  fen: string,
): { url: string; label: string } {
  if (platform === 'lichess') return { url: lichessAnalysisUrl(fen), label: 'Open on lichess' };
  return { url: chesscomAnalysisUrl(fen), label: 'Open on chess.com' };
}

export function resolvePlatform(
  gamePlatform: string | null | undefined,
  fallback: ExternalPlatform | null,
): ExternalPlatform | null {
  if (gamePlatform === 'lichess') return 'lichess';
  if (gamePlatform === 'chess.com') return 'chess.com';
  return fallback;
}

/**
 * Build a URL that opens the played game on the platform's analysis board.
 * Lichess game pages embed their own analysis tools, so the Site header URL
 * works directly. Chess.com exposes a separate analysis route keyed by the
 * game id parsed out of the PGN's Link header.
 */
export function platformGameUrl(game: GameRecord): string | null {
  const headers = extractHeaders(game.pgn);
  if (game.platform === 'lichess') {
    const site = headers.Site;
    if (site && /^https?:\/\/lichess\.org\//i.test(site)) return site;
    return null;
  }
  if (game.platform === 'chess.com') {
    const link = headers.Link;
    if (!link) return null;
    const match = /chess\.com\/game\/(live|daily)\/(\d+)/i.exec(link);
    if (match) {
      return `https://www.chess.com/analysis/game/${match[1]}/${match[2]}?tab=analysis`;
    }
    return link;
  }
  return null;
}
