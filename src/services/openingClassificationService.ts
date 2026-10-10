import {
  classifyPgnWithBook,
  loadOpeningBook,
  type OpeningBook,
} from '../chess/openingClassifier';
import { queryClient } from '../lib/queryClient';
import type { TablesInsert } from '../lib/database.types';
import { supabaseService } from './supabaseService';

/**
 * Position-based opening classification for stored games.
 *
 * New games are classified as they are inserted (sync and PGN upload); games
 * that predate the classifier are picked up by the dashboard backfill below.
 * Both write the same three columns — `eco`, `opening_name`, `opening_family` —
 * so a game's opening never depends on which platform it came from.
 */

export interface OpeningBackfillProgress {
  classified: number;
  remaining: number;
}

/** Rows per RPC call. The classifier is ~5ms/game, so this is one short burst. */
const BATCH_SIZE = 100;
/** Breather between batches so the dashboard stays responsive. */
const BATCH_DELAY_MS = 300;

let running = false;
// The live run; an older run's `finally` (unwinding after a quick remount)
// must not clear the flag of the run that replaced it.
let runToken: object | null = null;

/** True while the opening backfill is walking the user's games. */
export function isOpeningBackfillRunning(): boolean {
  return running;
}

/**
 * Stamp opening columns on a batch of about-to-be-inserted games. Rows that
 * can't be classified (aborts, a handful of moves) still get
 * `opening_classified_at` so the backfill never revisits them.
 */
export type InsertableGame = Omit<TablesInsert<'games'>, 'user_id'>;

export async function classifyGameRowsForInsert(
  rows: InsertableGame[],
): Promise<InsertableGame[]> {
  if (rows.length === 0) return rows;
  let book: OpeningBook;
  try {
    book = await loadOpeningBook();
  } catch (err) {
    // A failed book load must never block an import — the backfill will catch
    // these rows on the next dashboard visit.
    console.warn('[openings] book load failed; inserting without classification', err);
    return rows;
  }
  const classifiedAt = new Date().toISOString();
  const out: InsertableGame[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % YIELD_EVERY === 0) await yieldToMain();
    const row = rows[i];
    const open = classifyPgnWithBook(book, row.pgn);
    out.push({
      ...row,
      eco: open?.eco ?? row.eco ?? null,
      opening_name: open?.name ?? row.opening_name ?? null,
      opening_family: open?.family ?? null,
      opening_classified_at: classifiedAt,
    });
  }
  return out;
}

// Each classification is a full chess.js PGN replay (~5-20ms); a batch of 100
// in one synchronous map froze the UI for a second or more. Yield to the event
// loop every few games so input and rendering stay responsive.
const YIELD_EVERY = 8;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dashboard-only backfill: classify every game that predates the classifier
 * (or arrived while the book failed to load), in batches, writing each batch
 * through the `apply_game_openings` RPC. Stops on unmount and resumes from
 * where it left off on the next visit — `opening_classified_at` is the gate.
 *
 * This is pure client CPU (no engine), so unlike the blunder maintenance worker
 * it doesn't need to yield to analysis.
 */
export function startOpeningBackfill(
  onProgress?: (p: OpeningBackfillProgress) => void,
): () => void {
  if (running) return () => {};
  running = true;
  const token = {};
  runToken = token;
  let stopped = false;

  const stop = () => {
    stopped = true;
    running = false;
  };

  void (async () => {
    let classified = 0;
    try {
      const remaining = await supabaseService.countUnclassifiedOpeningGames();
      if (remaining === 0) return;
      onProgress?.({ classified, remaining });

      const book = await loadOpeningBook();

      while (!stopped) {
        const batch = await supabaseService.getUnclassifiedOpeningGames({ limit: BATCH_SIZE });
        if (batch.length === 0) break;

        const patches = [];
        for (let i = 0; i < batch.length; i++) {
          if (i > 0 && i % YIELD_EVERY === 0) await yieldToMain();
          if (stopped) return;
          const game = batch[i];
          const open = classifyPgnWithBook(book, game.pgn);
          patches.push({
            id: game.id,
            eco: open?.eco ?? null,
            opening_name: open?.name ?? null,
            opening_family: open?.family ?? null,
          });
        }

        const written = await supabaseService.applyGameOpenings(patches);
        // A zero-row write means the RPC isn't taking our updates (RLS, a
        // stale session); stop rather than spin on the same batch forever.
        if (written === 0) break;
        classified += written;
        onProgress?.({
          classified,
          remaining: Math.max(0, remaining - classified),
        });

        if (batch.length < BATCH_SIZE) break;
        await sleep(BATCH_DELAY_MS);
      }

      if (classified > 0) {
        await queryClient.invalidateQueries({ queryKey: ['games'] });
        await queryClient.invalidateQueries({ queryKey: ['insights', 'opening'] });
      }
    } catch (err) {
      console.warn('[openings] backfill stopped', err);
    } finally {
      if (runToken === token) {
        running = false;
        runToken = null;
      }
    }
  })();

  return stop;
}
