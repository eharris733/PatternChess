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
import { TrophyIcon } from '../components/icons/TrophyIcon';
import { TrashIcon } from '../components/icons/TrashIcon';
import { ShareIcon } from '../components/icons/ShareIcon';
import { CloseIcon } from '../components/icons/CloseIcon';
import { Skeleton } from '../components/Skeleton';
import { PositionSrState } from '../components/training/PositionSrState';
import { BlunderContextBadges } from '../components/training/BlunderContextBadges';
import {
  ContextFilter,
  GAME_STATE_LABEL,
  computeBlunderContext,
} from '../chess/blunderContext';
import { Blunder, BlunderPhase } from '../models/blunder';
import { GameRecord } from '../models/gameRecord';
import { supabase } from '../lib/supabase';
import { gameRecordFromJson, ecoFamily, orderedPlayers } from '../models/gameRecord';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';
import { encodeSharedPuzzle } from '../services/puzzleShareService';
import { formatOpeningDisplay, resolveOpeningName } from '../chess/openingNames';

interface LocationState {
  gameIds?: string[];
  contextFilter?: ContextFilter;
  phaseFilter?: BlunderPhase;
  openingFilter?: string;
  openingColor?: 'white' | 'black' | null;
  openingLabel?: string;
}

function filterLabel(filter: ContextFilter): string {
  if (filter === 'timeTrouble') return 'Time trouble';
  if (filter === 'longThink') return 'Long think';
  return GAME_STATE_LABEL[filter];
}

function phaseLabel(phase: BlunderPhase): string {
  return phase === 'opening' ? 'Opening' : phase === 'endgame' ? 'Endgame' : 'Middlegame';
}

type LineTab = 'continuation' | 'refutation' | 'playedRefutation';

function LineTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: LineTab; label: string }[];
  active: LineTab;
  onSelect: (key: LineTab) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={clsx(
            'font-mono uppercase text-[10px] tracking-tight px-2 py-1 rounded-none border-2 border-text-primary transition-colors',
            active === t.key
              ? 'bg-text-primary text-bg'
              : 'text-text-secondary hover:bg-text-primary/5',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
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
    if (filter === 'longThink') return ctx.isLongThink;
    return ctx.gameState === filter;
  });
}

