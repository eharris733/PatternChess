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

export type BoardOrientation = 'white' | 'black';

// Lichess orients its analysis board to the side to move (FEN route) or white
// (PGN route) unless ?color= overrides it, so always pass the user's color
// when we know it. Chess.com defaults to white and honors flip=true.
export function lichessAnalysisUrl(fen: string, orientation?: BoardOrientation | null): string {
  const base = `https://lichess.org/analysis/standard/${fen.replace(/ /g, '_')}`;
  return orientation ? `${base}?color=${orientation}` : base;
}

export function chesscomAnalysisUrl(fen: string, orientation?: BoardOrientation | null): string {
  const base = `https://www.chess.com/analysis?tab=analysis&fen=${encodeURIComponent(fen)}`;
  return orientation === 'black' ? `${base}&flip=true` : base;
}

/**
 * Build a small PGN with a [SetUp]/[FEN] header at `startFen` and the given
 * UCI moves as the main line. Returns null if any move fails to apply (so the
 * caller can fall back to a plain FEN URL).
 */
export function buildPgnFromUciMoves(startFen: string, uciMoves: string[]): string | null {
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return null;
  }
  const sans: string[] = [];
  for (const uci of uciMoves) {
    const normalized = CASTLING_NORMALIZE[uci] ?? uci;
    const parsed = parseUciMove(normalized);
    let result;
    try {
      result = chess.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion });
    } catch {
      return null;
    }
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

export function lichessAnalysisPgnUrl(pgn: string, orientation?: BoardOrientation | null): string {
  const base = `https://lichess.org/analysis/pgn/${encodeURIComponent(pgn)}`;
  return orientation ? `${base}?color=${orientation}` : base;
}

/**
 * Strip study headers, comments, variations, and NAGs down to the bare
 * mainline so the PGN fits inside Lichess's ~2 KB analysis-URL limit. Annotated
 * study PGNs (Lichess study exports) otherwise encode past that limit and the
 * /analysis/pgn route returns HTTP 400. Returns null if the PGN can't be parsed.
 */
export function cleanPgnForAnalysisUrl(pgn: string): string | null {
  try {
    const src = new Chess();
    src.loadPgn(pgn); // tolerant of comments/variations/NAGs
    const startFen = extractHeaders(pgn).FEN; // preserve non-standard chapter starts
    const dst = startFen ? new Chess(startFen) : new Chess();
    for (const san of src.history()) dst.move(san);
    return dst.pgn(); // includes [SetUp]/[FEN] when the start is non-standard
  } catch {
    return null;
  }
}

export function chesscomAnalysisPgnUrl(pgn: string, orientation?: BoardOrientation | null): string {
  const base = `https://www.chess.com/analysis?tab=analysis&pgn=${encodeURIComponent(pgn)}`;
  return orientation === 'black' ? `${base}&flip=true` : base;
}

export function externalAnalysisUrl(
  platform: ExternalPlatform,
  fen: string,
  options?: {
    startFen?: string;
    movesFromStart?: string[];
    orientation?: BoardOrientation | null;
  },
): { url: string; label: string } {
  const label = platform === 'lichess' ? 'Open on lichess' : 'Open on chess.com';
  const moves = options?.movesFromStart ?? [];
  const startFen = options?.startFen;
  const orientation = options?.orientation;
  if (startFen && moves.length > 0) {
    const pgn = buildPgnFromUciMoves(startFen, moves);
    if (pgn) {
      const url =
        platform === 'lichess'
          ? lichessAnalysisPgnUrl(pgn, orientation)
          : chesscomAnalysisPgnUrl(pgn, orientation);
      return { url, label };
    }
  }
  const url =
    platform === 'lichess'
      ? lichessAnalysisUrl(fen, orientation)
      : chesscomAnalysisUrl(fen, orientation);
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
    if (site && /^https?:\/\/lichess\.org\//i.test(site)) {
      // Bare game URLs accept a /black suffix to orient the board.
      if (game.userColor === 'black' && /^https?:\/\/lichess\.org\/[A-Za-z0-9]+$/i.test(site)) {
        return `${site}/black`;
      }
      return site;
    }
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
  // PGN uploads (or anything else without a platform-native link) fall back
  // to opening the full PGN in Lichess's analysis board.
  if (game.pgn) {
    const clean = cleanPgnForAnalysisUrl(game.pgn);
    return lichessAnalysisPgnUrl(clean ?? game.pgn, game.userColor);
  }
  return null;
}
