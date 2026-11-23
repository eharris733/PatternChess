import clsx from 'clsx';
import { MoveSequencePanel } from '../MoveSequencePanel';
import { LineTabs, type LineTab } from './LineTabs';
import { ProgressBar } from '../ProgressBar';
import { FeedbackBadge } from '../FeedbackBadge';
import { WinningChancesDisplay } from '../WinningChancesDisplay';
import { PositionSrState } from './PositionSrState';
import { BlunderContextBadges } from './BlunderContextBadges';
import { OpeningTheoryNote } from './OpeningTheoryNote';
import { OpeningVerdictPanel } from './OpeningVerdictPanel';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { orderedPlayers } from '../../models/gameRecord';
import { Blunder } from '../../models/blunder';
import type { TrainingStateShape } from '../../state/trainingStore';
import { useT } from '../../i18n/useT';

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
  stepSolution: (dir: 1 | -1) => void;
  /** Drill-feedback pref: add the Solution tab after a miss. */
  showAnswer: boolean;
  stopAutoplay: () => void;
  /** Opening intro: jump straight to the prompt. */
  onSkipIntro: () => void;
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
  stepSolution,
  showAnswer,
  stopAutoplay,
  onSkipIntro,
  paused,
  deleting,
  onShareClick,
  onDeleteClick,
}: TrainingAnalysisPanelProps) {
  const t = useT();
  const solutionVisible = showAnswer && state.solutionMoves.length > 0;
  // Opening drills reveal their kind through the intro, so they can be named
  // throughout; tactics and endgames stay concealed until the first move.
  const openingData =
    blunder?.kind === 'opening' && blunder.drillData && 'theoryMoves' in blunder.drillData
      ? blunder.drillData
      : null;
  const isOpening = blunder?.kind === 'opening';
  return (
    <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto [&_.btn-primary]:mr-[3px] [&_.btn-primary]:mb-[3px]">
      <header className="flex items-center justify-between">
        <span className="label">
          {state.game && blunder
            ? orderedPlayers(
                state.game.username,
                state.game.opponent,
                blunder.sideToMove === 'white' ? 'white' : 'black',
              ).reduce((a, b) => t('train.panel.vs', { a, b }))
            : state.game
              ? t('train.panel.vs', { a: state.game.username, b: state.game.opponent })
              : t('train.panel.training')}
        </span>
        <span className="font-mono text-xs tabular-nums text-gold-dark">
          {`${state.currentIndex + 1}/${state.blunders.length}`}
        </span>
      </header>

      {state.pendingTryAgain && (
        <div className="flex items-center gap-2 rounded-none border-2 border-mistake/50 bg-mistake/15 px-3 py-2">
          <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight bg-mistake/30 text-mistake border-2 border-mistake/60">
            {t('train.panel.retry')}
          </span>
          <span className="text-xs text-text-primary">{t('train.panel.missedLastTime')}</span>
        </div>
      )}

      {blunder && (
        <PositionSrState
          blunder={blunder}
          showTryAgainLabel={state.pendingTryAgain}
          showNextReview={
            state.phase === 'reviewing' || state.phase === 'solving' || state.phase === 'introducing'
          }
          practiceDueAt={state.phase === 'correct' ? state.practiceDueAt : null}
        />
      )}

      {isOpening && (openingData?.openingName || openingData?.openingFamily) && (
        <p className="text-text-primary font-semibold" data-testid="opening-drill-name">
          {openingData.openingName ?? openingData.openingFamily}
        </p>
      )}

      {state.phase === 'introducing' && (
        <>
          <p className="text-text-primary">{t('train.panel.introGame')}</p>
          <button type="button" className="btn-outline self-start" onClick={onSkipIntro} data-testid="skip-intro">
            {t('train.panel.skipIntro')}<span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
          </button>
        </>
      )}

      {state.currentContext && <BlunderContextBadges context={state.currentContext} />}

      {blunder && state.phase !== 'introducing' && (revealBeforeSolve || state.phase !== 'solving') && (
        (() => {
          // "Your try" (the default view after an attempt) shows the swing of
          // the move just played; otherwise the move from the user's game.
          const live = activeTab !== 'refutation' ? state.livePlayedEval : null;
          return (
            <WinningChancesDisplay
              evalBefore={live ? live.before : blunder.evalBefore}
              evalAfter={live ? live.after : blunder.evalAfter}
              mover={blunder.sideToMove === 'white' ? 'white' : 'black'}
              label={
                live
                  ? live.san
                    ? t('train.panel.yourMoveSan', { san: live.san })
                    : t('train.panel.yourMove')
                  : state.blunderSan
                    ? t('train.panel.yourGameSan', { san: state.blunderSan })
                    : null
              }
              showEngineEvals={showEngineEvals}
            />
          );
        })()
      )}

      {state.phase === 'reviewing' && blunder && (
        <>
          <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm">
            <span className="text-text-primary">{t('train.panel.youPlayed')} </span>
            <span className="font-mono font-bold text-incorrect">{state.blunderSan}</span>
          </div>
          {state.refutationPairs.length > 0 && (
            <div>
              <p className="label mb-2">{t('train.panel.engineRefutation')}</p>
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
            {blunder.sideToMove === 'white' ? t('train.panel.findBetterWhite') : t('train.panel.findBetterBlack')}
          </p>
          <button className="btn-primary" onClick={() => state.proceedFromReview()}>
            {t('train.panel.ready')}<span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
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
            <span className="font-medium" data-testid="drill-prompt">
              {blunder.sideToMove === 'white'
                ? isOpening
                  ? t('train.panel.playMoveWhite')
                  : t('train.panel.whiteToPlay')
                : isOpening
                  ? t('train.panel.playMoveBlack')
                  : t('train.panel.blackToPlay')}
            </span>
            {state.userMovesRequired > 1 && (
              <span className="ml-auto font-mono text-xs tabular-nums text-text-primary">
                {t('train.panel.moveOf', { at: Math.floor(state.drillPly / 2) + 1, total: state.userMovesRequired })}
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
              <span className="text-xs font-semibold text-text-primary">
                {state.showWhatYouPlayed ? t('train.panel.hideWhatPlayed') : t('train.panel.seeWhatPlayed')}
              </span>
              {state.showWhatYouPlayed && (
                <p className="font-mono font-bold text-incorrect mt-1">{state.blunderSan}</p>
              )}
            </button>
          )}

          {state.hintLevel === 1 && (
            <p className="text-text-primary text-xs">{t('train.panel.hint1')}</p>
          )}
          {state.hintLevel === 2 && (
            <p className="text-text-primary text-xs">{t('train.panel.hint2')}</p>
          )}

          {state.evaluating && (
            <FeedbackBadge tone="info">{t('train.panel.analyzing')}</FeedbackBadge>
          )}
        </>
      )}

      {state.phase === 'correct' && (
        <>
          {blunder && state.openingVerdict ? (
            <OpeningVerdictPanel blunder={blunder} verdict={state.openingVerdict} />
          ) : (
            <>
              <FeedbackBadge tone="success">{t('train.solutionCorrect')}</FeedbackBadge>
              {blunder && <OpeningTheoryNote blunder={blunder} />}
            </>
          )}
          <LineTabs
            tabs={[
              { key: 'continuation', label: t('train.panel.continuation') },
              { key: 'refutation', label: t('train.panel.yourGameSan', { san: state.blunderSan }) },
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
                      : 'text-text-primary',
                  )}
                >
                  {t('train.panel.puzzleStart')}
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
              <p className="text-text-primary text-sm">{t('train.panel.calcContinuation')}</p>
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
                <p className="text-text-primary text-sm">{t('train.panel.calculating')}</p>
              )}
            </div>
          )}
          <button className="btn-primary mt-auto" onClick={() => state.advance()}>
            {t('common.next')}<span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
          </button>
        </>
      )}

      {state.phase === 'incorrect' && state.incorrectFeedback && (
        <>
          <FeedbackBadge tone={state.incorrectFeedback.tone}>
            {state.incorrectFeedback.message}
          </FeedbackBadge>
          {/* Names the answer, so it follows the show-answer pref and never
              appears on a retry-in-place. */}
          {blunder && showAnswer && state.incorrectRequeue && <OpeningTheoryNote blunder={blunder} />}
          {state.incorrectRequeue ? (
            <>
              <LineTabs
                tabs={[
                  {
                    key: 'playedRefutation',
                    label: triedSan ? t('train.panel.yourTrySan', { san: triedSan }) : t('train.panel.yourTry'),
                  },
                  ...(solutionVisible
                    ? [
                        {
                          key: 'solution' as const,
                          label: t('train.panel.solutionSan', { san: state.solutionMoves[0].san }),
                        },
                      ]
                    : []),
                  { key: 'refutation', label: t('train.panel.yourGameSan', { san: state.blunderSan }) },
                ]}
                active={
                  activeTab === 'refutation' || (activeTab === 'solution' && solutionVisible)
                    ? activeTab
                    : 'playedRefutation'
                }
                onSelect={(key) => {
                  stopAutoplay();
                  setActiveTab(key);
                  if (key === 'solution') state.selectSolutionIndex(-1);
                }}
              />
              {activeTab === 'solution' && solutionVisible ? (
                <MoveSequencePanel
                  pairs={state.solutionPairs}
                  onStep={stepSolution}
                  stepArrowsDesktopOnly
                  activeKey={
                    state.activeSolutionIndex !== null && state.activeSolutionIndex >= 0
                      ? `r${state.activeSolutionIndex}`
                      : null
                  }
                  onSelect={(key) => {
                    const i = Number.parseInt(key.slice(1), 10);
                    if (!Number.isNaN(i)) {
                      stopAutoplay();
                      state.selectSolutionIndex(i);
                    }
                  }}
                />
              ) : activeTab !== 'refutation' ? (
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
                  <p className="text-text-primary text-sm">{t('train.panel.noEngineLine')}</p>
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
                    <p className="text-text-primary text-sm">{t('train.panel.calculating')}</p>
                  )}
                </div>
              )}
            </>
          ) : null}
          <button
            className="btn-primary mt-auto"
            onClick={() =>
              state.incorrectRequeue && !isOpening ? state.requeueAndAdvance() : state.retry()
            }
          >
            {state.incorrectRequeue && !isOpening ? t('train.continue') : t('common.tryAgain')}
            <span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
          </button>
          {state.incorrectRequeue && !isOpening && (
            <p className="text-text-primary text-xs text-center -mt-1">
              {t('train.panel.comesBack')}
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
          label={t('train.panel.recallRate')}
        />
        {blunder && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost text-xs inline-flex items-center justify-center gap-1.5 text-text-primary hover:text-text-primary"
              onClick={onShareClick}
            >
              <ShareIcon className="h-3.5 w-3.5" />
              {t('train.panel.share')}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs inline-flex items-center justify-center gap-1.5 text-text-primary hover:text-incorrect"
              onClick={onDeleteClick}
              disabled={state.evaluating || paused || deleting}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {t('train.panel.delete')}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
