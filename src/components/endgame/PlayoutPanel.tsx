import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { MoveSequencePanel } from '../MoveSequencePanel';
import { buildLineMoves, buildRefutationPairs } from '../../chess/refutationLines';
import { isUciMove, parseUciMove, toKey } from '../../chess/moveUtils';
import { formatEval } from '../../chess/formatEval';
import { WinningChancesDisplay } from '../WinningChancesDisplay';
import { DRAW_ACCEPT_CP, DRAW_ACCEPT_QUIET_PLIES, RESIGN_CP } from '../../chess/adjudication';
import { halfmoveClock } from '../../chess/material';
import type { PlayoutSlip, SlipLogStatus } from '../../state/endgamePlayoutStore';
import { useDrillFeedbackPrefs } from '../../hooks/useDrillFeedbackPrefs';
import { useLineAutoplay } from '../../hooks/useLineAutoplay';

/** Board override while the user steps through the refutation line. */
export interface SlipPreview {
  fen: string;
  lastMove: [string, string] | null;
  /** Board arrows for the previewed position (the solution line draws green). */
  shapes?: DrawShape[];
}

/**
 * Two-level play-out hint, same escalation as the tactics trainer: level 1
 * highlights the origin square of the engine's move (free), level 2 draws the
 * full arrow (forfeits the clean attempt where one is being measured). Shared
 * by the /endgames play-out and the training-queue drill.
 */
export function usePlayoutHint({
  bestMove,
  solving,
  moveCount,
  onRevealMove,
}: {
  /** Engine best move (UCI) for the current position, when known. */
  bestMove: string | null | undefined;
  /** True while it is the user's turn — shapes render only then. */
  solving: boolean;
  /**
   * Count of user moves committed so far (e.g. playout.userMovesPlayed).
   * Bumps once per move — used only to reset the hint back to unused for the
   * next move, so a hint requested on one move doesn't keep reappearing.
   */
  moveCount: number;
  /** Fired when the full move is revealed (level 2), e.g. to forfeit the clean attempt. */
  onRevealMove?: () => void;
}) {
  const [level, setLevel] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setLevel(0);
  }, [moveCount]);

  const show = () => {
    if (!bestMove || level >= 2) return;
    if (level === 1) onRevealMove?.();
    setLevel((l) => (l === 0 ? 1 : 2));
  };

  const shapes: DrawShape[] = useMemo(() => {
    if (!isUciMove(bestMove) || level === 0 || !solving) return [];
    const orig = bestMove.slice(0, 2) as DrawShape['orig'];
    if (level === 1) return [{ orig, brush: 'blue' }];
    return [{ orig, dest: bestMove.slice(2, 4) as DrawShape['orig'], brush: 'blue' }];
  }, [bestMove, level, solving]);

  return { level, shapes, show, reset: () => setLevel(0) };
}

/** Hold-streak progress bar with the achieved engine depth underneath. */
export function HeldMeter({
  heldStreak,
  holdTarget,
  depth,
}: {
  heldStreak: number;
  holdTarget: number;
  depth?: number | null;
}) {
  const pct = Math.round((heldStreak / holdTarget) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="label">Held</span>
        <span className="font-mono text-xs tabular-nums text-text-secondary">
          {heldStreak}/{holdTarget} moves
        </span>
      </div>
      <div className="h-2 w-full border-2 border-text-primary bg-surface">
        <div className="h-full bg-gold-dark" style={{ width: `${pct}%` }} />
      </div>
      {depth != null && (
        <p className="font-mono text-[10px] uppercase tracking-tight text-text-secondary/70">
          Engine depth {depth}
        </p>
      )}
    </div>
  );
}

// Stable per-slip ids, so each new slip gets exactly one autoplay run.
const slipIds = new WeakMap<PlayoutSlip, number>();
let nextSlipId = 1;
function slipId(slip: PlayoutSlip): number {
  let id = slipIds.get(slip);
  if (id === undefined) {
    id = nextSlipId++;
    slipIds.set(slip, id);
  }
  return id;
}

