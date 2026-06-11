import { getAnalysisStockfish } from '../hooks/useStockfish';
import { derivePhase } from '../models/blunder';
import type {
  BlunderCandidate,
  StockfishWorkerClient,
} from '../stockfish/stockfishWorkerClient';
import {
  extractHeaders,
  parseGame,
  parsePgnMetadata,
  type ParsedPosition,
} from './pgnParserService';
import { supabaseService } from './supabaseService';

export interface AnalysisProgress {
  gameIndex: number;
  gamesTotal: number;
  positionIndex: number;
  positionsTotal: number;
  blundersFound: number;
}

export interface PgnAnalysisResult {
  blunders: BlunderCandidate[];
  positions: ParsedPosition[];
  headers: ReturnType<typeof extractHeaders>;
  playerSide: 'white' | 'black' | null;
}

/**
 * Canonical per-PGN blunder analysis. Both the signed-in sync path
 * (`analyzeGames`) and the public landing-page demo route through this so the
 * pipeline (PGN → parse → playerSide → Stockfish depth-12 → 15% threshold)
 * stays bit-identical. The caller supplies the engine handle so the UI engine
 * and the background analysis engine can each be used in the right context.
 */
export async function analyzePgn(
  sf: StockfishWorkerClient,
  pgn: string,
  username: string | null,
  opts: {
    onProgress?: (current: number, total: number) => void;
    maxPlies?: number;
    /**
     * Side to analyze when the username doesn't match the White/Black headers
     * (e.g. an upload-time color override). Without it, unmatched games get
     * both sides' blunders.
     */
    playerSideFallback?: 'white' | 'black' | null;
  } = {},
): Promise<PgnAnalysisResult> {
  const headers = extractHeaders(pgn);
  const allPositions = parseGame(pgn);
  const positions =
    opts.maxPlies != null
      ? allPositions.slice(0, opts.maxPlies + 1)
      : allPositions;
  const lower = username?.toLowerCase();
  const playerSide: 'white' | 'black' | null =
    (lower && headers.White?.toLowerCase() === lower
      ? 'white'
      : lower && headers.Black?.toLowerCase() === lower
        ? 'black'
        : null) ?? opts.playerSideFallback ?? null;
  const blunders = await sf.analyzeGame(positions, {
    depth: 12,
    playerSide,
    onProgress: opts.onProgress,
  });
  return { blunders, positions, headers, playerSide };
}

export async function analyzeGames(
  gameIds: string[],
  fallbackUsername: string | null,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<{ blundersFound: number }> {
  if (gameIds.length === 0) return { blundersFound: 0 };
  const sf = await getAnalysisStockfish();
  let blundersFound = 0;

  for (let i = 0; i < gameIds.length; i++) {
    const game = await supabaseService.getGame(gameIds[i]);
    const username = game.username || fallbackUsername || null;

    const { blunders } = await analyzePgn(sf, game.pgn, username, {
      // The stored color is authoritative when name matching fails — it carries
      // the upload-time override (and a header match set it at insert anyway).
      playerSideFallback: game.userColor,
      onProgress: (cur, total) =>
        onProgress?.({
          gameIndex: i,
          gamesTotal: gameIds.length,
          positionIndex: cur,
          positionsTotal: total,
          blundersFound,
        }),
    });

    if (blunders.length > 0) {
      await supabaseService.insertBlunders(
        blunders.map((b) => ({
          game_id: game.id,
          fen: b.fen,
          move_number: b.moveNumber,
          played_move: b.playedMove,
          correct_moves: b.correctMoves,
          eval_before: b.evalBefore,
          eval_after: b.evalAfter,
          eval_swing: b.evalSwing,
          side_to_move: b.sideToMove,
          phase: derivePhase(b.moveNumber, b.fen),
        })),
      );
      blundersFound += blunders.length;
    }

    // Stamp PGN-derived metadata if we haven't already (cheap, runs once per game).
    if (!game.parsedMetadataAt) {
      const meta = parsePgnMetadata(game.pgn, game.username || fallbackUsername, game.userColor);
      try {
        await supabaseService.updateGameMetadata(game.id, meta);
      } catch {
        /* metadata enrichment is best-effort */
      }
    }

    await supabaseService.markGameAnalyzed(game.id);
  }

  onProgress?.({
    gameIndex: gameIds.length,
    gamesTotal: gameIds.length,
    positionIndex: 0,
    positionsTotal: 0,
    blundersFound,
  });

  return { blundersFound };
}
