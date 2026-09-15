import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { useTrainingStore } from '../state/trainingStore';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { BoardStage } from '../components/BoardStage';
import { BoardActionOverlay, useActionOverlay } from '../components/BoardActionOverlay';
import { useSyncStore } from '../state/syncStore';
import { BoardPanel } from '../components/BoardPanel';
import { BoardActionBar } from '../components/BoardActionBar';
import { type LineTab } from '../components/training/LineTabs';
import { fetchGamesByIds, applyContextFilter, filterLabel } from './training/trainingQueue';
import { Skeleton } from '../components/Skeleton';
import { EndgameDrillView } from '../components/training/EndgameDrillView';
import { TrainLandingScreen, type TrainFilterPick } from '../components/training/TrainLandingScreen';
import { TrainingAnalysisPanel } from '../components/training/TrainingAnalysisPanel';
import { TrainingCompleteScreen } from '../components/training/TrainingCompleteScreen';
import { TrainingDeleteModal } from '../components/training/TrainingDeleteModal';
import { TrainingShareModal } from '../components/training/TrainingShareModal';
import { ContextFilter } from '../chess/blunderContext';
import { BlunderPhase, PHASE_LABEL, SPACED_REPETITION_DAYS } from '../models/blunder';
import { MOTIF_LABEL, type Motif } from '../chess/motifs';
import { ecoFamily, orderedPlayers } from '../models/gameRecord';
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
  motifFilter?: Motif;
  openingFilter?: string;
  openingColor?: 'white' | 'black' | null;
  openingLabel?: string;
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

  // A deep link from a dashboard insight card arrives with `location.state`
  // already populated — that skips the landing picker below entirely and
  // behaves exactly as before this screen existed. Otherwise nothing is
  // filtered (and the queue isn't started) until the user picks a focus on
  // the landing screen, which fills `pickedFilter` with the same shape.
  const [pickedFilter, setPickedFilter] = useState<LocationState | null>(null);
  const filterChosen = !!location.state || pickedFilter !== null;
  const effectiveState: LocationState = location.state ?? pickedFilter ?? {};

  const contextFilter = effectiveState.contextFilter ?? null;
  const phaseFilter = effectiveState.phaseFilter ?? null;
  const motifFilter = effectiveState.motifFilter ?? null;
  const openingFilter = effectiveState.openingFilter ?? null;
  const openingColor = effectiveState.openingColor ?? null;
  const openingLabel = effectiveState.openingLabel ?? null;
  const dueBlunders = useDueBlunders(effectiveState.gameIds);
  const dueData = dueBlunders.data;
  // Skip the landing picker when there's nothing due at all — offering a
  // training focus is pointless with an empty queue, and it lets the plain
  // "nothing due" empty state render directly instead of a flash of the picker.
  const dueConfirmedEmpty = dueBlunders.isFetched && (dueData?.length ?? 0) === 0;
  const sessionReady = filterChosen || dueConfirmedEmpty;

  // Clears any deep-link filter state and local pick, then re-fetches the due
  // count so the picker (or the "nothing due" empty state, if it comes back
  // empty) reflects what's actually left after a session.
  const backToPicker = () => {
    setPickedFilter(null);
    useTrainingStore.getState().reset();
    navigate('/training', { replace: true });
    void dueBlunders.refetch();
  };
  const resetToUnfiltered = () => {
    setPickedFilter({});
    useTrainingStore.getState().reset();
    navigate('/training', { replace: true });
  };

  // Context and opening filters both need the blunders' games (the per-blunder
  // game fetch in the store isn't enough for batch filtering); phase doesn't.
  const needsGames = !!contextFilter || !!openingFilter;
  const gameIdsForFilter = useMemo(() => {
    if (!needsGames || !dueData) return null;
    const ids = new Set<string>();
    for (const b of dueData) if (b.gameId) ids.add(b.gameId);
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
    if (motifFilter) list = list.filter((b) => b.motifs.includes(motifFilter));
    if (needsGames) {
      if (!filterGamesQuery.data) return null; // wait for game data
      const games = filterGamesQuery.data;
      if (openingFilter) {
        list = list.filter((b) => {
          const g = b.gameId ? games.get(b.gameId) : undefined;
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
    motifFilter,
    filterGamesQuery.data,
  ]);

  // Whichever drill filter is active (only one is set at a time in practice) —
  // drives the filter chip and empty-state copy.
  const activeFilterLabel = contextFilter
    ? filterLabel(contextFilter)
    : openingFilter
      ? openingLabel ?? openingFilter
      : phaseFilter
        ? PHASE_LABEL[phaseFilter]
        : motifFilter
          ? MOTIF_LABEL[motifFilter]
          : null;

  useEffect(() => {
    setContextFilter(contextFilter);
  }, [contextFilter, setContextFilter]);

  const [paused, setPaused] = useState(false);
  const overlay = useActionOverlay(`${state.currentIndex}:${state.phase}`);
  useEffect(() => {
    setPaused(false);
  }, [state.currentIndex]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  // Hide player names in the shared link. Remembered across sessions.
  const [shareAnonymous, setShareAnonymous] = useState(
    () => localStorage.getItem('pc:share-anonymous') === '1',
  );
  useEffect(() => {
    localStorage.setItem('pc:share-anonymous', shareAnonymous ? '1' : '0');
  }, [shareAnonymous]);
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

  // On a repeat wrong attempt (not the drill's first try), autoplay the
  // engine's refutation of the played move instead of leaving it as a static
  // reveal — the point is to force the lesson to land on a re-miss without
  // being harsh on the very first try. Cancelled the moment the user steps
  // the line manually (see `stopAutoplay` usages below).
  const autoplayEnabled = profile?.autoplayRefutation ?? true;
  const autoplayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoplayedKeyRef = useRef<string | null>(null);
  const stopAutoplay = () => {
    if (autoplayTimerRef.current !== null) {
      clearInterval(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
  };
  useEffect(() => {
    const shouldAutoplay =
      state.phase === 'incorrect' &&
      state.incorrectRequeue &&
      !state.lastAttemptWasFirst &&
      autoplayEnabled &&
      state.playedRefutationMoves.length > 0;

    if (!shouldAutoplay) {
      stopAutoplay();
      return;
    }

    const key = `${state.currentIndex}:${state.playedRefutationMoves.length}`;
    if (autoplayedKeyRef.current === key) return;
    autoplayedKeyRef.current = key;

    const total = state.playedRefutationMoves.length;
    let idx = 0;
    state.selectPlayedRefutationIndex(idx);
    autoplayTimerRef.current = setInterval(() => {
      idx += 1;
      if (idx >= total) {
        stopAutoplay();
        return;
      }
      useTrainingStore.getState().selectPlayedRefutationIndex(idx);
    }, 700);

    return stopAutoplay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.phase,
    state.incorrectRequeue,
    state.lastAttemptWasFirst,
    state.currentIndex,
    autoplayEnabled,
  ]);

  useEffect(() => {
    if (!sessionReady || !filteredBlunders) return;
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
      // One-time milestone for the "Focused Training" achievement — a real
      // picked focus, not the unfiltered "everything" queue.
      const usedAFilter = !!(contextFilter || phaseFilter || motifFilter || openingFilter);
      if (usedAFilter && profile && !profile.usedTrainingFilter) {
        void authService
          .markUsedTrainingFilter(profile.id)
          .then(() => refreshProfile())
          .catch((err) => console.warn('[training] markUsedTrainingFilter failed', err));
      }
    }
    // refreshProfile is intentionally omitted — it's a fresh function identity
    // on every AuthProvider render and is only used inside a fire-and-forget
    // callback here, not something this effect needs to re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionReady,
    filteredBlunders,
    profile,
    setBlunders,
    beginSession,
    contextFilter,
    phaseFilter,
    motifFilter,
    openingFilter,
  ]);

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

  if (!sessionReady) {
    return (
      <TrainLandingScreen
        dueCount={dueData?.length ?? 0}
        onPick={(filter: TrainFilterPick) => setPickedFilter(filter)}
      />
    );
  }

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
            {Array.from({ length: SPACED_REPETITION_DAYS.length }).map((_, i) => (
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
          <button className="btn-outline" onClick={resetToUnfiltered}>
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
    return (
      <TrainingCompleteScreen
        totalCorrect={state.totalCorrect}
        totalAttempted={state.totalAttempted}
        onKeepTraining={backToPicker}
        onBackToDashboard={() => navigate('/dashboard')}
      />
    );
  }

  const blunder = state.blunders[state.currentIndex];

  const filterBanner = activeFilterLabel ? (
    <div className="flex items-baseline justify-between rounded-none border-2 border-text-primary bg-surface-3 px-3 py-2">
      <span className="font-mono text-xs uppercase tracking-tight text-gold-dark">
        {activeFilterLabel} · {state.blunders.length} blunder
        {state.blunders.length === 1 ? '' : 's'}
      </span>
      <button
        className="font-mono text-xs uppercase tracking-tight text-text-secondary hover:text-text-primary"
        onClick={backToPicker}
      >
        Change focus
      </button>
    </div>
  ) : null;

  // Endgame-kind items are played out vs the engine rather than solved as a
  // stored move sequence — the dedicated view drives the board through its
  // play-out store and reports the SR outcome back via completeExternalDrill.
  if (blunder?.kind === 'endgame' && blunder.drillData && 'deservedResult' in blunder.drillData) {
    return (
      <EndgameDrillView
        key={blunder.id}
        blunder={blunder}
        drillData={blunder.drillData}
        showFilterBanner={filterBanner}
      />
    );
  }

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
        lbl: shareAnonymous ? undefined : (sharePlayersLabel ?? undefined),
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
          orientation: state.orientation,
        })
      : null;

  // Tap equivalents of the ←/→ shortcuts: step the line the user is looking at.
  const stepRefutation = (dir: 1 | -1) =>
    state.selectRefutationIndex((state.activeRefutationIndex ?? (dir === 1 ? -1 : 0)) + dir);
  const stepPostCorrect = (dir: 1 | -1) =>
    state.selectPostCorrectIndex((state.activePostCorrectIndex ?? (dir === 1 ? -1 : 0)) + dir);
  const stepPlayedRefutation = (dir: 1 | -1) => {
    stopAutoplay();
    state.selectPlayedRefutationIndex(
      (state.activePlayedRefutationIndex ?? (dir === 1 ? -1 : 0)) + dir,
    );
  };
  // The line the user is currently looking at (mirrors the ←/→ keyboard handler);
  // surfaced as arrows in the board action bar on mobile.
  const activeLineStep: ((dir: 1 | -1) => void) | null = (() => {
    if (state.phase === 'reviewing' && state.refutationMoves.length > 0) return stepRefutation;
    if (state.phase === 'correct' || state.phase === 'incorrect') {
      if (activeTab === 'refutation' && state.refutationMoves.length > 0) return stepRefutation;
      if (state.phase === 'correct' && state.postCorrectMoves.length > 0) return stepPostCorrect;
      if (state.phase === 'incorrect' && state.playedRefutationMoves.length > 0)
        return stepPlayedRefutation;
    }
    return null;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="flex flex-col gap-2 lg:gap-3">
        {state.persistError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none px-4 py-2 text-sm"
          >
            <span>{state.persistError}</span>
            <button
              type="button"
              onClick={() => state.clearPersistError()}
              className="shrink-0 text-xs underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {filterBanner}
        <BoardStage
          paused={paused}
          overlay={
            overlay.enabled &&
            (state.phase === 'correct' || state.phase === 'incorrect') && (
              <BoardActionOverlay
                message={
                  state.phase === 'correct'
                    ? 'Solution correct'
                    : state.incorrectFeedback?.message ?? 'Not the best move'
                }
                actionLabel={
                  state.phase === 'correct'
                    ? 'Next'
                    : state.incorrectRequeue
                      ? 'Continue'
                      : 'Try again'
                }
                onAction={() => {
                  if (state.phase === 'correct') state.advance();
                  else if (state.incorrectRequeue) state.requeueAndAdvance();
                  else state.retry();
                }}
                dismissLabel="Review the lines"
                onDismiss={overlay.dismiss}
              />
            )
          }
        >
          <BoardPanel
            fen={state.fen}
            orientation={state.orientation}
            movableFor={state.phase === 'solving' && !paused ? state.movableFor : null}
            lastMove={state.lastMove}
            shapes={state.shapes}
            onMove={(m) => state.processMove(m)}
          />
        </BoardStage>

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
          onStepLine={activeLineStep}
        />
      </div>

      <TrainingAnalysisPanel
        state={state}
        blunder={blunder}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        revealBeforeSolve={revealBeforeSolve}
        showEngineEvals={profile?.showEngineEvals ?? false}
        refutationLabel={refutationLabel}
        triedSan={triedSan}
        stepRefutation={stepRefutation}
        stepPostCorrect={stepPostCorrect}
        stepPlayedRefutation={stepPlayedRefutation}
        stopAutoplay={stopAutoplay}
        paused={paused}
        deleting={deleting}
        onShareClick={() => {
          setShareCopied(false);
          setShareOpen(true);
        }}
        onDeleteClick={() => {
          setDeleteError(null);
          setConfirmDelete(true);
        }}
      />

      {confirmDelete && (
        <TrainingDeleteModal
          deleting={deleting}
          deleteError={deleteError}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
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
        />
      )}

      {shareOpen && blunder && shareUrl && (
        <TrainingShareModal
          blunder={blunder}
          shareUrl={shareUrl}
          sharePlayersLabel={sharePlayersLabel}
          shareOpeningLabel={shareOpeningLabel}
          shareAnonymous={shareAnonymous}
          setShareAnonymous={setShareAnonymous}
          shareCopied={shareCopied}
          onCopy={() => void onCopyShareLink()}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
