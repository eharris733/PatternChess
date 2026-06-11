import { parsePgnMetadata } from './pgnParserService';
import { supabaseService } from './supabaseService';

export interface BackfillProgress {
  processed: number;
  total: number;
  failed: number;
}

/**
 * One-shot client migration: re-parses every game with `parsed_metadata_at IS NULL`
 * to extract ECO, opening name, color, ratings, clocks, and ply count from the
 * stored PGN. PGNs are not re-fetched from external APIs.
 */
export async function runGameMetadataBackfill(opts?: {
  batchSize?: number;
  onProgress?: (p: BackfillProgress) => void;
}): Promise<BackfillProgress> {
  const batchSize = opts?.batchSize ?? 50;
  let processed = 0;
  let failed = 0;

  const total = await supabaseService.countUnparsedGames();
  opts?.onProgress?.({ processed, total, failed });

  if (total === 0) return { processed, total, failed };

  while (true) {
    const batch = await supabaseService.getUnparsedGames({ limit: batchSize });
    if (batch.length === 0) break;

    const processedBefore = processed;
    for (const game of batch) {
      try {
        // Pass the stored color as fallback so a failed name match (e.g. an
        // upload-time color override) never nulls out user_color.
        const meta = parsePgnMetadata(game.pgn, game.username, game.userColor);
        await supabaseService.updateGameMetadata(game.id, meta);
        processed++;
      } catch {
        failed++;
      }
      opts?.onProgress?.({ processed, total, failed });
    }
    // Bail if a full batch made no progress — prevents infinite loop on
    // persistently failing rows.
    if (processed === processedBefore) break;
  }

  return { processed, total, failed };
}
