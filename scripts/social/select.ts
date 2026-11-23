// Which of the owner's blunders can become a video. The owner is
// SOCIAL_OWNER_USER_ID, or the account with SOCIAL_OWNER_EMAIL (both are
// GitHub secrets / .env.local — the repo is public, so neither is committed).
import { d1, sql, type Target } from './cloudflare.ts';
import { env } from './env.ts';
import { candidateScore, isCandidate, pickMotif, type BlunderRow } from './puzzle.ts';

const COLUMNS = `b.id, b.fen, b.move_number, b.played_move, b.correct_moves, b.eval_before, b.eval_after,
  b.eval_swing, b.side_to_move, b.solution_line, b.motifs, g.user_rating, g.time_category`;

export function ownerId(target: Target): string {
  const id = env('SOCIAL_OWNER_USER_ID');
  if (id) return id;
  const email = env('SOCIAL_OWNER_EMAIL');
  if (!email) throw new Error('set SOCIAL_OWNER_USER_ID or SOCIAL_OWNER_EMAIL');
  const rows = d1<{ id: string }>(`SELECT id FROM "user" WHERE lower(email) = lower(${sql(email)})`, target);
  if (!rows[0]) throw new Error('no account for SOCIAL_OWNER_EMAIL');
  return rows[0].id;
}

function decode(r: Record<string, unknown>): BlunderRow {
  return r as unknown as BlunderRow;
}

/** Live tactic rows the deeper pass has finished, never posted or rejected before, best first. */
export function fetchCandidates(owner: string, target: Target): BlunderRow[] {
  const rows = d1(
    `SELECT ${COLUMNS}
     FROM blunders b JOIN games g ON g.id = b.game_id
     WHERE b.user_id = ${sql(owner)} AND b.kind = 'tactic' AND b.retired_at IS NULL
       AND b.deepened_at IS NOT NULL AND b.solution_line IS NOT NULL
       AND b.id NOT IN (SELECT blunder_id FROM social_posts)`,
    target,
    'blunders',
  ).map(decode);
  return rows.filter(isCandidate).sort((a, b) => candidateScore(b) - candidateScore(a));
}

export function fetchBlunder(id: string, target: Target): BlunderRow | null {
  const rows = d1(
    `SELECT ${COLUMNS} FROM blunders b JOIN games g ON g.id = b.game_id WHERE b.id = ${sql(id)}`,
    target,
    'blunders',
  ).map(decode);
  return rows[0] ?? null;
}

/**
 * Next candidate whose motif differs from the previous day's (so two forks
 * never run back to back), falling back to the best remaining one.
 */
export function nextCandidate(pool: BlunderRow[], previousMotif: string | null): BlunderRow | null {
  const idx = pool.findIndex((r) => pickMotif(r.motifs) !== previousMotif);
  const i = idx >= 0 ? idx : 0;
  return pool.length ? pool.splice(i, 1)[0] : null;
}
