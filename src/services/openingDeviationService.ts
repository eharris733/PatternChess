import { Chess } from 'chess.js';
import { classifyMoves, loadOpeningBook, movesFromPgn } from '../chess/openingClassifier';
import {
  MAX_THEORY_PLIES,
  MIN_MOVE_GAMES,
  epdOf,
  findDeviation,
  pastBookGate,
  theoryMovesAt,
  walkFens,
} from '../chess/openingDeviation';
import { moveToUci, parseUciMove } from '../chess/moveUtils';
import {
  classify,
  inaccuracyThresholdPercent,
  winPercent,
  winningChancesLost,
} from '../chess/winningChances';
import { getAnalysisStockfish } from '../hooks/useStockfish';
import { toJson } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';
import type { OpeningDrillData, OpeningDrillSource, TheoryMove } from '../models/blunder';
import type { OpeningDeviation } from '../chess/openingDeviation';
import { isMaintenanceRunning } from './blunderEnrichmentBackfill';
import { isEndgameVerificationRunning } from './endgameScenarioVerifier';
import { fetchBook, positionGames, type BookPosition } from './openingBookService';
import { supabaseService } from './supabaseService';

export interface DeviationScanProgress {
  /** Games still waiting for their theory walk. */
  unwalked: number;
  /** User exits still waiting for the engine. */
  unscored: number;
  /** Games whose opening past the book still needs the engine scan. */
  pastBook: number;
  /** False once the pass has stopped (done, yielded the engine, or failed). */
  active: boolean;
}

const WALK_BATCH = 25;
const EVAL_BATCH = 5;
const PAST_BOOK_BATCH = 2;
/**
 * Engine budget per exit position. The exit is always an opening position,
 * where 1.5s reaches depth ~18 on the MT engine — plenty to tell a 10% slip
 * from a sound sideline.
 */
const EVAL_OPTS = { movetimeMs: 1500, maxDepth: 18, decidedCp: 800, decidedMinDepth: 14 };
/** Past-book screen: cheap pass over every user move once the book runs out. */
const SCREEN_OPTS = { movetimeMs: 300, maxDepth: 14, decidedCp: 800, decidedMinDepth: 10 };
/** Past-book confirm: the deep re-check of a screened ≥10% drop. */
const CONFIRM_OPTS = { movetimeMs: 3000, maxDepth: 22, decidedCp: 800, decidedMinDepth: 16 };
/** Book evals below this depth are re-checked by the engine rather than trusted. */
const MIN_TRUSTED_BOOK_DEPTH = 18;
/** Engine candidates within this many winning-chance points of best count as answers. */
const ANSWER_MAX_LOSS_PCT = 5;
const EVAL_ROW_DELAY_MS = 1500;
/** Stop the walk for this visit after this many consecutive book failures. */
const MAX_WALK_FAILURES = 3;

export const OPENING_DEVIATIONS_QUERY_KEY = ['openings', 'deviations'] as const;

let running = false;
/** The orphan-drill sweep runs once per page load, after a full drain. */
let orphanSweepDone = false;

export function isOpeningDeviationRunning(): boolean {
  return running;
}

type Engine = Awaited<ReturnType<typeof getAnalysisStockfish>>;

/**
 * Background pass that fills opening_deviations in three stages:
 *
 * A. Walk — one /api/book request per game (no rate limit), so it may run
 *    while sync analysis holds the engine. Games are stamped with
 *    DEVIATION_RULE_VERSION; a failed lookup leaves the game unstamped.
 * B. Score — engine-evaluates each user book exit (reusing the book's stored
 *    eval of the position when it is deep enough) and, at ≥10% chances lost,
 *    creates a kind='opening' drill. A sound exit hands the rest of the
 *    opening to stage C.
 * C. Past book — once the book can't judge (theory ended, opponent left, or
 *    the user's sound exit), screens the user's remaining moves up to
 *    MAX_THEORY_PLIES with a shallow search, confirms any ≥10% drop deeply,
 *    and records the first confirmed one as the exit (reason 'past_book').
 *    The scan stops as soon as the position is lopsided (pastBookGate) and
 *    never claims a position the game's tactic analysis already found — both
 *    are the regular blunder pipeline's territory.
 * Once everything is drained, opening drills no deviation row points at any
 * more (left behind by a rule change) are retired.
 * B and C yield the analysis engine to sync analysis, blunder maintenance
 * and the endgame verifier.
 *
 * Mounted on the dashboard and /openings; stops when they unmount. Never part
 * of initial sync analysis.
 */
