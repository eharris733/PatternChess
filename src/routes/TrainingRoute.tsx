import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useTrainingStore } from '../state/trainingStore';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { useSyncStore } from '../state/syncStore';
import { BoardPanel } from '../components/BoardPanel';
import { BoardActionBar } from '../components/BoardActionBar';
import { MoveSequencePanel } from '../components/MoveSequencePanel';
import { ProgressBar } from '../components/ProgressBar';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { WinningChancesDisplay } from '../components/WinningChancesDisplay';
import { PositionSrState } from '../components/training/PositionSrState';
import { BlunderContextBadges } from '../components/training/BlunderContextBadges';
import { classify, winningChancesLost } from '../chess/winningChances';
import {
  ContextFilter,
  GAME_STATE_LABEL,
  computeBlunderContext,
} from '../chess/blunderContext';
import { Blunder } from '../models/blunder';
import { GameRecord } from '../models/gameRecord';
import { supabase } from '../lib/supabase';
import { gameRecordFromJson } from '../models/gameRecord';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';

interface LocationState {
  gameIds?: string[];
  contextFilter?: ContextFilter;
}

function filterLabel(filter: ContextFilter): string {
  if (filter === 'timeTrouble') return 'Time trouble';
  return GAME_STATE_LABEL[filter];
}

async function fetchGamesByIds(ids: string[]): Promise<Map<string, GameRecord>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('games').select().in('id', ids);
  if (error) throw error;
  const map = new Map<string, GameRecord>();
  for (const row of data ?? []) {
    const g = gameRecordFromJson(row);
    map.set(g.id, g);
  }
  return map;
}

function applyContextFilter(
  blunders: Blunder[],
  games: Map<string, GameRecord>,
  filter: ContextFilter,
): Blunder[] {
  return blunders.filter((b) => {
    const ctx = computeBlunderContext(b, games.get(b.gameId) ?? null);
    if (filter === 'timeTrouble') return ctx.inTimeTrouble;
    return ctx.gameState === filter;
  });
}

const SHORT_LABEL = (cl: ReturnType<typeof classify>) =>
  cl === 'blunder' ? 'Blunder' : cl === 'inaccuracy' ? 'Inaccuracy' : 'Mistake';