export type SlipLineViewer = {
  line: ReturnType<typeof buildRefutationPairs> | null;
  /** The move that held (best move + engine PV from the slip position); null when show-answer is off. */
  solutionLine: ReturnType<typeof buildRefutationPairs> | null;
  /** Active refutation move key (`r<i>`), or null while the solution line is on the board. */
  activeKey: string | null;
  /** Active solution move key (`r<i>`), or null (including the best-move-arrow start). */
  activeSolutionKey: string | null;
  selectMove: (key: string) => void;
  selectSolutionMove: (key: string) => void;
  /** Steps the active move (arrow keys / tap arrows); null when there is no line to step. */
  stepLine: ((dir: 1 | -1) => void) | null;
  /** True while the post-slip lines are autoplaying (overlays should wait). */
  autoplayActive: boolean;
  skipAutoplay: () => void;
};

/**
 * Browsing state for a slip's lines: the engine refutation of the played
 * move and — when the drill-feedback "show the answer" pref is on — the
 * solution (the move that held, then the engine PV). Click/step selection
 * walks the board via onPreview; the arrow keys step whichever line is on the
 * board. After each new slip it applies the drill-feedback prefs: autoplay
 * steps the refutation then the solution (useLineAutoplay); show-answer alone
 * parks the board on the slip position with the best move drawn. Lifted out
 * of SlipReport so the host screen can surface the step controls near the
 * board (mobile action bar). `active` gates all of it to the failed phase so
 * a stale slip can't hijack the board mid-solve.
 */
