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

// --- "Would you fall for this?" ---------------------------------------------

/** At least this many different players, in this many different games, made the same move. */
export const MIN_FALL_PLAYERS = 3;

export interface FallCandidate {
  /** `<epd>|<uci>`; stored as social_posts.blunder_id = `trap:<key>`. */
  trapKey: string;
  fen: string;
  played_move: string;
  move_number: number;
  players: number;
  games: number;
}

/** social_posts.blunder_id for a fall post (the table's per-source dedup key). */
export function trapBlunderId(trapKey: string): string {
  return `trap:${trapKey}`;
}

/**
 * The EPD of a stored FEN in SQLite: strip the fullmove and halfmove counters
 * from the right. An en passant square ("e3") survives because each rtrim stops
 * at the space before it.
 */
const EPD_SQL = `rtrim(rtrim(rtrim(rtrim(b.fen, '0123456789'), ' '), '0123456789'), ' ')`;

/** Opening and early-middlegame traps first, then the most players. */
export function fallScore(c: Pick<FallCandidate, 'players' | 'move_number'>): number {
  const phase = c.move_number <= 12 ? 2 : c.move_number <= 20 ? 1 : 0.5;
  return c.players * phase;
}

/**
 * Positions where several players (all users, live tactic rows) played the same
 * losing move, never used or rejected before, best first. Only the position,
 * the move and the counts leave the database: never who played it.
 */
export function fetchFallCandidates(target: Target, minPlayers = MIN_FALL_PLAYERS): FallCandidate[] {
  const rows = d1<{ epd: string; played_move: string; fen: string; move_number: number; players: number; games: number }>(
    `SELECT ${EPD_SQL} AS epd, b.played_move, min(b.fen) AS fen, min(b.move_number) AS move_number,
            count(DISTINCT b.user_id) AS players, count(DISTINCT g.platform || ':' || g.external_game_id) AS games
     FROM blunders b JOIN games g ON g.id = b.game_id
     WHERE b.kind = 'tactic' AND b.retired_at IS NULL AND b.user_id IS NOT NULL
     GROUP BY epd, b.played_move
     HAVING players >= ${minPlayers} AND games >= ${minPlayers}
       AND ('trap:' || epd || '|' || b.played_move) NOT IN (SELECT blunder_id FROM social_posts)`,
    target,
  );
  return rows
    .map((r) => ({ trapKey: `${r.epd}|${r.played_move}`, fen: r.fen, played_move: r.played_move, move_number: r.move_number, players: r.players, games: r.games }))
    .sort((a, b) => fallScore(b) - fallScore(a));
}