export function TrainingRoute() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: LocationState };
  const { profile, refreshProfile } = useAuth();

  const state = useTrainingStore();
  const setBlunders = useTrainingStore((s) => s.setBlunders);
  const setContextFilter = useTrainingStore((s) => s.setContextFilter);
  const beginSession = useTrainingStore((s) => s.beginSession);

  const contextFilter = location.state?.contextFilter ?? null;
  const dueBlunders = useDueBlunders(location.state?.gameIds);
  const dueData = dueBlunders.data;

  // Batch-fetch the games these blunders belong to, only when a context filter is
  // active (otherwise the per-blunder game fetch in the store is enough).
  const gameIdsForFilter = useMemo(() => {
    if (!contextFilter || !dueData) return null;
    const ids = new Set<string>();
    for (const b of dueData) ids.add(b.gameId);
    return Array.from(ids);
  }, [contextFilter, dueData]);

  const filterGamesQuery = useQuery({
    queryKey: ['training', 'filterGames', gameIdsForFilter],
    queryFn: () => fetchGamesByIds(gameIdsForFilter ?? []),
    enabled: !!contextFilter && !!gameIdsForFilter,
  });

  const filteredBlunders = useMemo(() => {
    if (!dueData) return null;
    if (!contextFilter) return dueData;
    if (!filterGamesQuery.data) return null; // wait for game data
    return applyContextFilter(dueData, filterGamesQuery.data, contextFilter);
  }, [dueData, contextFilter, filterGamesQuery.data]);

  useEffect(() => {
    setContextFilter(contextFilter);
  }, [contextFilter, setContextFilter]);

  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setPaused(false);
  }, [state.currentIndex]);

  useEffect(() => {
    if (!filteredBlunders) return;
    // Only initialize the store from the query when we haven't started training yet
    // (loading) or when the queue was empty (waiting for a sync to populate).
    // Don't interrupt an active session (reviewing/solving/correct/incorrect/complete).
    const { phase } = useTrainingStore.getState();
    if (phase === 'loading' || phase === 'empty') {
      setBlunders(filteredBlunders);
      if (filteredBlunders.length > 0 && profile) {
        void beginSession(profile);
      }
    }
  }, [filteredBlunders, profile, setBlunders, beginSession]);

  const refreshProfileRef = useRef(refreshProfile);
  useEffect(() => {
    refreshProfileRef.current = refreshProfile;
  }, [refreshProfile]);

  useEffect(
    () => () => {
      useTrainingStore.getState().reset();
      void refreshProfileRef.current();
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

  if (
    dueBlunders.isLoading ||
    (contextFilter && filterGamesQuery.isLoading) ||
    state.phase === 'loading'
  ) {
    return <div className="text-text-secondary text-sm">Loading…</div>;
  }

  if (state.phase === 'empty' || (state.phase === 'complete' && state.totalAttempted === 0)) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">
          {contextFilter
            ? `No ${filterLabel(contextFilter).toLowerCase()} blunders due`
            : 'No blunders due'}
        </h1>
        <p className="text-text-secondary text-sm">
          {contextFilter
            ? 'Try drilling the full queue or come back after another sync.'
            : hasAccount
              ? 'Sync your latest games to fill the queue.'
              : 'Link a Lichess or Chess.com account to start.'}
        </p>
        {contextFilter && (
          <button className="btn-outline" onClick={() => navigate('/training', { replace: true })}>
            Drill full queue
          </button>
        )}
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
        <button className="btn-primary" onClick={() => navigate('/dashboard')}>
          Back to dashboard
        </button>
      </div>
    );
  }

  const blunder = state.blunders[state.currentIndex];

  const externalPlatform = resolvePlatform(state.game?.platform, 'lichess');
  const externalAnalysis =
    externalPlatform && state.fen
      ? externalAnalysisUrl(externalPlatform, state.fen, {
          startFen: blunder?.fen,
          movesFromStart: state.playedMovesFromBlunder,
        })
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-3">
        {contextFilter && (
          <div className="flex items-baseline justify-between rounded-md bg-surface-2/60 px-3 py-2">
            <span className="text-xs uppercase tracking-wider text-accent-light font-bold">
              {filterLabel(contextFilter)} · {state.blunders.length} blunder
              {state.blunders.length === 1 ? '' : 's'}
            </span>
            <button
              className="text-xs text-text-secondary hover:text-text-primary"
              onClick={() => navigate('/training', { replace: true })}
            >
              Clear filter
            </button>
          </div>
        )}
        <div
          className={clsx(
            'transition duration-200',
            paused && 'blur-md pointer-events-none select-none',
          )}
          aria-hidden={paused}
        >
          <BoardPanel
            fen={state.fen}
            orientation={state.orientation}
            movableFor={state.phase === 'solving' && !paused ? state.movableFor : null}
            lastMove={state.lastMove}
            shapes={state.shapes}
            onMove={(m) => state.processMove(m)}
          />
        </div>

        <BoardActionBar
          resetKey={state.currentIndex}
          running={state.phase === 'solving' && !state.evaluating && !paused}
          paused={paused}
          onTogglePaused={() => setPaused((p) => !p)}
          showHint={state.phase === 'solving'}
          hintLevel={state.hintLevel}
          hintDisabled={state.hintLevel >= 2 || state.evaluating || paused}
          onHint={() => state.showHint()}
          externalUrl={externalAnalysis?.url ?? null}
          externalLabel={externalAnalysis?.label}
        />
      </div>

      <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
        <header className="flex items-center justify-between">
          <span className="label">{state.game ? `${state.game.username} vs ${state.game.opponent}` : 'Training'}</span>
          <span className="text-xs font-mono text-accent-light">
            {`${state.currentIndex + 1}/${state.blunders.length}`}
          </span>
        </header>

        {state.isRetry && (
          <div className="flex items-center gap-2 rounded-md border border-mistake/40 bg-mistake/15 px-3 py-2">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-mistake/30 text-mistake border border-mistake/50">
              Retry
            </span>
            <span className="text-xs text-text-primary">You missed this last time</span>
          </div>
        )}

        {blunder && <PositionSrState blunder={blunder} />}

        {state.currentContext && <BlunderContextBadges context={state.currentContext} />}

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
              {state.currentContext?.inTimeTrouble && (
                <p className="text-incorrect text-xs font-bold mt-1 uppercase tracking-wider">
                  Time trouble · {Math.round(state.currentContext.timeRemainingPercent ?? 0)}% left
                </p>
              )}
              {state.currentContext &&
                state.currentContext.gameState !== 'roughlyEqual' && (
                  <p
                    className={clsx(
                      'text-xs font-bold mt-1 uppercase tracking-wider',
                      state.currentContext.gameState === 'missedWin'
                        ? 'text-mistake'
                        : 'text-text-secondary',
                    )}
                  >
                    {GAME_STATE_LABEL[state.currentContext.gameState]}
                  </p>
                )}
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

            {state.hintLevel > 0 && (
              <p className="text-text-secondary text-xs">Hint shown — counts as a fail for recall.</p>
            )}

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
                <button
                  type="button"
                  onClick={() => state.selectPostCorrectIndex(-1)}
                  className={clsx(
                    'w-full text-left font-mono text-[13px] rounded px-2 py-1.5 transition hover:bg-surface-2 text-text-secondary',
                    state.activePostCorrectIndex === -1 && 'bg-accent/15 text-accent-light',
                  )}
                >
                  Puzzle start
                </button>
                <MoveSequencePanel
                  pairs={state.postCorrectPairs}
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
