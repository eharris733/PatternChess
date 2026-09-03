import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { BoardActionBar } from '../BoardActionBar';
import { BoardStage } from '../BoardStage';
import { SideToPlay } from '../SideToPlay';
import { BoardActionOverlay, useActionOverlay } from '../BoardActionOverlay';
import { FeedbackBadge } from '../FeedbackBadge';
import { ProgressBar } from '../ProgressBar';
import {
  HeldMeter,
  SlipReport,
  SlipPreview,
  usePlayoutHint,
  useSlipLineViewer,
} from '../endgame/PlayoutPanel';
import { PositionSrState } from './PositionSrState';
import { useTrainingStore } from '../../state/trainingStore';
import { HOLD_MOVES, HOLD_RULES } from '../../chess/adjudication';
import {
  PlayoutResult,
  useEndgamePlayoutStore,
} from '../../state/endgamePlayoutStore';
import { Blunder, EndgameDrillData } from '../../models/blunder';
import { orderedPlayers } from '../../models/gameRecord';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../../services/externalAnalysisUrlService';

function resultFeedback(r: PlayoutResult, target: 'win' | 'draw') {
  if (r.success) {
    if (r.ending === 'adjudicated') {
      return target === 'win'
        ? 'Win secured — you held the winning position move after move.'
        : 'Draw held — solid, move after move.';
    }
    if (r.terminal === 'checkmate-by-user') return 'Checkmate — converted.';
    return 'Draw achieved.';
  }
  if (r.ending === 'terminal') {
    if (r.terminal === 'checkmate-by-opponent') return 'Checkmated — the point slipped away.';
    return target === 'win' ? 'Stalemate — the win slipped away.' : 'The draw slipped away.';
  }
  return target === 'win' ? 'That move gives up the win.' : 'That move gives up the draw.';
}

/**
 * Unified-queue drill for endgame-kind items: the user plays the position out
 * against the engine (adjudicated) instead of finding one stored move. Board
 * interaction runs through endgamePlayoutStore; the SR outcome flows back into
 * trainingStore via completeExternalDrill. Before the first move this renders
 * the same board + "X to play" chrome as a tactic drill — the user shouldn't
 * know which kind of test a position is until they engage with it.
 */
