import { Chess } from 'chess.js';
import { detectMotifs } from '../chess/motifs';
import { CASTLING_NORMALIZE, parseUciMove } from '../chess/moveUtils';
import { winningChancesLost } from '../chess/winningChances';
import { getAnalysisStockfish } from '../hooks/useStockfish';
import { queryClient } from '../lib/queryClient';
import type { Blunder, CorrectMove } from '../models/blunder';
import type { PositionEval } from '../stockfish/stockfishWorkerClient';
import { supabaseService } from './supabaseService';

export interface MaintenanceProgress {
  /** Legacy rows that got their first solution_line/motifs. */
  enriched: number;
  /** Rows re-analyzed with the timed budget. */
  deepened: number;
  remaining: number;
}

const BATCH_SIZE = 5;
/** Pause between rows so the tab stays responsive while the user reads the dashboard. */
const ROW_DELAY_MS = 1500;
/**
 * Thinking time per position for the background re-analysis. Time-based on
 * purpose: a fixed depth means very different search quality across phases
 * (depth 12 is far short of the horizon in an endgame), while a fixed budget
 * gives every position the same honest look. The depth actually reached is
 * recorded on the row as metadata.
 */
const DEEPEN_MOVETIME_MS = 3000;
/** Longer pause after deepening rows — each one costs ~2×3s of engine time. */
const DEEPEN_ROW_DELAY_MS = 4000;
/**
 * Retire rows the deeper pass says weren't really blunders. Hysteresis below
 * the 15% trainable bar so borderline rows don't flap in and out of the queue.
 */
const RETIRE_THRESHOLD = 10;

let running = false;

/**
 * Dashboard-only background maintenance over the user's blunder rows, two
 * phases per run:
 *
 * 1. Enrichment — legacy rows with no solution_line get PVs + motif tags.
 * 2. Deepening — every row's evals/PV started life as a fast depth-12 sync
 *    estimate (or an 800ms endgame-slip eval); re-analyze both positions at
 *    DEEPEN_MOVETIME_MS, rewrite the row, and stamp deepened_at. Rows whose
 *    deeper eval shows <RETIRE_THRESHOLD% chances lost are retired (hidden
 *    from the due queue, kept in Vault/stats).
 *
 * Runs only while the user sits on the dashboard and stops when they leave, so
 * the engine is never busy when training or review needs it, and exits while a
 * sync is analyzing games (both share the analysis singleton's command queue —
 * interleaving would slow onboarding).
 */
export function startBlunderMaintenance(
  onProgress?: (p: MaintenanceProgress) => void,
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
      const syncBusy = async () => (await supabaseService.countUnanalyzedGames()) > 0;
      if (await syncBusy()) return;

      let enriched = 0;
      let deepened = 0;
      // Per-session skip list for rows whose deepening keeps failing — their
      // existing data is still valid, so no DB tombstone; just don't let them
      // wedge the head of every batch until the next visit.
      const skip = new Set<string>();
      let remaining =
        (await supabaseService.countUnenrichedBlunders()) +
        (await supabaseService.countBlundersForDeepening());
      if (remaining === 0) return;
      const sf = await getAnalysisStockfish();

      // Phase 1 — enrichment.
      while (!stopped) {
        const batch = await supabaseService.getUnenrichedBlunders({ limit: BATCH_SIZE });
        if (batch.length === 0) break;

        for (const blunder of batch) {
          if (stopped) return;
          try {
            await enrichOne(sf, blunder);
            enriched++;
            remaining--;
            onProgress?.({ enriched, deepened, remaining });
          } catch (err) {
            console.warn('[maintenance] enrichment failed for blunder', blunder.id, err);
            // Tombstone the row (empty line parses back to null, keeping the
            // single-move drill) so it leaves the unenriched set instead of
            // stalling the backfill at the head of every future batch.
            try {
              await supabaseService.updateBlunderEnrichment(blunder.id, {
                solution_line: { pv: [], playedPv: [], v: 1 },
                motifs: [],
                deepened_at: new Date().toISOString(),
              });
              remaining--;
            } catch {
              return; // storage itself is failing — retry on a future visit
            }
          }
          await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
        }
        void queryClient.invalidateQueries({ queryKey: ['insights', 'motifs'] });
        if (await syncBusy()) return;
      }

      // Phase 2 — deepening.
      while (!stopped) {
        const batch = (
          await supabaseService.getBlundersForDeepening({ limit: BATCH_SIZE + skip.size })
        ).filter((b) => !skip.has(b.id));
        if (batch.length === 0) break;

        for (const blunder of batch.slice(0, BATCH_SIZE)) {
          if (stopped) return;
          try {
            await deepenOne(sf, blunder);
            deepened++;
            remaining--;
            onProgress?.({ enriched, deepened, remaining });
          } catch (err) {
            console.warn('[maintenance] deepening failed for blunder', blunder.id, err);
            skip.add(blunder.id);
            remaining--;
          }
          await new Promise((r) => setTimeout(r, DEEPEN_ROW_DELAY_MS));
        }
        void queryClient.invalidateQueries({ queryKey: ['insights', 'motifs'] });
        if (await syncBusy()) return;
      }
    } catch (err) {
      console.warn('[maintenance] worker stopped', err);
    } finally {
      running = false;
    }
  })();

  return stop;
}

