import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { BoardPanel } from '../BoardPanel';
import { BoardActionBar } from '../BoardActionBar';
import { FeedbackBadge } from '../FeedbackBadge';
import { ProgressBar } from '../ProgressBar';
import { PositionSrState } from './PositionSrState';
import { useTrainingStore } from '../../state/trainingStore';
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
import type { DrawShape } from 'chessground/draw';

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
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);
  const startedForRef = useRef<string | null>(null);

  const userColor: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';
  const target = drillData.deservedResult;
  const revealed = playout.userMovesPlayed > 0 || playout.phase === 'passed' || playout.phase === 'failed';

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
    setHintLevel(0);
    void playout.start({
      startFen: blunder.fen,
      userColor,
      target,
      sourceGameId: blunder.gameId,
      logSlips: true,
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

  const onHint = () => {
    const best = playout.refEval?.bestMove;
    if (!best || hintLevel >= 2) return;
    if (hintLevel === 0) {
      // Taking a hint forfeits the clean first-attempt recall, same as tactics.
      useTrainingStore.getState().markExternalAttempt();
    }
    setHintLevel((h) => (h === 0 ? 1 : 2));
  };

  const hintShapes: DrawShape[] = (() => {
    const best = playout.refEval?.bestMove;
    if (!best || hintLevel === 0 || playout.phase !== 'solving') return [];
    const orig = best.slice(0, 2) as DrawShape['orig'];
    if (hintLevel === 1) return [{ orig, brush: 'blue' }];
    return [{ orig, dest: best.slice(2, 4) as DrawShape['orig'], brush: 'blue' }];
  })();

  const playing = playout.phase === 'solving' || playout.phase === 'thinking' || playout.phase === 'loading';
  const externalPlatform = resolvePlatform(training.game?.platform, 'lichess');
  const externalAnalysis =
    externalPlatform && playout.fen ? externalAnalysisUrl(externalPlatform, playout.fen) : null;

  const heldPct = Math.round((playout.heldStreak / playout.holdTarget) * 100);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        {showFilterBanner}
        <div
          className={clsx(
            'transition duration-200',
            paused && 'blur-md pointer-events-none select-none',
          )}
          aria-hidden={paused}
        >
          <BoardPanel
            fen={playout.fen || blunder.fen}
            orientation={userColor}
            movableFor={playout.phase === 'solving' && !paused ? userColor : null}
            lastMove={playout.lastMove}
            shapes={hintShapes}
            onMove={(m) => void playout.processMove(m)}
          />
        </div>

        <BoardActionBar
          resetKey={training.currentIndex}
          running={playout.phase === 'solving' && !paused}
          paused={paused}
          onTogglePaused={() => setPaused((p) => !p)}
          showHint={playout.phase === 'solving'}
          hintLevel={hintLevel}
          hintDisabled={hintLevel >= 2 || !playout.refEval || paused}
          onHint={onHint}
          externalUrl={externalAnalysis?.url ?? null}
          externalLabel={externalAnalysis?.label}
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

        {playing && (
          <div className="flex items-center gap-2 text-text-primary">
            <span
              className={clsx(
                'w-3 h-3 rounded-full border-2 border-text-primary',
                userColor === 'white' ? 'bg-surface' : 'bg-black',
              )}
            />
            <span className="font-medium">
              {userColor === 'white' ? 'White' : 'Black'} to play
            </span>
          </div>
        )}

        {revealed && playing && (
          <>
            <FeedbackBadge tone="info">
              {target === 'win'
                ? 'Endgame play-out — convert this win'
                : 'Endgame play-out — hold this draw'}
            </FeedbackBadge>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="label">Held</span>
                <span className="font-mono text-xs tabular-nums text-text-secondary">
                  {playout.heldStreak}/{playout.holdTarget} moves
                </span>
              </div>
              <div className="h-2 w-full border-2 border-text-primary bg-surface">
                <div className="h-full bg-gold-dark" style={{ width: `${heldPct}%` }} />
              </div>
            </div>
          </>
        )}

        {playout.phase === 'thinking' && (
          <FeedbackBadge tone="info">Opponent thinking…</FeedbackBadge>
        )}
        {playout.phase === 'loading' && (
          <FeedbackBadge tone="info">Loading position…</FeedbackBadge>
        )}
        {playout.engineError && (
          <FeedbackBadge tone="warning">Engine hiccup — keep playing</FeedbackBadge>
        )}
        {hintLevel > 0 && playing && (
          <p className="text-text-secondary text-xs">Hint shown — counts as a fail for recall.</p>
        )}

        {training.phase === 'correct' && (
          <>
            <FeedbackBadge tone="success">
              {playout.phase === 'passed' && playout.terminal === 'checkmate-by-user'
                ? 'Checkmate — converted.'
                : target === 'win'
                  ? 'Win secured — position held.'
                  : 'Draw held.'}
            </FeedbackBadge>
            <p className="text-text-secondary text-sm">
              In the game this ended in a {drillData.deservedResult === 'win' ? 'draw or loss' : 'loss'}.
              This time you kept the {target === 'win' ? 'full point' : 'half point'}.
            </p>
            <button className="btn-primary mt-auto" onClick={() => training.advance()}>
              Next (Space)
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
              <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm flex flex-col gap-1">
                <p>
                  <span className="text-text-secondary">You played </span>
                  <span className="font-mono font-bold text-incorrect">
                    {playout.slip.playedSan ?? playout.slip.playedUci}
                  </span>
                </p>
                {playout.slip.bestSan && (
                  <p>
                    <span className="text-text-secondary">Engine held with </span>
                    <span className="font-mono font-bold text-correct">{playout.slip.bestSan}</span>
                  </p>
                )}
              </div>
            )}
            <button className="btn-primary mt-auto" onClick={() => training.requeueAndAdvance()}>
              Continue (Space)
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
