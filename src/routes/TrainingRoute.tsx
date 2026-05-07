import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useTrainingStore } from '../state/trainingStore';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { useSyncStore } from '../state/syncStore';
import { BoardPanel } from '../components/BoardPanel';
import { MoveSequencePanel } from '../components/MoveSequencePanel';
import { ProgressBar } from '../components/ProgressBar';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { WinningChancesDisplay } from '../components/WinningChancesDisplay';
import { classify, winningChancesLost } from '../chess/winningChances';

interface LocationState {
  gameIds?: string[];
}

const SHORT_LABEL = (cl: ReturnType<typeof classify>) =>
  cl === 'blunder' ? 'Blunder' : cl === 'inaccuracy' ? 'Inaccuracy' : 'Mistake';

export function TrainingRoute() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: LocationState };
  const { profile } = useAuth();

  const state = useTrainingStore();
  const setBlunders = useTrainingStore((s) => s.setBlunders);

  const dueBlunders = useDueBlunders(location.state?.gameIds);
  const initialBlunders = dueBlunders.data;

  useEffect(() => {
    if (!initialBlunders) return;
    // Only initialize the store from the query when we haven't started training yet
    // (loading) or when the queue was empty (waiting for a sync to populate).
    // Don't interrupt an active session (reviewing/solving/correct/incorrect/complete).
    const { phase } = useTrainingStore.getState();
    if (phase === 'loading' || phase === 'empty') {
      setBlunders(initialBlunders);
    }
  }, [initialBlunders, setBlunders]);

  useEffect(
    () => () => {
      useTrainingStore.getState().reset();
    },
    [],
  );

  const triggerNow = useSyncStore((s) => s.triggerNow);
  const isSyncing = useSyncStore((s) => {
    const busy = (phase: string) =>
      phase === 'fetching' || phase === 'inserting' || phase === 'analyzing';
    return busy(s.providers.lichess.phase) || busy(s.providers.chesscom.phase);
  });
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (state.phase === 'reviewing') state.proceedFromReview();
        else if (state.phase === 'correct') state.advance();
        else if (state.phase === 'incorrect') state.retry();
      } else if (e.code === 'ArrowRight') {
        if (state.phase === 'correct' && state.postCorrectMoves.length > 0) {
          state.selectPostCorrectIndex((state.activePostCorrectIndex ?? -1) + 1);
        } else if (state.phase === 'reviewing' && state.refutationMoves.length > 0) {
          state.selectRefutationIndex((state.activeRefutationIndex ?? -1) + 1);
        }
      } else if (e.code === 'ArrowLeft') {
        if (state.phase === 'correct' && state.postCorrectMoves.length > 0) {
          state.selectPostCorrectIndex((state.activePostCorrectIndex ?? 0) - 1);
        } else if (state.phase === 'reviewing' && state.refutationMoves.length > 0) {
          state.selectRefutationIndex((state.activeRefutationIndex ?? 0) - 1);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (dueBlunders.isLoading || state.phase === 'loading') {
    return <div className="text-text-secondary text-sm">Loading…</div>;
  }

  if (state.phase === 'empty' || (state.phase === 'complete' && state.totalAttempted === 0)) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">No blunders due</h1>
        <p className="text-text-secondary text-sm">
          {hasAccount
            ? 'Sync your latest games to fill the queue.'
            : 'Link a Lichess or Chess.com account to start.'}
        </p>
        {hasAccount ? (
          <button
            className="btn-primary"
            disabled={isSyncing || !profile}
            onClick={() => profile && void triggerNow(profile)}
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        ) : (
          <button className="btn-primary" onClick={() => navigate('/profile')}>
            Go to Profile
          </button>
        )}
      </div>
    );
  }

  if (state.phase === 'complete') {
    const pct = state.totalAttempted > 0 ? Math.round((state.totalCorrect / state.totalAttempted) * 100) : 0;
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <span className="text-5xl">🏆</span>
        <h1 className="heading-lg">Cycle complete</h1>
        <p className="text-text-secondary">
          {pct}% recall · {state.totalCorrect}/{state.totalAttempted} correct
        </p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          Back to dashboard
        </button>
      </div>
    );
  }

  const blunder = state.blunders[state.currentIndex];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        <BoardPanel
          fen={state.fen}
          orientation={state.orientation}
          movableFor={state.phase === 'solving' ? state.movableFor : null}
          lastMove={state.lastMove}
          shapes={state.shapes}
          onMove={(m) => state.processMove(m)}
        />
      </div>

      <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-center justify-between">
          <span className="label">{state.game ? `${state.game.username} vs ${state.game.opponent}` : 'Training'}</span>
          <span className="text-xs font-mono text-accent-light">
            {`${state.currentIndex + 1}/${state.blunders.length}`}
          </span>
        </header>

        {blunder && (
          <WinningChancesDisplay evalBefore={blunder.evalBefore} evalAfter={blunder.evalAfter} />
        )}

        {state.phase === 'reviewing' && blunder && (
          <>
            <div className="bg-surface-2 rounded-md p-3 text-sm">
              <span className="text-text-secondary">You played </span>
              <span className="font-mono font-bold text-incorrect">{state.blunderSan}</span>
              <p className="text-incorrect text-xs font-bold mt-1 uppercase tracking-wider">
                {SHORT_LABEL(classify(winningChancesLost(blunder.evalBefore, blunder.evalAfter)))}
              </p>
            </div>
            {state.refutationPairs.length > 0 && (
              <div>
                <p className="label mb-2">Engine refutation</p>
                <MoveSequencePanel
                  pairs={state.refutationPairs}
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
              I'm ready (Space)
            </button>
          </>
        )}

        {state.phase === 'solving' && blunder && (
          <>
            <div className="flex items-center gap-2 text-text-primary">
              <span
                className={clsx(
                  'w-3 h-3 rounded-full border border-text-secondary',
                  blunder.sideToMove === 'white' ? 'bg-white' : 'bg-black',
                )}
              />
              <span className="font-medium">
                {blunder.sideToMove === 'white' ? 'White' : 'Black'} to play
              </span>
            </div>

            <button
              className="text-left bg-surface-2 rounded-md p-3 text-sm hover:bg-surface-2/70 transition"
              onClick={() => state.toggleShowWhatYouPlayed()}
              type="button"
            >
              <span className="text-text-secondary text-xs uppercase tracking-wider">
                {state.showWhatYouPlayed ? 'Hide' : 'See'} what you played
              </span>
              {state.showWhatYouPlayed && (
                <p className="font-mono font-bold text-incorrect mt-1">{state.blunderSan}</p>
              )}
            </button>

            <button
              type="button"
              onClick={() => state.showHint()}
              disabled={state.hintLevel >= 2 || state.evaluating}
              className="text-left bg-surface-2 rounded-md p-3 text-sm hover:bg-surface-2/70 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-text-secondary text-xs uppercase tracking-wider">
                {state.hintLevel === 0
                  ? 'Show hint'
                  : state.hintLevel === 1
                    ? 'Show the move'
                    : 'Hint shown'}
              </span>
              {state.hintLevel > 0 && (
                <p className="text-text-secondary text-xs mt-1">
                  Counts as a fail for recall.
                </p>
              )}
            </button>

            {state.evaluating && (
              <FeedbackBadge tone="info">Analyzing your move…</FeedbackBadge>
            )}
          </>
        )}

        {state.phase === 'correct' && (
          <>
            <FeedbackBadge tone="success">Solution correct</FeedbackBadge>
            {state.postCorrectPairs.length > 0 ? (
              <div>
                <p className="label mb-2">Game may have continued</p>
                <MoveSequencePanel
                  pairs={state.postCorrectPairs}
                  activeKey={
                    state.activePostCorrectIndex !== null
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
            )}
            <button className="btn-primary mt-auto" onClick={() => state.advance()}>
              Next (Space)
            </button>
          </>
        )}

        {state.phase === 'incorrect' && state.incorrectFeedback && (
          <>
            <FeedbackBadge tone={state.incorrectFeedback.tone}>
              {state.incorrectFeedback.message}
            </FeedbackBadge>
            <button className="btn-primary mt-auto" onClick={() => state.retry()}>
              Retry (Space)
            </button>
          </>
        )}

        <div className="mt-auto pt-2">
          <ProgressBar
            current={Math.round(
              state.totalAttempted > 0 ? (state.totalCorrect / state.totalAttempted) * 100 : 0,
            )}
            total={100}
            label="Recall rate"
          />
        </div>
      </aside>
    </div>
  );
}