function afterPlayedFen(blunder: Blunder): string {
  const chess = new Chess(blunder.fen);
  const std = CASTLING_NORMALIZE[blunder.playedMove] ?? blunder.playedMove;
  const m = parseUciMove(std);
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  return chess.fen();
}

/**
 * New best move first, existing entries after it minus duplicates. Preserves
 * user-accepted alternatives appended by the training accept rule while
 * keeping the `solution_line.pv[0] === correct_moves[0].move` invariant.
 * (Stale evals on retained alternatives are fine — drills check membership;
 * only `[0].eval` is used as the accept bar.)
 */
export function mergeCorrectMoves(
  newBest: CorrectMove,
  existing: CorrectMove[],
): CorrectMove[] {
  return [newBest, ...existing.filter((cm) => cm.move !== newBest.move)];
}

async function enrichOne(
  sf: Awaited<ReturnType<typeof getAnalysisStockfish>>,
  blunder: Blunder,
): Promise<void> {
  const best = await sf.evaluatePositionTimed(blunder.fen, DEEPEN_MOVETIME_MS, 10);
  const played = await sf.evaluatePositionTimed(afterPlayedFen(blunder), DEEPEN_MOVETIME_MS, 10);

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
  await supabaseService.updateBlunderEnrichment(blunder.id, {
    solution_line,
    motifs,
    analysis_depth: achievedDepth(best, played),
    deepened_at: new Date().toISOString(),
  });
}

/** The shallower of the two searches, or null if neither reported a depth. */
function achievedDepth(best: PositionEval, played: PositionEval): number | null {
  if (best.depth == null) return played.depth;
  if (played.depth == null) return best.depth;
  return Math.min(best.depth, played.depth);
}

async function deepenOne(
  sf: Awaited<ReturnType<typeof getAnalysisStockfish>>,
  blunder: Blunder,
): Promise<void> {
  const best = await sf.evaluatePositionTimed(blunder.fen, DEEPEN_MOVETIME_MS, 10);
  // A blunder position always has a legal move, so an empty bestMove means the
  // engine hiccuped — skip the row rather than storing a bogus correct move.
  if (!best.bestMove) throw new Error('engine returned no bestmove');
  const played = await sf.evaluatePositionTimed(afterPlayedFen(blunder), DEEPEN_MOVETIME_MS, 10);
  const chancesLost = winningChancesLost(best.scoreCp, played.scoreCp);

  await supabaseService.updateBlunderDeepening(blunder.id, {
    eval_before: best.scoreCp,
    eval_after: played.scoreCp,
    eval_swing: Math.round(chancesLost),
    correct_moves: mergeCorrectMoves(
      { move: best.bestMove, eval: best.scoreCp },
      blunder.correctMoves,
    ),
    solution_line: {
      pv: best.principalVariation,
      playedPv: played.principalVariation,
      v: 1,
    },
    motifs: detectMotifs({
      fen: blunder.fen,
      playedMove: blunder.playedMove,
      solutionPv: best.principalVariation,
      playedRefutationPv: played.principalVariation,
      evalBefore: best.scoreCp,
      evalAfter: played.scoreCp,
    }),
    analysis_depth: achievedDepth(best, played),
    deepened_at: new Date().toISOString(),
    retired_at: chancesLost < RETIRE_THRESHOLD ? new Date().toISOString() : null,
  });
}