export function startOpeningDeviationScan(
  onProgress?: (p: DeviationScanProgress) => void,
): () => void {
  if (running) return () => {};
  running = true;
  let stopped = false;
  const stop = () => {
    stopped = true;
    running = false;
  };

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: OPENING_DEVIATIONS_QUERY_KEY });

  let unwalked = 0;
  let unscored = 0;
  let pastBook = 0;
  const report = () =>
    onProgress?.({ unwalked, unscored, pastBook, active: running && !stopped });

  void (async () => {
    try {
      unwalked = await supabaseService.countUncheckedDeviationGames();
      unscored = await supabaseService.countPendingDeviationEvals();
      pastBook = await supabaseService.countPastBookQueue();
      report();
      if (unwalked === 0 && unscored === 0 && pastBook === 0) {
        await sweepOrphanDrills();
        return;
      }

      const engineBusy = async () =>
        isMaintenanceRunning() ||
        isEndgameVerificationRunning() ||
        (await supabaseService.countUnanalyzedGames()) > 0;
      let sf: Engine | null = null;
      const walkSkip = new Set<string>();
      const evalSkip = new Set<string>();
      const pastSkip = new Set<string>();
      let failures = 0;

      while (!stopped) {
        let progressed = false;

        // Stage A — walk a batch (network only, fast).
        if (unwalked > 0 && failures < MAX_WALK_FAILURES) {
          const batch = (
            await supabaseService.getUncheckedDeviationGames({ limit: WALK_BATCH + walkSkip.size })
          ).filter((g) => !walkSkip.has(g.id));
          if (batch.length === 0) unwalked = 0;
          for (const game of batch.slice(0, WALK_BATCH)) {
            if (stopped) return;
            const outcome = await walkOne(game);
            if (outcome === 'retry') {
              walkSkip.add(game.id);
              if (++failures >= MAX_WALK_FAILURES) break;
              continue;
            }
            failures = 0;
            progressed = true;
            unwalked = Math.max(0, unwalked - 1);
            if (outcome === 'user_left') unscored++;
            if (outcome === 'theory_end' || outcome === 'opponent_left') pastBook++;
            report();
          }
          invalidate();
          // Walks are cheap: finish them before spending engine time.
          if (progressed && unwalked > 0) continue;
        }

        if ((unscored > 0 || pastBook > 0) && !(await engineBusy())) {
          sf ??= await getAnalysisStockfish();

          // Stage B — score pending book exits.
          if (unscored > 0) {
            const batch = (
              await supabaseService.getPendingDeviationEvals({ limit: EVAL_BATCH + evalSkip.size })
            ).filter((d) => !evalSkip.has(d.id));
            if (batch.length === 0) unscored = 0;
            for (const dev of batch.slice(0, EVAL_BATCH)) {
              if (stopped) return;
              try {
                if (await scoreOne(sf, dev)) pastBook++;
                progressed = true;
              } catch (err) {
                console.warn('[openings] scoring failed for deviation', dev.id, err);
                evalSkip.add(dev.id);
              }
              unscored = Math.max(0, unscored - 1);
              report();
              await new Promise((r) => setTimeout(r, EVAL_ROW_DELAY_MS));
            }
          }

          // Stage C — past-book scan.
          if (pastBook > 0 && !stopped) {
            const batch = (
              await supabaseService.getPastBookQueue({ limit: PAST_BOOK_BATCH + pastSkip.size })
            ).filter((d) => !pastSkip.has(d.id));
            if (batch.length === 0) pastBook = 0;
            for (const dev of batch.slice(0, PAST_BOOK_BATCH)) {
              if (stopped) return;
              try {
                await scanPastBook(sf, dev, () => stopped);
                progressed = true;
              } catch (err) {
                console.warn('[openings] past-book scan failed for deviation', dev.id, err);
                pastSkip.add(dev.id);
              }
              pastBook = Math.max(0, pastBook - 1);
              report();
            }
          }
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ['blunders', 'due'] });
        }

        // Done, or stuck (book failing and the engine busy): pick up on the
        // next visit.
        if (!progressed) {
          if (unwalked === 0 && unscored === 0 && pastBook === 0) await sweepOrphanDrills();
          break;
        }
      }
    } catch (err) {
      // A stolen auth lock aborts the in-flight request; nothing is lost —
      // unstamped games are picked up on the next mount.
      if (err instanceof Error && err.name === 'AbortError') console.debug('[openings] deviation scan interrupted', err);
      else console.warn('[openings] deviation scan stopped', err);
    } finally {
      running = false;
      report();
    }
  })();

  return stop;
}

