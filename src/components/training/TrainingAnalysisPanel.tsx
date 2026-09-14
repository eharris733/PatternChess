import clsx from 'clsx';
import { MoveSequencePanel } from '../MoveSequencePanel';
import { LineTabs, type LineTab } from './LineTabs';
import { ProgressBar } from '../ProgressBar';
import { FeedbackBadge } from '../FeedbackBadge';
import { WinningChancesDisplay } from '../WinningChancesDisplay';
import { PositionSrState } from './PositionSrState';
import { BlunderContextBadges } from './BlunderContextBadges';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { orderedPlayers } from '../../models/gameRecord';
import { Blunder } from '../../models/blunder';
import type { TrainingStateShape } from '../../state/trainingStore';

interface TrainingAnalysisPanelProps {
  state: TrainingStateShape;
  blunder: Blunder | undefined;
  activeTab: LineTab;
  setActiveTab: (t: LineTab) => void;
  revealBeforeSolve: boolean;
  showEngineEvals: boolean;
  refutationLabel: string;
  triedSan: string | null;
  stepRefutation: (dir: 1 | -1) => void;
  stepPostCorrect: (dir: 1 | -1) => void;
  stepPlayedRefutation: (dir: 1 | -1) => void;
  stopAutoplay: () => void;
  paused: boolean;
  deleting: boolean;
  onShareClick: () => void;
  onDeleteClick: () => void;
}

/**
 * The training screen's right-hand analysis sidebar: SR state, context badges,
 * the winning-chances swing, the per-phase move-sequence/refutation panels, the
 * recall progress bar, and the share/delete triggers. Extracted verbatim from
 * TrainingRoute — a presentational renderer of the training store snapshot plus
 * a few view-local callbacks.
 */