export function useSlipLineViewer({
  slip,
  target,
  userColor,
  active,
  onPreview,
}: {
  slip: PlayoutSlip | null;
  target: 'win' | 'draw';
  userColor: 'white' | 'black';
  active: boolean;
  onPreview: (preview: SlipPreview | null) => void;
}): SlipLineViewer {
  const { showAnswer, autoplay } = useDrillFeedbackPrefs();
  // Which line is on the board, and the index within it. r0 = the slip itself,
  // already on the board when the fail panel appears. Solution index -1 = the
  // slip position with the best-move arrow.
  const [cursor, setCursor] = useState<{ line: 'refutation' | 'solution'; idx: number }>({
    line: 'refutation',
    idx: 0,
  });

  const line = useMemo(() => {
    if (!slip) return null;
    let afterFen: string | null = null;
    try {
      const chess = new Chess(slip.fenBefore);
      const m = parseUciMove(slip.playedUci);
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      afterFen = chess.fen();
    } catch {
      return null;
    }
    return buildRefutationPairs({
      fen: slip.fenBefore,
      moveNumber: slip.moveNumber,
      sideToMove: userColor,
      firstSan: slip.playedSan ?? slip.playedUci,
      firstUci: slip.playedUci,
      tag: target === 'win' ? 'Drops the win' : 'Drops the draw',
      pvMoves: buildLineMoves(afterFen, slip.refutationPv),
    });
  }, [slip, target, userColor]);

  const fullSolution = useMemo(() => {
    if (!slip?.bestUci) return null;
    const pv = slip.refEvalAtSlip?.principalVariation ?? [];
    const moves = buildLineMoves(slip.fenBefore, pv[0] === slip.bestUci ? pv : [slip.bestUci]);
    const first = moves[0];
    if (!first) return null;
    return buildRefutationPairs({
      fen: slip.fenBefore,
      moveNumber: slip.moveNumber,
      sideToMove: userColor,
      firstSan: first.san,
      firstUci: first.uci,
      tag: target === 'win' ? 'Keeps the win' : 'Holds the draw',
      pvMoves: moves.slice(1),
    });
  }, [slip, target, userColor]);
  const solutionLine = showAnswer ? fullSolution : null;

  const selectMove = (key: string) => {
    if (!line) return;
    const idx = Number.parseInt(key.slice(1), 10);
    const move = line.movesPlusFirst[idx];
    if (!move) return;
    try {
      const chess = new Chess(move.fenBefore);
      const m = parseUciMove(move.uci);
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      setCursor({ line: 'refutation', idx });
      onPreview({ fen: chess.fen(), lastMove: [m.from, m.to] });
    } catch {
      // Corrupt PV entry — leave the board where it is.
    }
  };

  const selectSolutionIndex = (idx: number) => {
    const moves = fullSolution?.movesPlusFirst;
    if (!moves || idx < -1 || idx >= moves.length) return;
    if (idx === -1) {
      const m = parseUciMove(moves[0].uci);
      setCursor({ line: 'solution', idx: -1 });
      onPreview({
        fen: moves[0].fenBefore,
        lastMove: null,
        shapes: [{ orig: toKey(m.from), dest: toKey(m.to), brush: 'green' }],
      });
      return;
    }
    const move = moves[idx];
    try {
      const chess = new Chess(move.fenBefore);
      const m = parseUciMove(move.uci);
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      setCursor({ line: 'solution', idx });
      onPreview({
        fen: chess.fen(),
        lastMove: [m.from, m.to],
        shapes: [{ orig: toKey(m.from), dest: toKey(m.to), brush: 'green' }],
      });
    } catch {
      // Corrupt PV entry — leave the board where it is.
    }
  };

  // New slip → back to the played move, and drop any stale board preview.
  // Declared before the autoplay hook so a fresh run isn't clobbered.
  useEffect(() => {
    setCursor({ line: 'refutation', idx: 0 });
    onPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip]);

  // Post-slip autoplay: the refutation, then the solution when it's shown.
  const slipSeq = slip ? slipId(slip) : 0;
  const autoplayRun = useLineAutoplay({
    runKey: active && autoplay && slip ? `slip:${slipSeq}` : null,
    segments: [
      { length: line?.movesPlusFirst.length ?? 0, select: (i) => selectMove(`r${i}`) },
      ...(solutionLine
        ? [
            {
              length: solutionLine.movesPlusFirst.length + 1,
              select: (i: number) => selectSolutionIndex(i - 1),
            },
          ]
        : []),
    ],
  });

  // Show-answer without autoplay: open on the answer instead of the slip.
  useEffect(() => {
    if (!active || autoplay || !solutionLine) return;
    selectSolutionIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoplay, !!solutionLine, slipSeq]);

  const onSolution = cursor.line === 'solution' && !!solutionLine;
  const canStep =
    active &&
    (onSolution ? true : !!line && line.movesPlusFirst.length > 0);

  // Tap equivalent of the arrow keys.
  const stepLine = canStep
    ? (dir: 1 | -1) => {
        autoplayRun.stop();
        if (onSolution && solutionLine) {
          const next = Math.min(
            Math.max(cursor.idx + dir, -1),
            solutionLine.movesPlusFirst.length - 1,
          );
          if (next !== cursor.idx) selectSolutionIndex(next);
          return;
        }
        if (!line) return;
        const cur = cursor.line === 'refutation' ? cursor.idx : 0;
        const next = Math.min(Math.max(cur + dir, 0), line.movesPlusFirst.length - 1);
        if (next !== cur) selectMove(`r${next}`);
      }
    : null;

  // Arrow keys step the line on the board, same as the training shell.
  useEffect(() => {
    if (!canStep) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'ArrowRight' && e.code !== 'ArrowLeft') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      stepLine?.(e.code === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStep, line, solutionLine, cursor]);

  return {
    line,
    solutionLine,
    activeKey: cursor.line === 'refutation' ? `r${cursor.idx}` : null,
    activeSolutionKey: onSolution && cursor.idx >= 0 ? `r${cursor.idx}` : null,
    selectMove: (key) => {
      autoplayRun.stop();
      selectMove(key);
    },
    selectSolutionMove: (key) => {
      autoplayRun.stop();
      const idx = Number.parseInt(key.slice(1), 10);
      if (!Number.isNaN(idx)) selectSolutionIndex(idx);
    },
    stepLine,
    autoplayActive: autoplayRun.active,
    skipAutoplay: autoplayRun.skip,
  };
}

/**
 * Post-slip report: what was played vs what held, a clickable engine
 * refutation line that walks the board (via the viewer from
 * useSlipLineViewer), and the opt-in "add to training queue" control.
 */