export function TrainingRoute() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: LocationState };
  const { profile, refreshProfile } = useAuth();

  const state = useTrainingStore();
  const setBlunders = useTrainingStore((s) => s.setBlunders);
  const setContextFilter = useTrainingStore((s) => s.setContextFilter);
  const beginSession = useTrainingStore((s) => s.beginSession);
  const setRevealBeforeSolve = useTrainingStore((s) => s.setRevealBeforeSolve);

  // Mirror the profile preference into the store. Declared before the
  // setBlunders effect below so the first loadCurrentBlunder sees it.
  const revealBeforeSolve = profile?.revealBeforeSolve ?? false;
  useEffect(() => {
    setRevealBeforeSolve(revealBeforeSolve);
  }, [revealBeforeSolve, setRevealBeforeSolve]);

  const contextFilter = location.state?.contextFilter ?? null;
  const phaseFilter = location.state?.phaseFilter ?? null;
  const openingFilter = location.state?.openingFilter ?? null;
  const openingColor = location.state?.openingColor ?? null;
  const openingLabel = location.state?.openingLabel ?? null;
  const dueBlunders = useDueBlunders(location.state?.gameIds);
  const dueData = dueBlunders.data;

  // Context and opening filters both need the blunders' games (the per-blunder
  // game fetch in the store isn't enough for batch filtering); phase doesn't.
  const needsGames = !!contextFilter || !!openingFilter;
  const gameIdsForFilter = useMemo(() => {
    if (!needsGames || !dueData) return null;
    const ids = new Set<string>();
    for (const b of dueData) ids.add(b.gameId);
    return Array.from(ids);
  }, [needsGames, dueData]);

  const filterGamesQuery = useQuery({
    queryKey: ['training', 'filterGames', gameIdsForFilter],
    queryFn: () => fetchGamesByIds(gameIdsForFilter ?? []),
    enabled: needsGames && !!gameIdsForFilter,
  });

  const filteredBlunders = useMemo(() => {
    if (!dueData) return null;
    let list = phaseFilter ? dueData.filter((b) => b.phase === phaseFilter) : dueData;
    if (needsGames) {
      if (!filterGamesQuery.data) return null; // wait for game data
      const games = filterGamesQuery.data;
      if (openingFilter) {
        list = list.filter((b) => {
          const g = games.get(b.gameId);
          if (!g || ecoFamily(g.eco) !== openingFilter) return false;
          return openingColor ? g.userColor === openingColor : true;
        });
      }
      if (contextFilter) list = applyContextFilter(list, games, contextFilter);
    }
    return list;
  }, [
    dueData,
    needsGames,
    contextFilter,
    openingFilter,
    openingColor,
    phaseFilter,
    filterGamesQuery.data,
  ]);

  // Whichever drill filter is active (only one is set at a time in practice) —
  // drives the filter chip and empty-state copy.
  const activeFilterLabel = contextFilter
    ? filterLabel(contextFilter)
    : openingFilter
      ? openingLabel ?? openingFilter
      : phaseFilter
        ? phaseLabel(phaseFilter)
        : null;

  useEffect(() => {
    setContextFilter(contextFilter);
  }, [contextFilter, setContextFilter]);

  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setPaused(false);
  }, [state.currentIndex]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  useEffect(() => {
    setConfirmDelete(false);
    setDeleteError(null);
    setShareOpen(false);
    setShareCopied(false);
  }, [state.currentIndex]);

  // Which move line the post-attempt tabs show — and therefore which line the
  // arrow keys step through. Local to the route on purpose (no store churn).
  const [activeTab, setActiveTab] = useState<LineTab>('continuation');
  useEffect(() => {
    setActiveTab(state.phase === 'incorrect' ? 'playedRefutation' : 'continuation');
  }, [state.currentIndex, state.phase]);

  useEffect(() => {
    if (!filteredBlunders) return;
    // Only initialize the store from the query when we haven't started training yet
    // (loading) or when the queue was empty (waiting for a sync to populate).
    // Don't interrupt an active session (reviewing/solving/correct/incorrect/complete).
    const { phase } = useTrainingStore.getState();
    if (phase === 'loading' || phase === 'empty') {
      useTrainingStore.getState().setRevealBeforeSolve(profile?.revealBeforeSolve ?? false);
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
        else if (state.phase === 'incorrect')
          state.incorrectRequeue ? state.requeueAndAdvance() : state.retry();
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        // Arrows step through the line the user is looking at: the visible
        // tab in the post-attempt phases, the refutation while reviewing.
        const step = e.code === 'ArrowRight' ? 1 : -1;
        const base = e.code === 'ArrowRight' ? -1 : 0;
        if (state.phase === 'reviewing' && state.refutationMoves.length > 0) {
          state.selectRefutationIndex((state.activeRefutationIndex ?? base) + step);
        } else if (state.phase === 'correct' || state.phase === 'incorrect') {
          if (activeTab === 'refutation' && state.refutationMoves.length > 0) {
            state.selectRefutationIndex((state.activeRefutationIndex ?? base) + step);
          } else if (state.phase === 'correct' && state.postCorrectMoves.length > 0) {
            state.selectPostCorrectIndex((state.activePostCorrectIndex ?? base) + step);
          } else if (state.phase === 'incorrect' && state.playedRefutationMoves.length > 0) {
            state.selectPlayedRefutationIndex((state.activePlayedRefutationIndex ?? base) + step);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, activeTab]);

  if (
    dueBlunders.isLoading ||
    (needsGames && filterGamesQuery.isLoading) ||
    state.phase === 'loading'
  ) {
    return (
      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6"
        aria-busy="true"
        aria-label="Loading position"
      >
        <div className="flex flex-col gap-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <aside className="card flex flex-col gap-4 self-start">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
          <div className="flex gap-1.5">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-3" />
            ))}
          </div>
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="mt-auto h-10 w-full" />
        </aside>
      </div>
    );
  }

  if (state.phase === 'empty' || (state.phase === 'complete' && state.totalAttempted === 0)) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">
          {activeFilterLabel
            ? `No ${activeFilterLabel.toLowerCase()} blunders due`
            : 'No blunders due'}
        </h1>
        <p className="text-text-secondary text-sm">
          {activeFilterLabel
            ? 'Try drilling the full queue or come back after another sync.'
            : hasAccount
              ? 'Sync your latest games to fill the queue.'
              : 'Link a Lichess or Chess.com account to start.'}
        </p>
        {activeFilterLabel && (
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
        <TrophyIcon className="h-14 w-14 self-center text-gold-dark" />
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

  // "Why it loses" misstates missed wins — there the engine line shows the
  // win that was still available, not a losing sequence.
  const refutationLabel =
    state.currentContext?.gameState === 'missedWin' ? 'Engine line' : 'Why it loses';
  const triedSan = state.playedRefutationMoves[0]?.san ?? null;

  const sharePlayersLabel =
    state.game && blunder
      ? orderedPlayers(
          state.game.username,
          state.game.opponent,
          blunder.sideToMove === 'white' ? 'white' : 'black',
        ).join(' vs ')
      : null;
  const shareOpeningLabel = state.game
    ? formatOpeningDisplay(resolveOpeningName(state.game.eco, state.game.openingName))
    : null;
  // Plain computation (no useMemo): this sits below the loading early-returns,
  // and encoding a few hundred bytes per render is negligible.
  const shareUrl = blunder
    ? `${window.location.origin}/p?d=${encodeSharedPuzzle({
        fen: blunder.fen,
        pm: blunder.playedMove,
        cm: blunder.correctMoves.map((c) => ({ m: c.move, e: c.eval })),
        eb: blunder.evalBefore,
        ea: blunder.evalAfter,
        stm: blunder.sideToMove === 'white' ? 'white' : 'black',
        lbl: sharePlayersLabel ?? undefined,
        op: shareOpeningLabel ?? undefined,
      })}`
    : null;

  const onCopyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 3000);
    } catch (err) {
      console.warn('[training] share copy failed', err);
    }
  };

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
        {activeFilterLabel && (
          <div className="flex items-baseline justify-between rounded-none border-2 border-text-primary bg-surface-3 px-3 py-2">
            <span className="font-mono text-xs uppercase tracking-tight text-gold-dark">
              {activeFilterLabel} · {state.blunders.length} blunder
              {state.blunders.length === 1 ? '' : 's'}
            </span>
            <button
              className="font-mono text-xs uppercase tracking-tight text-text-secondary hover:text-text-primary"
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
            evalBefore={blunder.evalBefore}
            evalAfter={blunder.evalAfter}
            showEngineEvals={profile?.showEngineEvals ?? false}
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
                  'w-3 h-3 rounded-full border-2 border-text-primary',
                  blunder.sideToMove === 'white' ? 'bg-surface' : 'bg-black',
                )}
              />
              <span className="font-medium">
                {blunder.sideToMove === 'white' ? 'White' : 'Black'} to play
              </span>
            </div>

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
                      'w-full text-left font-mono text-[13px] rounded-none px-2 py-1.5 transition-colors hover:bg-text-primary/5',
                      state.activePostCorrectIndex === -1
                        ? 'bg-text-primary text-bg'
                        : 'text-text-secondary',
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
              )
            ) : (
              <div>
                <p className="label mb-2">{refutationLabel}</p>
                {state.refutationPairs.length > 0 ? (
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
                ) : (
                  <p className="text-text-secondary text-sm">Calculating…</p>
                )}
              </div>
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
                      activeKey={
                        state.activePlayedRefutationIndex !== null
                          ? `r${state.activePlayedRefutationIndex}`
                          : null
                      }
                      onSelect={(key) => {
                        const i = Number.parseInt(key.slice(1), 10);
                        if (!Number.isNaN(i)) state.selectPlayedRefutationIndex(i);
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
              {state.incorrectRequeue ? 'Continue (Space)' : 'Try again (Space)'}
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
                onClick={() => {
                  setShareCopied(false);
                  setShareOpen(true);
                }}
                title="Share a public link to this puzzle"
              >
                <ShareIcon className="h-3.5 w-3.5" />
                Share puzzle
              </button>
              <button
                type="button"
                className="btn-ghost text-xs inline-flex items-center justify-center gap-1.5 text-text-secondary hover:text-incorrect"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                }}
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

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete position"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="card max-w-md w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 className="heading-lg">Delete this position?</h2>
            </header>
            <p className="text-text-secondary text-sm">
              This permanently removes the position from your training. You won't be
              asked to drill it again. This can't be undone.
            </p>
            {deleteError && (
              <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-3 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-ghost"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-incorrect hover:bg-incorrect border-incorrect inline-flex items-center gap-1.5"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    const res = await state.deleteCurrent();
                    if (res.ok) {
                      setConfirmDelete(false);
                    } else {
                      setDeleteError(res.error ?? 'Delete failed.');
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                <TrashIcon className="h-4 w-4" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareOpen && blunder && shareUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Share this puzzle"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="card max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between">
              <h2 className="heading-lg">Share this puzzle</h2>
              <button
                type="button"
                aria-label="Close"
                className="btn-ghost p-1 text-text-secondary hover:text-text-primary"
                onClick={() => setShareOpen(false)}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>
            <div className="max-w-[280px] w-full mx-auto">
              <BoardPanel
                fen={blunder.fen}
                orientation={blunder.sideToMove === 'white' ? 'white' : 'black'}
                movableFor={null}
                viewOnly
              />
            </div>
            <div className="text-center">
              {sharePlayersLabel && (
                <p className="text-sm font-medium text-text-primary">{sharePlayersLabel}</p>
              )}
              <p className="text-text-secondary text-xs">
                {shareOpeningLabel ? `${shareOpeningLabel} · ` : ''}
                {blunder.sideToMove === 'white' ? 'White' : 'Black'} to play
              </p>
            </div>
            <p className="text-text-secondary text-xs">
              Anyone with this link can try the position — no account needed. This is exactly
              what they'll see.
            </p>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 font-mono text-xs"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share link"
              />
              <button
                type="button"
                className="btn-primary shrink-0"
                onClick={() => void onCopyShareLink()}
              >
                {shareCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
