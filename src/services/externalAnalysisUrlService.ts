import { Chess } from 'chess.js';
import { extractHeaders } from './pgnParserService';
import type { GameRecord } from '../models/gameRecord';
import { parseUciMove } from '../chess/moveUtils';

const CASTLING_NORMALIZE: Record<string, string> = {
  e1a1: 'e1c1',
  e1h1: 'e1g1',
  e8a8: 'e8c8',
  e8h8: 'e8g8',
};

export type ExternalPlatform = 'lichess' | 'chess.com';

export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
}

export function chesscomAnalysisUrl(fen: string): string {
  return `https://www.chess.com/analysis?tab=analysis&fen=${encodeURIComponent(fen)}`;
}

/**
 * Build a small PGN with a [SetUp]/[FEN] header at `startFen` and the given
 * UCI moves as the main line. Returns null if any move fails to apply (so the
 * caller can fall back to a plain FEN URL).
 */
export function buildPgnFromUciMoves(startFen: string, uciMoves: string[]): string | null {
  const chess = new Chess(startFen);
  const sans: string[] = [];
  for (const uci of uciMoves) {
    const normalized = CASTLING_NORMALIZE[uci] ?? uci;
    const parsed = parseUciMove(normalized);
    const result = chess.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion });
    if (!result) return null;
    sans.push(result.san);
  }
  const fullmoveStart = Number.parseInt(startFen.split(' ')[5] ?? '1', 10);
  const startsWithWhite = startFen.split(' ')[1] === 'w';
  const tokens: string[] = [];
  let moveNumber = Number.isFinite(fullmoveStart) ? fullmoveStart : 1;
  let whiteToMove = startsWithWhite;
  for (let i = 0; i < sans.length; i++) {
    if (whiteToMove) {
      tokens.push(`${moveNumber}. ${sans[i]}`);
    } else if (i === 0) {
      tokens.push(`${moveNumber}... ${sans[i]}`);
    } else {
      tokens.push(sans[i]);
    }
    if (!whiteToMove) moveNumber++;
    whiteToMove = !whiteToMove;
  }
  return `[SetUp "1"]\n[FEN "${startFen}"]\n\n${tokens.join(' ')}`;
}

export function lichessAnalysisPgnUrl(pgn: string): string {
  return `https://lichess.org/analysis/pgn/${encodeURIComponent(pgn)}`;
}

export function chesscomAnalysisPgnUrl(pgn: string): string {
  return `https://www.chess.com/analysis?tab=analysis&pgn=${encodeURIComponent(pgn)}`;
}

export function externalAnalysisUrl(
  platform: ExternalPlatform,
  fen: string,
  options?: { startFen?: string; movesFromStart?: string[] },
): { url: string; label: string } {
  const label = platform === 'lichess' ? 'Open on lichess' : 'Open on chess.com';
  const moves = options?.movesFromStart ?? [];
  const startFen = options?.startFen;
  if (startFen && moves.length > 0) {
    const pgn = buildPgnFromUciMoves(startFen, moves);
    if (pgn) {
      const url = platform === 'lichess' ? lichessAnalysisPgnUrl(pgn) : chesscomAnalysisPgnUrl(pgn);
      return { url, label };
    }
  }
  const url = platform === 'lichess' ? lichessAnalysisUrl(fen) : chesscomAnalysisUrl(fen);
  return { url, label };
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