async function sweepOrphanDrills(): Promise<void> {
  if (orphanSweepDone) return;
  orphanSweepDone = true;
  const retired = await supabaseService.retireOrphanOpeningDrills();
  if (retired > 0) void queryClient.invalidateQueries({ queryKey: ['blunders'] });
}

type ScanGame = Awaited<ReturnType<typeof supabaseService.getUncheckedDeviationGames>>[number];

async function walkOne(game: ScanGame): Promise<'retry' | string> {
  const moves = movesFromPgn(game.pgn);
  // Legacy games the dashboard backfill hasn't classified yet: classify here
  // so the row lands in the right opening group.
  const opening =
    game.openingFamily == null && moves && moves.length > 0
      ? classifyMoves(await loadOpeningBook(), moves)
      : null;
  const labels = {
    game_id: game.id,
    opening_family: game.openingFamily ?? opening?.family ?? null,
    opening_name: game.openingName ?? opening?.name ?? null,
    eco: game.eco ?? opening?.eco ?? null,
    user_color: game.userColor,
  };
  // Variants chess.js can't replay, broken PGNs, and games where we don't know
  // which side the user played are recorded as skipped so they aren't retried.
  if (!moves || moves.length === 0 || !game.userColor) {
    await supabaseService.saveDeviationWalk({ ...labels, status: 'skipped' });
    return 'skipped';
  }
  // One request for every position the walk can reach.
  const book = await fetchBook(walkFens(moves));
  if (!book) return 'retry';
  const walk = await findDeviation(moves, game.userColor, async (fen) => {
    const p = book.get(epdOf(fen));
    return p === undefined ? 'error' : p;
  });
  if (walk === 'retry') return 'retry';
  const trustBookEval =
    walk.status === 'user_left' &&
    walk.bookEvalCp != null &&
    (walk.bookEvalDepth ?? 0) >= MIN_TRUSTED_BOOK_DEPTH;
  await supabaseService.saveDeviationWalk({
    ...labels,
    status: walk.status,
    ply: walk.ply,
    move_number: walk.moveNumber,
    fen_before: walk.fenBefore,
    epd_before: walk.fenBefore ? epdOf(walk.fenBefore) : null,
    played_uci: walk.playedUci,
    played_san: walk.playedSan,
    reason: walk.reason,
    theory_moves: toJson(walk.theoryMoves),
    position_games: walk.positionGames,
    played_games: walk.playedGames,
    played_mover_win_pct: walk.playedMoverWinPct,
    book_tier: walk.bookTier,
    book_end_ply: walk.bookEndPly != null && walk.bookEndPly < MAX_THEORY_PLIES ? walk.bookEndPly : null,
    // The book's deep eval of the exit position saves stage B an engine call.
    ...(trustBookEval ? { eval_before: walk.bookEvalCp, eval_depth: walk.bookEvalDepth } : {}),
  });
  return walk.status;
}

function fenAfter(fen: string, uci: string): Chess {
  const chess = new Chess(fen);
  const m = parseUciMove(uci);
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  return chess;
}

async function evalAfterMove(
  sf: Engine,
  fen: string,
  uci: string,
  opts: typeof EVAL_OPTS,
): Promise<{ scoreCp: number; depth: number | null }> {
  const afterPos = fenAfter(fen, uci);
  // Terminal positions: the engine reports an ambiguous 0 there, so score
  // them from chess.js (a mate is the best possible move; a stalemate is 0).
  if (afterPos.isGameOver()) return { scoreCp: afterPos.isCheckmate() ? -10_000 : 0, depth: null };
  return sf.evaluateSmart(afterPos.fen(), opts);
}

/** Stage B. Returns true when the exit was sound and was handed to stage C. */
async function scoreOne(sf: Engine, dev: OpeningDeviation): Promise<boolean> {
  if (!dev.fenBefore || !dev.playedUci || !dev.epdBefore) throw new Error('incomplete deviation row');
  const before =
    dev.evalBefore != null
      ? { scoreCp: dev.evalBefore, depth: null as number | null }
      : await sf.evaluateSmart(dev.fenBefore, EVAL_OPTS);
  const after = await evalAfterMove(sf, dev.fenBefore, dev.playedUci, EVAL_OPTS);

  const chancesLost = Math.max(0, winningChancesLost(before.scoreCp, after.scoreCp));
  const classification = classify(chancesLost);

  let blunderId: string | null = null;
  if (chancesLost >= inaccuracyThresholdPercent && dev.theoryMoves.length > 0) {
    blunderId = await ensureOpeningDrill(dev, {
      fen: dev.fenBefore,
      playedUci: dev.playedUci,
      evalBefore: before.scoreCp,
      evalAfter: after.scoreCp,
      chancesLost,
      depth: before.depth ?? after.depth,
      theoryMoves: dev.theoryMoves,
      positionGames: dev.positionGames ?? 0,
      source: 'book',
    });
  }

  // A sound exit leaves the rest of the opening unjudged by the book: the
  // past-book scan picks up from the next ply — unless the game is already
  // lopsided, when later mistakes are ordinary blunders.
  const nextPly = dev.ply != null ? dev.ply + 1 : null;
  const handOff =
    chancesLost < inaccuracyThresholdPercent &&
    pastBookGate(before.scoreCp) &&
    nextPly != null &&
    nextPly < MAX_THEORY_PLIES;

  await supabaseService.setDeviationEval(dev.id, {
    evalBefore: before.scoreCp,
    evalAfter: after.scoreCp,
    chancesLost,
    classification,
    depth: before.depth ?? after.depth,
    blunderId,
    bookEndPly: handOff ? nextPly : null,
  });
  return handOff;
}

