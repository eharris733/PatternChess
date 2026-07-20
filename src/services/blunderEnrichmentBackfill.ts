import { Chess } from 'chess.js';
import { detectMotifs } from '../chess/motifs';
import { CASTLING_NORMALIZE, parseUciMove } from '../chess/moveUtils';
import { getAnalysisStockfish } from '../hooks/useStockfish';
import { queryClient } from '../lib/queryClient';
import type { Blunder } from '../models/blunder';
import { supabaseService } from './supabaseService';

export interface EnrichmentProgress {
  enriched: number;
  remaining: number;
}

const BATCH_SIZE = 5;
/** Pause between rows so the tab stays responsive while the user reads the dashboard. */
const ROW_DELAY_MS = 1500;

let running = false;

/**
 * Lazy enrichment of legacy blunder rows (created before solution_line/motifs
 * existed): re-evaluates the stored position and the played move at the same
 * depth as game analysis, then persists the PVs and motif tags. Started while
 * the user sits on the dashboard and stopped when they leave, so the engine is
 * never busy when training or review needs it. New analyses are enriched
 * inline and never reach this path.
 */
export function startBlunderEnrichment(
  onProgress?: (p: EnrichmentProgress) => void,
): () => void {
  if (running) return () => {};
  running = true;
  let stopped = false;

  const stop = () => {
    stopped = true;
    running = false;
  };

  void (async () => {
    try {
      let remaining = await supabaseService.countUnenrichedBlunders();
      if (remaining === 0) return;
      const sf = await getAnalysisStockfish();
      let enriched = 0;

      while (!stopped && remaining > 0) {
        const batch = await supabaseService.getUnenrichedBlunders({ limit: BATCH_SIZE });
        if (batch.length === 0) break;

        for (const blunder of batch) {
          if (stopped) return;
          try {
            await enrichOne(sf, blunder);
            enriched++;
            remaining--;
            onProgress?.({ enriched, remaining });
          } catch (err) {
            console.warn('[enrichment] failed for blunder', blunder.id, err);
            // Tombstone the row (empty line parses back to null, keeping the
            // single-move drill) so it leaves the unenriched set instead of
            // stalling the backfill at the head of every future batch.
            try {
              await supabaseService.updateBlunderEnrichment(blunder.id, {
                solution_line: { pv: [], playedPv: [], v: 1 },
                motifs: [],
              });
              remaining--;
            } catch {
              return; // storage itself is failing — retry on a future visit
            }
          }
          await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
        }
        void queryClient.invalidateQueries({ queryKey: ['insights', 'motifs'] });
      }
    } catch (err) {
      console.warn('[enrichment] backfill stopped', err);
    } finally {
      running = false;
    }
  })();

  return stop;
}

async function enrichOne(
  sf: Awaited<ReturnType<typeof getAnalysisStockfish>>,
  blunder: Blunder,
): Promise<void> {
  const best = await sf.evaluatePositionFull(blunder.fen, 12, 10);

  const chess = new Chess(blunder.fen);
  const std = CASTLING_NORMALIZE[blunder.playedMove] ?? blunder.playedMove;
  const m = parseUciMove(std);
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  const played = await sf.evaluatePositionFull(chess.fen(), 12, 10);

  const solution_line = {
    pv: best.principalVariation,
    playedPv: played.principalVariation,
    v: 1 as const,
  };
  const motifs = detectMotifs({
    fen: blunder.fen,
    playedMove: blunder.playedMove,
    solutionPv: best.principalVariation,
    playedRefutationPv: played.principalVariation,
    evalBefore: blunder.evalBefore,
    evalAfter: blunder.evalAfter,
  });
  await supabaseService.updateBlunderEnrichment(blunder.id, { solution_line, motifs });
}