export function EndgameDrillView({
  blunder,
  drillData,
  showFilterBanner,
}: {
  blunder: Blunder;
  drillData: EndgameDrillData;
  showFilterBanner?: React.ReactNode;
}) {
  const training = useTrainingStore();
  const playout = useEndgamePlayoutStore();
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState<SlipPreview | null>(null);
  const hint = usePlayoutHint({
    bestMove: playout.refEval?.bestMove,
    solving: playout.phase === 'solving',
    // Revealing the move forfeits the clean first-attempt recall, same as
    // tactics; the level-1 piece highlight is free.
    onRevealMove: () => useTrainingStore.getState().markExternalAttempt(),
  });
  const startedForRef = useRef<string | null>(null);

  const userColor: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';
  const target = drillData.deservedResult;
  const revealed = playout.userMovesPlayed > 0 || playout.phase === 'passed' || playout.phase === 'failed';

  const slipViewer = useSlipLineViewer({
    slip: playout.slip,
    target,
    userColor,
    active: training.phase === 'incorrect',
    onPreview: setPreview,
  });
  const overlay = useActionOverlay(`${training.currentIndex}:${training.phase}`);

  const passedMessage =
    playout.phase === 'passed' && playout.terminal === 'checkmate-by-user'
      ? 'Checkmate — converted.'
      : target === 'win'
        ? 'Win secured — position held.'
        : 'Draw held.';

  // Play-outs are always blind — skip the optional review step.
  useEffect(() => {
    if (training.phase === 'reviewing') training.proceedFromReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training.phase]);

  // (Re)start the play-out whenever this item is presented to solve — including
  // when it requeues later in the session after a fail.
  useEffect(() => {
    if (training.phase !== 'solving') return;
    const needsStart =
      startedForRef.current !== blunder.id ||
      playout.phase === 'idle' ||
      playout.phase === 'passed' ||
      playout.phase === 'failed';
    if (!needsStart) return;
    startedForRef.current = blunder.id;
    hint.reset();
    setPreview(null);
    void playout.start({
      startFen: blunder.fen,
      userColor,
      target,
      sourceGameId: blunder.gameId,
      // Queue drills stay short: hold the result for HOLD_MOVES and move on.
      rules: HOLD_RULES,
      onFinish: (r) => {
        useTrainingStore.getState().completeExternalDrill({
          success: r.success,
          feedback: r.success
            ? null
            : { message: resultFeedback(r, target), tone: 'danger' },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [training.phase, blunder.id]);

  const playing =
    playout.phase === 'solving' || playout.phase === 'judging' || playout.phase === 'thinking';
  const settingUp = playout.phase === 'solving' && playout.refPending && playout.lastMove === null;
  const externalPlatform = resolvePlatform(training.game?.platform, 'lichess');
  const externalAnalysis =
    externalPlatform && playout.fen
      ? externalAnalysisUrl(externalPlatform, playout.fen, { orientation: userColor })
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        {showFilterBanner}
        <BoardStage
          paused={paused}
          loading={playout.phase === 'judging'}
          overlay={
            overlay.enabled &&
            (training.phase === 'correct' || training.phase === 'incorrect') && (
              <BoardActionOverlay
                message={
                  training.phase === 'correct'
                    ? passedMessage
                    : training.incorrectFeedback?.message ?? 'Play-out failed'
                }
                actionLabel={training.phase === 'correct' ? 'Next' : 'Continue'}
                onAction={() =>
                  training.phase === 'correct'
                    ? training.advance()
                    : training.requeueAndAdvance()
                }
                dismissLabel={
                  training.phase === 'correct' ? 'View board' : 'Review the lines'
                }
                onDismiss={overlay.dismiss}
              />
            )
          }
        >
          <BoardPanel
            fen={preview?.fen ?? (playout.fen || blunder.fen)}
            orientation={userColor}
            movableFor={playout.phase === 'solving' && !paused ? userColor : null}
            lastMove={preview ? preview.lastMove : playout.lastMove}
            shapes={hint.shapes}
            onMove={(m) => void playout.processMove(m)}
          />
        </BoardStage>

        <BoardActionBar
          resetKey={training.currentIndex}
          running={playout.phase === 'solving' && !paused}
          paused={paused}
          onTogglePaused={() => setPaused((p) => !p)}
          showHint={playing}
          hintLevel={hint.level}
          hintDisabled={
            hint.level >= 2 || !playout.refEval || paused || playout.phase !== 'solving'
          }
          onHint={hint.show}
          externalUrl={externalAnalysis?.url ?? null}
          externalLabel={externalAnalysis?.label}
          onStepLine={slipViewer.stepLine}
        />
      </div>

      <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-center justify-between">
          <span className="label">
            {training.game
              ? orderedPlayers(training.game.username, training.game.opponent, userColor).join(
                  ' vs ',
                )
              : 'Training'}
          </span>
          <span className="font-mono text-xs tabular-nums text-gold-dark">
            {`${training.currentIndex + 1}/${training.blunders.length}`}
          </span>
        </header>

        {training.pendingTryAgain && (
          <div className="flex items-center gap-2 rounded-none border-2 border-mistake/50 bg-mistake/15 px-3 py-2">
            <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight bg-mistake/30 text-mistake border-2 border-mistake/60">
              Retry
            </span>
            <span className="text-xs text-text-primary">You missed this last time</span>
          </div>
        )}

        <PositionSrState
          blunder={blunder}
          showTryAgainLabel={training.pendingTryAgain}
          showNextReview={playing && !revealed}
        />

        {playing && <SideToPlay color={userColor} />}

        {revealed && playing && (
          <>
            <FeedbackBadge tone="info">
              {target === 'win'
                ? 'Endgame play-out — convert this win'
                : 'Endgame play-out — hold this draw'}
            </FeedbackBadge>
            <HeldMeter
              heldStreak={playout.heldStreak}
              holdTarget={playout.holdTarget ?? HOLD_MOVES}
              depth={playout.refEval?.depth}
            />
          </>
        )}

        {playout.phase === 'judging' && (
          <FeedbackBadge tone="info">Judging your move…</FeedbackBadge>
        )}
        {playout.phase === 'thinking' && (
          <FeedbackBadge tone="info">Opponent thinking…</FeedbackBadge>
        )}
        {settingUp && <FeedbackBadge tone="info">Loading position…</FeedbackBadge>}
        {playout.engineError && (
          <FeedbackBadge tone="warning">Engine hiccup — keep playing</FeedbackBadge>
        )}
        {hint.level === 1 && playing && (
          <p className="text-text-secondary text-xs">Piece highlighted — find the move for full credit.</p>
        )}
        {hint.level === 2 && playing && (
          <p className="text-text-secondary text-xs">Move shown — no credit for this attempt.</p>
        )}

        {training.phase === 'correct' && (
          <>
            <FeedbackBadge tone="success">{passedMessage}</FeedbackBadge>
            <p className="text-text-secondary text-sm">
              In the game this ended in a {drillData.deservedResult === 'win' ? 'draw or loss' : 'loss'}.
              This time you kept the {target === 'win' ? 'full point' : 'half point'}.
            </p>
            <button className="btn-primary mt-auto" onClick={() => training.advance()}>
              Next<span className="hidden lg:inline ml-1.5"> (Space)</span>
            </button>
          </>
        )}

        {training.phase === 'incorrect' && (
          <>
            {training.incorrectFeedback && (
              <FeedbackBadge tone={training.incorrectFeedback.tone}>
                {training.incorrectFeedback.message}
              </FeedbackBadge>
            )}
            {playout.slip && (
              <SlipReport
                slip={playout.slip}
                target={target}
                logStatus={playout.slipLog}
                onLog={() => void playout.logSlip()}
                viewer={slipViewer}
              />
            )}
            <button className="btn-primary mt-auto" onClick={() => training.requeueAndAdvance()}>
              Continue<span className="hidden lg:inline ml-1.5"> (Space)</span>
            </button>
            <p className="text-text-secondary text-xs text-center -mt-1">
              Comes back later this session
            </p>
          </>
        )}

        <div className="mt-auto pt-2">
          <ProgressBar
            current={Math.round(
              training.totalAttempted > 0
                ? (training.totalCorrect / training.totalAttempted) * 100
                : 0,
            )}
            total={100}
            label="Recall rate"
          />
        </div>
      </aside>
    </div>
  );
}