export function TrainingAnalysisPanel({
  state,
  blunder,
  activeTab,
  setActiveTab,
  revealBeforeSolve,
  showEngineEvals,
  refutationLabel,
  triedSan,
  stepRefutation,
  stepPostCorrect,
  stepPlayedRefutation,
  stopAutoplay,
  paused,
  deleting,
  onShareClick,
  onDeleteClick,
}: TrainingAnalysisPanelProps) {
  return (
    <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
      <header className="flex items-center justify-between">
        <span className="label">
          {state.game && blunder
            ? orderedPlayers(
                state.game.username,
                state.game.opponent,
                blunder.sideToMove === 'white' ? 'white' : 'black',
              ).join(' vs ')
            : state.game
              ? `${state.game.username} vs ${state.game.opponent}`
              : 'Training'}
        </span>
        <span className="font-mono text-xs tabular-nums text-gold-dark">
          {`${state.currentIndex + 1}/${state.blunders.length}`}
        </span>
      </header>

      {state.pendingTryAgain && (
        <div className="flex items-center gap-2 rounded-none border-2 border-mistake/50 bg-mistake/15 px-3 py-2">
          <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight bg-mistake/30 text-mistake border-2 border-mistake/60">
            Retry
          </span>
          <span className="text-xs text-text-primary">You missed this last time</span>
        </div>
      )}

      {blunder && (
        <PositionSrState
          blunder={blunder}
          showTryAgainLabel={state.pendingTryAgain}
          showNextReview={state.phase === 'reviewing' || state.phase === 'solving'}
        />
      )}

      {state.currentContext && <BlunderContextBadges context={state.currentContext} />}

      {blunder && (revealBeforeSolve || state.phase !== 'solving') && (
        <WinningChancesDisplay
          // "Your try" (the default view of a wrong-answer toggle) shows the
          // swing for the move just played, not the original blunder's swing.
          evalBefore={
            activeTab !== 'refutation' && state.livePlayedEval
              ? state.livePlayedEval.before
              : blunder.evalBefore
          }
          evalAfter={
            activeTab !== 'refutation' && state.livePlayedEval
              ? state.livePlayedEval.after
              : blunder.evalAfter
          }
          showEngineEvals={showEngineEvals}
        />
      )}

      {state.phase === 'reviewing' && blunder && (
        <>
          <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm">
            <span className="text-text-secondary">You played </span>
            <span className="font-mono font-bold text-incorrect">{state.blunderSan}</span>
          </div>
          {state.refutationPairs.length > 0 && (
            <div>
              <p className="label mb-2">Engine refutation</p>
              <MoveSequencePanel
                pairs={state.refutationPairs}
                onStep={stepRefutation}
                stepArrowsDesktopOnly
                activeKey={
                  state.activeRefutationIndex !== null
                    ? `r${state.activeRefutationIndex}`
                    : null
                }
                onSelect={(key) => {
                  const i = Number.parseInt(key.slice(1), 10);
                  if (!Number.isNaN(i)) state.selectRefutationIndex(i);
                }}
              />
            </div>
          )}
          <p className="text-text-primary font-semibold">
            Find a better move for {blunder.sideToMove === 'white' ? 'White' : 'Black'}.
          </p>
          <button className="btn-primary" onClick={() => state.proceedFromReview()}>
            I'm ready<span className="hidden lg:inline ml-1.5"> (Space)</span>
          </button>
        </>
      )}

      {state.phase === 'solving' && blunder && (
        <>
          <div className="flex items-center gap-2 text-text-primary">
            <span
              className={clsx(
                'w-3 h-3 rounded-full border-2 border-text-primary',
                blunder.sideToMove === 'white' ? 'bg-surface' : 'bg-black',
              )}
            />
            <span className="font-medium">
              {blunder.sideToMove === 'white' ? 'White' : 'Black'} to play
            </span>
            {state.userMovesRequired > 1 && (
              <span className="ml-auto font-mono uppercase text-[10px] tracking-tight text-text-secondary">
                Move {Math.floor(state.drillPly / 2) + 1} of {state.userMovesRequired}
              </span>
            )}
          </div>

          {state.stepFeedback && (
            <FeedbackBadge tone="success">{state.stepFeedback}</FeedbackBadge>
          )}

          {revealBeforeSolve && (
            <button
              className="text-left bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm hover:bg-text-primary/5 transition-colors"
              onClick={() => state.toggleShowWhatYouPlayed()}
              type="button"
            >
              <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
                {state.showWhatYouPlayed ? 'Hide' : 'See'} what you played
              </span>
              {state.showWhatYouPlayed && (
                <p className="font-mono font-bold text-incorrect mt-1">{state.blunderSan}</p>
              )}
            </button>
          )}

          {state.hintLevel === 1 && (
            <p className="text-text-secondary text-xs">Piece highlighted — find the move for full credit.</p>
          )}
          {state.hintLevel === 2 && (
            <p className="text-text-secondary text-xs">Move shown — no credit for this attempt.</p>
          )}

          {state.evaluating && (
            <FeedbackBadge tone="info">Analyzing your move…</FeedbackBadge>
          )}
        </>
      )}

      {state.phase === 'correct' && (
        <>
          <FeedbackBadge tone="success">Solution correct</FeedbackBadge>
          <LineTabs
            tabs={[
              { key: 'continuation', label: 'Continuation' },
              { key: 'refutation', label: `Your game: ${state.blunderSan}` },
            ]}
            active={activeTab === 'refutation' ? 'refutation' : 'continuation'}
            onSelect={setActiveTab}
          />
          {activeTab !== 'refutation' ? (
            state.postCorrectPairs.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => state.selectPostCorrectIndex(-1)}
                  className={clsx(
                    'w-full text-left font-mono text-[13px] rounded-none px-2 py-1.5 transition-colors hover:bg-accent/10',
                    state.activePostCorrectIndex === -1
                      ? 'bg-accent/15 ring-1 ring-inset ring-accent text-text-primary'
                      : 'text-text-secondary',
                  )}
                >
                  Puzzle start
                </button>
                <MoveSequencePanel
                  pairs={state.postCorrectPairs}
                  onStep={stepPostCorrect}
                  stepArrowsDesktopOnly
                  activeKey={
                    state.activePostCorrectIndex !== null && state.activePostCorrectIndex >= 0
                      ? `p${state.activePostCorrectIndex}`
                      : null
                  }
                  onSelect={(key) => {
                    const i = Number.parseInt(key.slice(1), 10);
                    if (!Number.isNaN(i)) state.selectPostCorrectIndex(i);
                  }}
                />
              </div>
            ) : (
              <p className="text-text-secondary text-sm">Calculating continuation…</p>
            )
          ) : (
            <div>
              <p className="label mb-2">{refutationLabel}</p>
              {state.refutationPairs.length > 0 ? (
                <MoveSequencePanel
                  pairs={state.refutationPairs}
                  onStep={stepRefutation}
                  stepArrowsDesktopOnly
                  activeKey={
                    state.activeRefutationIndex !== null
                      ? `r${state.activeRefutationIndex}`
                      : null
                  }
                  onSelect={(key) => {
                    const i = Number.parseInt(key.slice(1), 10);
                    if (!Number.isNaN(i)) state.selectRefutationIndex(i);
                  }}
                />
              ) : (
                <p className="text-text-secondary text-sm">Calculating…</p>
              )}
            </div>
          )}
          <button className="btn-primary mt-auto" onClick={() => state.advance()}>
            Next<span className="hidden lg:inline ml-1.5"> (Space)</span>
          </button>
        </>
      )}

      {state.phase === 'incorrect' && state.incorrectFeedback && (
        <>
          <FeedbackBadge tone={state.incorrectFeedback.tone}>
            {state.incorrectFeedback.message}
          </FeedbackBadge>
          {state.incorrectRequeue ? (
            <>
              <LineTabs
                tabs={[
                  {
                    key: 'playedRefutation',
                    label: triedSan ? `Your try: ${triedSan}` : 'Your try',
                  },
                  { key: 'refutation', label: `Your game: ${state.blunderSan}` },
                ]}
                active={activeTab === 'refutation' ? 'refutation' : 'playedRefutation'}
                onSelect={setActiveTab}
              />
              {activeTab !== 'refutation' ? (
                state.playedRefutationPairs.length > 0 ? (
                  <MoveSequencePanel
                    pairs={state.playedRefutationPairs}
                    onStep={stepPlayedRefutation}
                    stepArrowsDesktopOnly
                    activeKey={
                      state.activePlayedRefutationIndex !== null
                        ? `r${state.activePlayedRefutationIndex}`
                        : null
                    }
                    onSelect={(key) => {
                      const i = Number.parseInt(key.slice(1), 10);
                      if (!Number.isNaN(i)) {
                        stopAutoplay();
                        state.selectPlayedRefutationIndex(i);
                      }
                    }}
                  />
                ) : (
                  <p className="text-text-secondary text-sm">No engine line for this move.</p>
                )
              ) : (
                <div>
                  <p className="label mb-2">{refutationLabel}</p>
                  {state.refutationPairs.length > 0 ? (
                    <MoveSequencePanel
                      pairs={state.refutationPairs}
                      onStep={stepRefutation}
                      stepArrowsDesktopOnly
                      activeKey={
                        state.activeRefutationIndex !== null
                          ? `r${state.activeRefutationIndex}`
                          : null
                      }
                      onSelect={(key) => {
                        const i = Number.parseInt(key.slice(1), 10);
                        if (!Number.isNaN(i)) state.selectRefutationIndex(i);
                      }}
                    />
                  ) : (
                    <p className="text-text-secondary text-sm">Calculating…</p>
                  )}
                </div>
              )}
            </>
          ) : null}
          <button
            className="btn-primary mt-auto"
            onClick={() =>
              state.incorrectRequeue ? state.requeueAndAdvance() : state.retry()
            }
          >
            {state.incorrectRequeue ? 'Continue' : 'Try again'}
            <span className="hidden lg:inline ml-1.5"> (Space)</span>
          </button>
          {state.incorrectRequeue && (
            <p className="text-text-secondary text-xs text-center -mt-1">
              Comes back later this session
            </p>
          )}
        </>
      )}

      <div className="mt-auto pt-2 flex flex-col gap-3">
        <ProgressBar
          current={Math.round(
            state.totalAttempted > 0 ? (state.totalCorrect / state.totalAttempted) * 100 : 0,
          )}
          total={100}
          label="Recall rate"
        />
        {blunder && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost text-xs inline-flex items-center justify-center gap-1.5 text-text-secondary hover:text-text-primary"
              onClick={onShareClick}
              title="Share a public link to this puzzle"
            >
              <ShareIcon className="h-3.5 w-3.5" />
              Share puzzle
            </button>
            <button
              type="button"
              className="btn-ghost text-xs inline-flex items-center justify-center gap-1.5 text-text-secondary hover:text-incorrect"
              onClick={onDeleteClick}
              disabled={state.evaluating || paused || deleting}
              title="Delete this position from your training"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete position
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