export function SlipReport({
  slip,
  target,
  userColor,
  logStatus,
  onLog,
  viewer,
}: {
  slip: PlayoutSlip;
  /** The side the user plays (the swing bar's mover). */
  userColor: 'white' | 'black';
  target: 'win' | 'draw';
  logStatus: SlipLogStatus;
  onLog: () => void;
  viewer: SlipLineViewer;
}) {
  const { line, solutionLine, activeKey, activeSolutionKey, selectMove, selectSolutionMove, stepLine } =
    viewer;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="text-text-secondary">You played </span>
        <span className="font-mono font-bold text-incorrect">
          {slip.playedSan ?? slip.playedUci}
        </span>
        {slip.bestSan && (
          <>
            <span className="text-text-secondary"> — engine holds with </span>
            <span className="font-mono font-bold text-correct">{slip.bestSan}</span>
          </>
        )}
      </p>

      {slip.refEvalAtSlip && slip.evalAfterSlip != null && (
        <WinningChancesDisplay
          evalBefore={slip.refEvalAtSlip.scoreCp}
          evalAfter={slip.evalAfterSlip}
          mover={userColor}
          label={`Your move: ${slip.playedSan ?? slip.playedUci}`}
        />
      )}

      {line && slip.refutationPv.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label">{target === 'win' ? 'Why the win is gone' : 'Why the draw is gone'}</span>
          <MoveSequencePanel
            pairs={line.pairs}
            activeKey={activeKey}
            onSelect={selectMove}
            onStep={activeKey !== null ? (stepLine ?? undefined) : undefined}
            stepArrowsDesktopOnly
            className="border-2 border-text-primary/20"
          />
        </div>
      )}

      {solutionLine && (
        <div className="flex flex-col gap-1">
          <span className="label">What holds</span>
          <MoveSequencePanel
            pairs={solutionLine.pairs}
            activeKey={activeSolutionKey}
            onSelect={selectSolutionMove}
            onStep={activeKey === null ? (stepLine ?? undefined) : undefined}
            stepArrowsDesktopOnly
            className="border-2 border-correct/40"
          />
        </div>
      )}

      {logStatus === 'saved' ? (
        <p className="text-text-secondary text-xs">
          Added — this position joins your training queue.
        </p>
      ) : logStatus !== 'unavailable' ? (
        <button
          type="button"
          className="btn-ghost text-sm"
          disabled={logStatus === 'saving'}
          onClick={onLog}
        >
          {logStatus === 'saving'
            ? 'Adding…'
            : logStatus === 'error'
              ? 'Could not save — try again'
              : 'Add to training queue'}
        </button>
      ) : null}
    </div>
  );
}

const formatPawns = (cp: number) => formatEval(cp, { decimals: 1, mate: 'word' });

/**
 * Play-to-the-finish progress line for the Endgames tab (no hold target):
 * moves played, the user-perspective eval with the "engine would resign" cue
 * on a win target, and quiet-move progress toward an accepted draw.
 */
export function PlayoutProgress({
  target,
  userMovesPlayed,
  evalCp,
  depth,
  fen,
  pending,
}: {
  target: 'win' | 'draw';
  userMovesPlayed: number;
  /** User-perspective centipawns for the current position, when known. */
  evalCp: number | null;
  depth?: number | null;
  fen: string;
  /** True while the engine is still forming its view of the position. */
  pending: boolean;
}) {
  const quietMoves = Math.floor(halfmoveClock(fen) / 2);
  const quietTarget = DRAW_ACCEPT_QUIET_PLIES / 2;
  const level = evalCp != null && Math.abs(evalCp) <= DRAW_ACCEPT_CP;
  const resignable = evalCp != null && evalCp >= RESIGN_CP;

  let evalText: string;
  if (evalCp == null) evalText = pending ? 'Engine thinking…' : 'No eval';
  else if (target === 'win' && resignable) evalText = `${formatPawns(evalCp)} · engine would resign`;
  else if (target === 'draw' && level) evalText = `${formatPawns(evalCp)} · level`;
  else evalText = formatPawns(evalCp);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="label">Progress</span>
        <span className="font-mono text-xs tabular-nums text-text-secondary">
          {userMovesPlayed} move{userMovesPlayed === 1 ? '' : 's'} played
        </span>
      </div>
      <p className="font-mono text-sm tabular-nums text-text-primary">{evalText}</p>
      <p className="text-text-secondary text-xs">
        {target === 'win'
          ? 'Deliver checkmate to rescue the point.'
          : `${Math.min(quietMoves, quietTarget)}/${quietTarget} quiet moves toward an accepted draw.`}
      </p>
      {depth != null && (
        <p className="font-mono text-[10px] uppercase tracking-tight text-text-secondary/70">
          Engine depth {depth}
        </p>
      )}
    </div>
  );
}