/**
 * Stage C: judge the user's moves from `bookEndPly` to MAX_THEORY_PLIES with
 * the engine. Screen shallowly (each position evaluated once — the eval after
 * one move is the eval before the next), confirm any ≥10% drop deeply, and
 * record the first confirmed mistake. Stops early on `isStopped`.
 */
async function scanPastBook(
  sf: Engine,
  dev: OpeningDeviation & { pgn: string },
  isStopped: () => boolean,
): Promise<void> {
  const moves = movesFromPgn(dev.pgn);
  const start = dev.bookEndPly ?? MAX_THEORY_PLIES;
  if (!moves || !dev.userColor || start >= Math.min(moves.length, MAX_THEORY_PLIES)) {
    await supabaseService.setPastBookResult(dev.id, null);
    return;
  }
  const userTurn = dev.userColor === 'white' ? 'w' : 'b';

  // Replay to the scan window, collecting each position's FEN.
  const chess = new Chess();
  const fens: string[] = [];
  const ucis: string[] = [];
  const sans: string[] = [];
  const end = Math.min(moves.length, MAX_THEORY_PLIES);
  for (let ply = 0; ply < end; ply++) {
    fens.push(chess.fen());
    const mv = chess.move(moves[ply]);
    ucis.push(moveToUci(mv));
    sans.push(mv.san);
  }
  fens.push(chess.fen());

  const screen = new Map<number, number>(); // ply → side-to-move cp
  const evalAt = async (ply: number): Promise<number> => {
    const hit = screen.get(ply);
    if (hit != null) return hit;
    const pos = new Chess(fens[ply]);
    const cp = pos.isCheckmate()
      ? -10_000
      : pos.isGameOver()
        ? 0
        : (await sf.evaluateSmart(fens[ply], SCREEN_OPTS)).scoreCp;
    screen.set(ply, cp);
    return cp;
  };

  for (let ply = start; ply < end; ply++) {
    if (isStopped()) return; // unstamped: resumes next visit
    // A lopsided position (after either side's move) means the opening is
    // over: nothing from here on is an opening mistake.
    const cpHere = await evalAt(ply);
    if (!pastBookGate(cpHere)) break;
    if (fens[ply].split(' ')[1] !== userTurn) continue;
    const lost = winningChancesLost(cpHere, await evalAt(ply + 1));
    if (lost < inaccuracyThresholdPercent) continue;

    // Deep confirm before blaming the user.
    const before = await sf.evaluateSmart(fens[ply], CONFIRM_OPTS);
    if (!pastBookGate(before.scoreCp)) break;
    const after = await evalAfterMove(sf, fens[ply], ucis[ply], CONFIRM_OPTS);
    const chancesLost = Math.max(0, winningChancesLost(before.scoreCp, after.scoreCp));
    if (chancesLost < inaccuracyThresholdPercent) continue;
    // Already a tactic from this game's analysis: the blunder pipeline owns it.
    if (await supabaseService.hasTacticForGamePosition(dev.gameId, epdOf(fens[ply]))) break;

    const bookHere = (await fetchBook([fens[ply]]))?.get(epdOf(fens[ply])) ?? null;
    const answers = await engineAnswers(sf, fens[ply], before, bookHere, ucis[ply]);
    const moveNumber = Number(fens[ply].split(' ')[5]) || Math.floor(ply / 2) + 1;
    const blunderId = await ensureOpeningDrill(dev, {
      fen: fens[ply],
      playedUci: ucis[ply],
      evalBefore: before.scoreCp,
      evalAfter: after.scoreCp,
      chancesLost,
      depth: before.depth,
      theoryMoves: answers,
      positionGames: bookHere ? positionGames(bookHere) : 0,
      source: 'engine',
      moveNumber,
    });
    await supabaseService.setPastBookResult(dev.id, {
      ply,
      moveNumber,
      fenBefore: fens[ply],
      epdBefore: epdOf(fens[ply]),
      playedUci: ucis[ply],
      playedSan: sans[ply],
      theoryMoves: answers,
      positionGames: bookHere ? positionGames(bookHere) : null,
      evalBefore: before.scoreCp,
      evalAfter: after.scoreCp,
      chancesLost,
      classification: classify(chancesLost),
      depth: before.depth,
      blunderId,
    });
    return;
  }
  await supabaseService.setPastBookResult(dev.id, null);
}

