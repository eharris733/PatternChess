import { Chess } from 'chess.js';
import { moveToUci } from '../chess/moveUtils';

export interface ParsedPosition {
  fen: string;
  sanMove: string | null;
  uciMove: string | null;
  moveNumber: number;
  sideToMove: 'white' | 'black';
}

/**
 * Port of lib/src/services/pgn_parser_service.dart.
 * Returns a list of positions, each annotated with the move played FROM that position.
 * The final element has no `sanMove`/`uciMove` (terminal position).
 */
export function parseGame(pgn: string): ParsedPosition[] {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    return [];
  }
  const moves = chess.history({ verbose: true });

  const replay = new Chess();
  // Apply any starting position from PGN headers (e.g. FEN tag for chess960).
  const headers = chess.header();
  if (headers.FEN) {
    try {
      replay.load(headers.FEN);
    } catch {
      replay.reset();
    }
  } else {
    replay.reset();
  }

  const positions: ParsedPosition[] = [];

  // Apply each move on the replay board BEFORE recording the position so we
  // never emit an entry whose `uciMove` is illegal on its `fen`. chess.js v1
  // throws on illegal moves; if that ever happens (chess960 mismatch, FEN
  // header that didn't load cleanly, exotic PGN annotations), truncate the
  // game rather than desync the replay vs. history cursors.
  let moveNumber = 1;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const fenBefore = replay.fen();
    const sideToMove: 'white' | 'black' = m.color === 'w' ? 'white' : 'black';
    try {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch (err) {
      console.warn('[pgnParser] replay.move failed, truncating game', {
        fenBefore,
        move: { from: m.from, to: m.to, promotion: m.promotion, san: m.san },
        err,
      });
      break;
    }
    positions.push({
      fen: fenBefore,
      sanMove: m.san,
      uciMove: moveToUci(m),
      moveNumber,
      sideToMove,
    });
    if (m.color === 'b') moveNumber++;
  }

  // Add terminal position (no move played)
  const finalSide: 'white' | 'black' = replay.turn() === 'w' ? 'white' : 'black';
  positions.push({
    fen: replay.fen(),
    sanMove: null,
    uciMove: null,
    moveNumber,
    sideToMove: finalSide,
  });

  return positions;
}

/** Extract `[Tag "value"]` headers from a PGN string. */
export function extractHeaders(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

/**
 * Extract the per-ply clock readings (centiseconds remaining after each ply).
 * Returns null if the PGN has no `%clk` annotations (Chess.com daily, casual
 * Lichess, etc.). Both `H:MM:SS` and `H:MM:SS.t` formats are accepted.
 */
export function extractClockPerPly(pgn: string): number[] | null {
  const re = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d))?\]/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn)) !== null) {
    const hours = Number.parseInt(m[1], 10);
    const minutes = Number.parseInt(m[2], 10);
    const seconds = Number.parseInt(m[3], 10);
    const tenths = m[4] ? Number.parseInt(m[4], 10) : 0;
    out.push(hours * 360000 + minutes * 6000 + seconds * 100 + tenths * 10);
  }
  return out.length === 0 ? null : out;
}

export interface ParsedGameMetadata {
  eco: string | null;
  openingName: string | null;
  userColor: 'white' | 'black' | null;
  userRating: number | null;
  opponentRating: number | null;
  clockPerPly: number[] | null;
  totalPlies: number | null;
}

function parseElo(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract every metadata field needed for v1 insights from a stored PGN string.
 * Falls back gracefully (NULL fields) when the PGN omits headers or clocks.
 * `colorFallback` is used when the username doesn't match the White/Black
 * headers (e.g. an upload-time override, or a previously stored color during
 * backfill) so a known color is never erased by a failed name match.
 */
export function parsePgnMetadata(
  pgn: string,
  username: string | null,
  colorFallback: 'white' | 'black' | null = null,
): ParsedGameMetadata {
  const headers = extractHeaders(pgn);
  const eco = headers.ECO?.trim() || null;
  const openingName = headers.Opening?.trim() || headers.Variation?.trim() || null;

  let userColor: 'white' | 'black' | null = null;
  if (username) {
    const lower = username.toLowerCase();
    if (headers.White?.toLowerCase() === lower) userColor = 'white';
    else if (headers.Black?.toLowerCase() === lower) userColor = 'black';
  }
  if (!userColor) userColor = colorFallback;

  const whiteElo = parseElo(headers.WhiteElo);
  const blackElo = parseElo(headers.BlackElo);
  const userRating =
    userColor === 'white' ? whiteElo : userColor === 'black' ? blackElo : null;
  const opponentRating =
    userColor === 'white' ? blackElo : userColor === 'black' ? whiteElo : null;

  const clockPerPly = extractClockPerPly(pgn);

  let totalPlies: number | null = null;
  try {
    const positions = parseGame(pgn);
    totalPlies = positions.length > 0 ? positions.length - 1 : 0;
  } catch {
    totalPlies = null;
  }

  return {
    eco,
    openingName,
    userColor,
    userRating,
    opponentRating,
    clockPerPly,
    totalPlies,
  };
}
