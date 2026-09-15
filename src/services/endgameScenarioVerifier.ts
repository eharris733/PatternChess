import { Chess } from 'chess.js';
import { DRAW_HOLD_PCT } from '../chess/adjudication';
import { winPercent } from '../chess/winningChances';
import { getAnalysisStockfish } from '../hooks/useStockfish';
import { queryClient } from '../lib/queryClient';
import type { DeservedResult, EndgameScenario } from '../models/endgameScenario';
import { isMaintenanceRunning } from './blunderEnrichmentBackfill';
import { supabaseService } from './supabaseService';

/**
 * Scenarios are derived from the depth-12 sync eval with a wide "roughly
 * equal" band (25–75% win chances, roughly ±300cp), and the play-out then
 * fails the moment the user drops below 25%. A dropped-draw position that
 * was really -280 at depth 12 — or -600 at depth 28 — is a trap, not a
 * drill. This worker re-checks every new scenario's start position with the
 * same timed budget the deepening pass uses and retires the ones that don't
 * hold up:
 *
 *   dropped draw  keep iff |cp| ≤ DRAW_KEEP_ABS_CP and win% ≥ DRAW_HOLD_PCT
 *   dropped win   keep iff cp ≥ WIN_KEEP_MIN_CP
 *
 * (cp from the user's point of view.) Runs on the dashboard and on /endgames,
 * yields to sync analysis and to the blunder maintenance worker (all three
 * share the analysis engine), and stops when the screen unmounts.
 */

export const DRAW_KEEP_ABS_CP = 150;
export const WIN_KEEP_MIN_CP = 300;

const VERIFY_OPTS = {
  movetimeMs: 3000,
  maxDepth: 30,
  decidedCp: 800,
  decidedMinDepth: 16,
  pvMoves: 1,
};
const BATCH_SIZE = 5;
const ROW_DELAY_MS = 1500;

export function verdictFor(deserved: DeservedResult, userCp: number): 'keep' | 'retire' {
  if (deserved === 'win') return userCp >= WIN_KEEP_MIN_CP ? 'keep' : 'retire';
  if (Math.abs(userCp) > DRAW_KEEP_ABS_CP) return 'retire';
  return winPercent(userCp) >= DRAW_HOLD_PCT ? 'keep' : 'retire';
}

/** Engine scores are side-to-move relative; flip when the user isn't on move. */
export function toUserPov(fen: string, userColor: 'white' | 'black', scoreCp: number): number {
  const stm = new Chess(fen).turn() === 'w' ? 'white' : 'black';
  return stm === userColor ? scoreCp : -scoreCp;
}

let running = false;

export function startEndgameScenarioVerification(): () => void {
  if (running) return () => {};
  running = true;
  let stopped = false;
  const stop = () => {
    stopped = true;
    running = false;
  };

  void (async () => {
    try {
      const engineBusy = async () =>
        isMaintenanceRunning() || (await supabaseService.countUnanalyzedGames()) > 0;
      if (await engineBusy()) return;
      if ((await supabaseService.countUnverifiedEndgameScenarios()) === 0) return;

      const sf = await getAnalysisStockfish();
      const skip = new Set<string>();
      let touched = false;

      while (!stopped) {
        const batch = (
          await supabaseService.getUnverifiedEndgameScenarios({ limit: BATCH_SIZE + skip.size })
        ).filter((s) => !skip.has(s.id));
        if (batch.length === 0) break;

        for (const scenario of batch.slice(0, BATCH_SIZE)) {
          if (stopped) return;
          try {
            await verifyOne(sf, scenario);
            touched = true;
          } catch (err) {
            console.warn('[endgame-verify] failed for scenario', scenario.id, err);
            skip.add(scenario.id);
          }
          await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
        }
        if (touched) {
          void queryClient.invalidateQueries({ queryKey: ['endgameScenarios'] });
        }
        if (await engineBusy()) return;
      }
    } catch (err) {
      console.warn('[endgame-verify] worker stopped', err);
    } finally {
      running = false;
    }
  })();

  return stop;
}

async function verifyOne(
  sf: Awaited<ReturnType<typeof getAnalysisStockfish>>,
  scenario: EndgameScenario,
): Promise<void> {
  const ev = await sf.evaluateSmart(scenario.startFen, VERIFY_OPTS);
  const userCp = toUserPov(scenario.startFen, scenario.userColor, ev.scoreCp);
  // A scenario the user already rescued stays — the point of retiring is to
  // stop serving unwinnable positions, and this one demonstrably wasn't.
  const retired = scenario.status !== 'passed' && verdictFor(scenario.deservedResult, userCp) === 'retire';
  if (retired) {
    console.info(
      `[endgame-verify] retiring ${scenario.deservedResult} scenario ${scenario.id} (deep eval ${userCp}cp, depth ${ev.depth ?? '?'})`,
    );
  }
  await supabaseService.markEndgameScenarioVerified(scenario.id, { verifyEvalCp: userCp, retired });
}