/**
 * The answer set for a past-book mistake: the engine's best move first, then
 * any sound book move here (the book may still hold 5–9 games) the engine
 * rates within ANSWER_MAX_LOSS_PCT. Book stats ride along so the note can say
 * what strong players chose.
 */
async function engineAnswers(
  sf: Engine,
  fen: string,
  best: { scoreCp: number; bestMove: string },
  book: BookPosition | null,
  playedUci: string,
): Promise<TheoryMove[]> {
  const bookMoves = book ? theoryMovesAt(fen, book) : [];
  const stats = new Map(bookMoves.map((t) => [t.uci, t]));
  const toTheory = (uci: string, engineBest: boolean): TheoryMove | null => {
    let san: string;
    try {
      san = new Chess(fen).move(parseUciMove(uci)).san;
    } catch {
      return null;
    }
    const s = stats.get(uci);
    return {
      uci,
      san,
      games: s?.games ?? 0,
      share: s?.share ?? 0,
      moverWinPct: s?.moverWinPct ?? 0,
      titledShare: s?.titledShare ?? null,
      tier: s?.tier ?? book?.tier ?? null,
      engineBest,
    };
  };

  const out: TheoryMove[] = [];
  const top = best.bestMove ? toTheory(best.bestMove, true) : null;
  if (top) out.push(top);
  for (const t of bookMoves) {
    if (t.uci === top?.uci || t.uci === playedUci || t.games < MIN_MOVE_GAMES) continue;
    const bookCp = book?.moves.find((m) => m.uci === t.uci)?.cp;
    const cp = bookCp ?? -(await evalAfterMove(sf, fen, t.uci, EVAL_OPTS)).scoreCp;
    if (winPercent(best.scoreCp) - winPercent(cp) <= ANSWER_MAX_LOSS_PCT) {
      const m = toTheory(t.uci, false);
      if (m) out.push(m);
    }
  }
  return out;
}

/**
 * Create (or find) the kind='opening' drill for this position. Book drills
 * teach the theory moves; engine drills (past the book) teach the engine's
 * best move plus sound book alternatives. `correct_moves[0].eval` is the
 * accept bar the training screen's engine check measures other moves against,
 * so any move within 5% is accepted either way.
 */
async function ensureOpeningDrill(
  dev: OpeningDeviation,
  d: {
    fen: string;
    playedUci: string;
    evalBefore: number;
    evalAfter: number;
    chancesLost: number;
    depth: number | null;
    theoryMoves: TheoryMove[];
    positionGames: number;
    source: OpeningDrillSource;
    moveNumber?: number;
  },
): Promise<string | null> {
  if (d.theoryMoves.length === 0) return null;
  const existing = await supabaseService.findDrillForPosition(epdOf(d.fen));
  if (existing) return existing;
  const drillData: OpeningDrillData = {
    openingFamily: dev.openingFamily,
    openingName: dev.openingName,
    theoryMoves: d.theoryMoves,
    positionGames: d.positionGames,
    source: d.source,
    v: 2,
  };
  return supabaseService.insertOpeningDrill({
    game_id: dev.gameId,
    fen: d.fen,
    move_number: d.moveNumber ?? dev.moveNumber ?? 1,
    played_move: d.playedUci,
    correct_moves: toJson(d.theoryMoves.map((t) => ({ move: t.uci, eval: d.evalBefore }))),
    eval_before: d.evalBefore,
    eval_after: d.evalAfter,
    eval_swing: Math.round(d.chancesLost),
    side_to_move: dev.userColor ?? (d.fen.split(' ')[1] === 'b' ? 'black' : 'white'),
    phase: 'opening',
    kind: 'opening',
    drill_data: toJson(drillData),
    analysis_depth: d.depth,
    // Opening items are scored here with a real budget; keep them out of the
    // deepening pass, whose 10% retire bar would retire them.
    deepened_at: new Date().toISOString(),
  });
}
