import { Blunder } from '../models/blunder';
import { GameRecord, resolveOutcome } from '../models/gameRecord';
import { EndgameScenario } from '../models/endgameScenario';
import { classifyGameState } from '../chess/blunderContext';
import { supabaseService } from './supabaseService';

export interface ScenarioCandidate {
  gameId: string;
  blunderId: string;
  startFen: string;
  userColor: 'white' | 'black';
  deservedResult: 'win' | 'draw';
  actualResult: 'loss' | 'draw';
}

/**
 * Cross the user's endgame-phase analysis blunders with game results to find
 * dropped points — no engine work, existing data only:
 *
 * - dropped win:  a blunder made from a winning position (win % >= 75) in a
 *   game that ended in a loss or draw
 * - dropped draw: a blunder made from a holdable position (roughly equal) in a
 *   game that ended in a loss
 *
 * One scenario per game — the FIRST qualifying blunder in move order, since
 * that's where the deserved result was still on the board. `eval_before` is
 * from the user's perspective (analysis only records the user's moves).
 */
export function deriveScenarioCandidates(
  games: GameRecord[],
  endgameBlunders: Blunder[],
): ScenarioCandidate[] {
  const byGame = new Map<string, Blunder[]>();
  for (const b of endgameBlunders) {
    if (!b.gameId) continue;
    const list = byGame.get(b.gameId);
    if (list) list.push(b);
    else byGame.set(b.gameId, [b]);
  }

  const out: ScenarioCandidate[] = [];
  for (const game of games) {
    if (!game.userColor) continue;
    const outcome = resolveOutcome(game.platform, game.result, game.userColor);
    if (outcome !== 'loss' && outcome !== 'draw') continue;
    const blunders = byGame.get(game.id);
    if (!blunders) continue;

    for (const b of [...blunders].sort((a, z) => a.moveNumber - z.moveNumber)) {
      const state = classifyGameState(b.evalBefore);
      let deserved: 'win' | 'draw' | null = null;
      if (state === 'missedWin') deserved = 'win';
      else if (state === 'roughlyEqual' && outcome === 'loss') deserved = 'draw';
      if (!deserved) continue;

      out.push({
        gameId: game.id,
        blunderId: b.id,
        startFen: b.fen,
        userColor: game.userColor,
        deservedResult: deserved,
        actualResult: outcome,
      });
      break; // first dropped point wins
    }
  }
  return out;
}

/**
 * Run the scan against the given games (typically the useGames() cache),
 * persist any new scenarios (first write wins — statuses survive re-scans),
 * and return the fresh full list.
 */
export async function scanForScenarios(games: GameRecord[]): Promise<EndgameScenario[]> {
  const endgameBlunders = await supabaseService.getEndgameCandidateBlunders();
  const candidates = deriveScenarioCandidates(games, endgameBlunders);
  await supabaseService.upsertEndgameScenarios(
    candidates.map((c) => ({
      game_id: c.gameId,
      blunder_id: c.blunderId,
      start_fen: c.startFen,
      user_color: c.userColor,
      deserved_result: c.deservedResult,
      actual_result: c.actualResult,
    })),
  );
  return supabaseService.getEndgameScenarios();
}
