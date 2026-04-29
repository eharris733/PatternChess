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

  let moveNumber = 1;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const fenBefore = replay.fen();
    const sideToMove: 'white' | 'black' = m.color === 'w' ? 'white' : 'black';
    positions.push({
      fen: fenBefore,
      sanMove: m.san,
      uciMove: moveToUci(m),
      moveNumber,
      sideToMove,
    });
    replay.move({ from: m.from, to: m.to, promotion: m.promotion });
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
