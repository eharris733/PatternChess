import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { MoveSequencePanel } from '../MoveSequencePanel';
import { buildLineMoves, buildRefutationPairs } from '../../chess/refutationLines';
import { parseUciMove } from '../../chess/moveUtils';
import { DRAW_ACCEPT_CP, DRAW_ACCEPT_QUIET_PLIES, RESIGN_CP } from '../../chess/adjudication';
import { halfmoveClock } from '../../chess/material';
import type { PlayoutSlip, SlipLogStatus } from '../../state/endgamePlayoutStore';

/** Board override while the user steps through the refutation line. */
export interface SlipPreview {
  fen: string;
  lastMove: [string, string];
}

/**
 * Two-level play-out hint, same escalation as the tactics trainer: level 1
 * highlights the origin square of the engine's move, level 2 draws the full
 * arrow. Shared by the /endgames play-out and the training-queue drill.
 */
export function usePlayoutHint({
  bestMove,
  solving,
  onFirstHint,
}: {
  /** Engine best move (UCI) for the current position, when known. */
  bestMove: string | null | undefined;
  /** True while it is the user's turn — shapes render only then. */
  solving: boolean;
  /** Fired on the first hint of a position (e.g. to forfeit the clean attempt). */
  onFirstHint?: () => void;
}) {
  const [level, setLevel] = useState<0 | 1 | 2>(0);

  const show = () => {
    if (!bestMove || level >= 2) return;
    if (level === 0) onFirstHint?.();
    setLevel((l) => (l === 0 ? 1 : 2));
  };

  const shapes: DrawShape[] = useMemo(() => {
    if (!bestMove || level === 0 || !solving) return [];
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

export type SlipLineViewer = {
  line: ReturnType<typeof buildRefutationPairs> | null;
  activeKey: string;
  selectMove: (key: string) => void;
  /** Steps the active move (arrow keys / tap arrows); null when there is no line to step. */
  stepLine: ((dir: 1 | -1) => void) | null;
};

/**
 * Browsing state for a slip's engine refutation line: which move is active,
 * click/step selection that walks the board via onPreview, and the arrow-key
 * handler. Lifted out of SlipReport so the host screen can surface the step
 * controls near the board (mobile action bar) while SlipReport renders the
 * line itself. `active` gates keyboard + stepping to the failed/incorrect
 * phase so a stale slip can't hijack the board mid-solve.
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
  // r0 = the slip itself, already on the board when the fail panel appears.
  const [activeKey, setActiveKey] = useState('r0');

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

  // New slip → back to the played move, and drop any stale board preview.
  useEffect(() => {
    setActiveKey('r0');
    onPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip]);

  const selectMove = (key: string) => {
    if (!line) return;
    const idx = Number.parseInt(key.slice(1), 10);
    const move = line.movesPlusFirst[idx];
    if (!move) return;
    try {
      const chess = new Chess(move.fenBefore);
      const m = parseUciMove(move.uci);
      chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      setActiveKey(key);
      onPreview({ fen: chess.fen(), lastMove: [m.from, m.to] });
    } catch {
      // Corrupt PV entry — leave the board where it is.
    }
  };

  const canStep = active && !!line && line.movesPlusFirst.length > 0;

  // Tap equivalent of the arrow keys.
  const stepLine = canStep
    ? (dir: 1 | -1) => {
        if (!line) return;
        const cur = Number.parseInt(activeKey.slice(1), 10) || 0;
        const next = Math.min(Math.max(cur + dir, 0), line.movesPlusFirst.length - 1);
        if (next !== cur) selectMove(`r${next}`);
      }
    : null;

  // Arrow keys step through the refutation line, same as the training shell.
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
  }, [canStep, line, activeKey]);

  return { line, activeKey, selectMove, stepLine };
}

/**
 * Post-slip report: what was played vs what held, a clickable engine
 * refutation line that walks the board (via the viewer from
 * useSlipLineViewer), and the opt-in "add to training queue" control.
 */
export function SlipReport({
  slip,
  target,
  logStatus,
  onLog,
  viewer,
}: {
  slip: PlayoutSlip;
  target: 'win' | 'draw';
  logStatus: SlipLogStatus;
  onLog: () => void;
  viewer: SlipLineViewer;
}) {
  const { line, activeKey, selectMove, stepLine } = viewer;
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

      {line && slip.refutationPv.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label">{target === 'win' ? 'Why the win is gone' : 'Why the draw is gone'}</span>
          <MoveSequencePanel
            pairs={line.pairs}
            activeKey={activeKey}
            onSelect={selectMove}
            onStep={stepLine ?? undefined}
            stepArrowsDesktopOnly
            className="border-2 border-text-primary/20"
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

function formatPawns(cp: number): string {
  if (Math.abs(cp) >= 9000) return cp > 0 ? 'Mate' : 'Mated';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

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
