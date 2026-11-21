import { Blunder } from '../models/blunder';
import { GameRecord, resolveOutcome } from '../models/gameRecord';
import { EndgameScenario, EndgameScenarioWithSeverity } from '../models/endgameScenario';
import { classifyGameState } from '../chess/blunderContext';
import { roundedChancesLost } from '../chess/winningChances';
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
/** The game fields scenario derivation reads. */
export type ScenarioGame = Pick<GameRecord, 'id' | 'platform' | 'result' | 'userColor'>;

export function deriveScenarioCandidates(
  games: ScenarioGame[],
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

/** Winning chances lost (percent) by a blunder, preferring the stored swing. */
function blunderSeverity(b: Blunder): number {
  return b.evalSwing || roundedChancesLost(b.evalBefore, b.evalAfter);
}

/**
 * Attach the source blunder's chances-lost severity to each scenario so the
 * list can sort by egregiousness — a client-side join, no schema change.
 */
export function attachSeverity(
  scenarios: EndgameScenario[],
  endgameBlunders: Blunder[],
): EndgameScenarioWithSeverity[] {
  const severityById = new Map(endgameBlunders.map((b) => [b.id, blunderSeverity(b)]));
  return scenarios.map((s) => ({
    ...s,
    severity: s.blunderId ? severityById.get(s.blunderId) ?? null : null,
  }));
}

// Candidates already upserted this session (by source blunder). The scan
// reruns on every invalidation (each finished play-out, each verifier batch);
// re-sending hundreds of unchanged rows each time slowed /endgames down for
// big libraries, so only new candidates go to the database.
const upsertedBlunderIds = new Set<string>();

/**
 * Derive scenarios from the user's endgame blunders and their games, persist
 * any new ones (first write wins — statuses survive re-scans), and return the
 * fresh full list with severity attached.
 */
export async function scanForScenarios(): Promise<EndgameScenarioWithSeverity[]> {
  const endgameBlunders = await supabaseService.getEndgameCandidateBlunders();
  // Only the games those blunders came from — never the whole library, so the
  // dashboard's endgame card doesn't wait on the full games list.
  const gameIds = [...new Set(endgameBlunders.map((b) => b.gameId).filter((id): id is string => !!id))];
  const games = await supabaseService.getScenarioGames(gameIds);
  const candidates = deriveScenarioCandidates(games, endgameBlunders).filter(
    (c) => !upsertedBlunderIds.has(c.blunderId),
  );
  if (candidates.length > 0) {
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
    for (const c of candidates) upsertedBlunderIds.add(c.blunderId);
  }
  return attachSeverity(await supabaseService.getEndgameScenarios(), endgameBlunders);
}
