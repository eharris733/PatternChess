// "Would you fall for this?": a candidate position + move → an engine-checked
// puzzle (the punishment line and the right move come from Stockfish).
import { verifyTrap } from './engine.ts';
import { buildFallPuzzle, type Puzzle } from './puzzle.ts';
import { trapBlunderId, type FallCandidate } from './select.ts';

export type Prepared = { ok: true; puzzle: Puzzle } | { ok: false; reason: string };

export async function prepareFall(c: Pick<FallCandidate, 'fen' | 'played_move' | 'players'>): Promise<Prepared> {
  const verdict = await verifyTrap(c.fen, c.played_move);
  if (!verdict.ok) return verdict;
  const puzzle = buildFallPuzzle({
    blunderId: '',
    fen: c.fen,
    tempting: c.played_move,
    fellCount: c.players,
    refutationPv: verdict.refutation.pv ?? [verdict.refutation.move],
    bestPv: verdict.best.pv ?? [verdict.best.move],
    bestCp: verdict.best.cp,
  });
  if (!puzzle) return { ok: false, reason: 'moves do not replay' };
  return { ok: true, puzzle: { ...puzzle, blunderId: trapBlunderId(puzzle.trapKey!) } };
}
