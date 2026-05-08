import { getAnalysisStockfish } from '../hooks/useStockfish';
import { derivePhase } from '../models/blunder';
import { extractHeaders, parseGame, parsePgnMetadata } from './pgnParserService';
import { supabaseService } from './supabaseService';

export interface AnalysisProgress {
  gameIndex: number;
  gamesTotal: number;
  positionIndex: number;
  positionsTotal: number;
  blundersFound: number;
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
    const positions = parseGame(game.pgn);
    const headers = extractHeaders(game.pgn);
    const username = game.username || fallbackUsername || '';
    const playerSide: 'white' | 'black' | null =
      headers.White?.toLowerCase() === username.toLowerCase()
        ? 'white'
        : headers.Black?.toLowerCase() === username.toLowerCase()
          ? 'black'
          : null;

    onProgress?.({
      gameIndex: i,
      gamesTotal: gameIds.length,
      positionIndex: 0,
      positionsTotal: positions.length,
      blundersFound,
    });

    const blunders = await sf.analyzeGame(positions, {
      depth: 12,
      playerSide,
      onProgress: (cur) =>
        onProgress?.({
          gameIndex: i,
          gamesTotal: gameIds.length,
          positionIndex: cur,
          positionsTotal: positions.length,
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
      const meta = parsePgnMetadata(game.pgn, game.username || fallbackUsername);
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
