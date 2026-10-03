import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { recordShare } from '../share/recordShare';
import { useTrainingStore } from '../state/trainingStore';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { BoardStage } from '../components/BoardStage';
import { BoardActionOverlay, useActionOverlay } from '../components/BoardActionOverlay';
import { useSyncStore } from '../state/syncStore';
import { BoardPanel } from '../components/BoardPanel';
import { BoardActionBar } from '../components/BoardActionBar';
import { type LineTab } from '../components/training/LineTabs';
import { useDrillFeedbackPrefs } from '../hooks/useDrillFeedbackPrefs';
import { useLineAutoplay, type AutoplaySegment } from '../hooks/useLineAutoplay';
import { useRepertoire } from '../hooks/useRepertoire';
import { fetchGamesByIds, applyContextFilter, filterLabel } from './training/trainingQueue';
import { Skeleton } from '../components/Skeleton';
import { EndgameDrillView } from '../components/training/EndgameDrillView';
import { TrainLandingScreen, type TrainFilterPick } from '../components/training/TrainLandingScreen';
import { TrainingAnalysisPanel } from '../components/training/TrainingAnalysisPanel';
import { TrainingCompleteScreen } from '../components/training/TrainingCompleteScreen';
import { TrainingDeleteModal } from '../components/training/TrainingDeleteModal';
import { TrainingShareModal } from '../components/training/TrainingShareModal';
import { ContextFilter } from '../chess/blunderContext';
import {
  BlunderPhase,
  DRILL_KIND_LABEL,
  PHASE_LABEL,
  SPACED_REPETITION_DAYS,
  type DrillKind,
} from '../models/blunder';
import { MOTIF_LABEL, type Motif } from '../chess/motifs';
import { orderedPlayers } from '../models/gameRecord';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';
import { encodeSharedPuzzle } from '../services/puzzleShareService';
import { playSound } from '../lib/sounds';
import { formatOpeningDisplay, resolveOpeningName } from '../chess/openingNames';

/** Opening intro pace, and the pause on the final position before the prompt. */
const INTRO_STEP_MS = 400;
const INTRO_HOLD_MS = 500;

interface LocationState {
  gameIds?: string[];
  contextFilter?: ContextFilter;
  phaseFilter?: BlunderPhase;
  motifFilter?: Motif;
  openingFilter?: string;
  openingColor?: 'white' | 'black' | null;
  openingLabel?: string;
  /** Only drills of this kind ("Review N due" on /openings and /endgames). */
  kindFilter?: DrillKind;
  /** Exactly these drills, due or not ("Drill these" / "Train" on /openings). */
  blunderIds?: string[];
  /** Banner label for a `blunderIds` session. */
  focusLabel?: string;
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
  const kindFilter = effectiveState.kindFilter ?? null;
  const focusIds = effectiveState.blunderIds ?? null;
  const focusLabel = effectiveState.focusLabel ?? null;
  const dueBlunders = useDueBlunders(effectiveState.gameIds, focusIds ?? undefined);
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
    if (kindFilter) list = list.filter((b) => b.kind === kindFilter);
    if (motifFilter) list = list.filter((b) => b.motifs.includes(motifFilter));
    if (needsGames) {
      if (!filterGamesQuery.data) return null; // wait for game data
      const games = filterGamesQuery.data;
      if (openingFilter) {
        list = list.filter((b) => {
          const g = b.gameId ? games.get(b.gameId) : undefined;
          if (!g || g.openingFamily !== openingFilter) return false;
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
    kindFilter,
    motifFilter,
    filterGamesQuery.data,
  ]);

  // Whichever drill filter is active (only one is set at a time in practice) —
  // drives the filter chip and empty-state copy.
  const activeFilterLabel = focusIds
    ? (focusLabel ?? 'Selected positions')
    : kindFilter
      ? `${DRILL_KIND_LABEL[kindFilter]} reviews`
      : contextFilter
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

  // Result cue. Incorrect feedback with a 'success' tone is the "good enough"
  // alternative-move case, which shouldn't sound like a miss.
  useEffect(() => {
    if (state.phase === 'correct') playSound('correct');
    else if (state.phase === 'incorrect' && state.incorrectFeedback?.tone !== 'success') {
      playSound('incorrect');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentIndex]);

  // After a real miss (not the "good but not best" retry-in-place), the
  // drill-feedback prefs decide what the board does: autoplay steps the
  // refutation of the played move, then — with "show the answer" on — the
  // solution from the missed position. Show-answer alone parks the board on
  // the missed position with the best move drawn. Any manual step cancels.
  const { showAnswer, autoplay: autoplayEnabled } = useDrillFeedbackPrefs();
  const isRealMiss = state.phase === 'incorrect' && state.incorrectRequeue;
  const hasSolution = showAnswer && state.solutionMoves.length > 0;
  const autoplaySegments: AutoplaySegment[] = [
    {
      length: state.playedRefutationMoves.length,
      select: (i) => useTrainingStore.getState().selectPlayedRefutationIndex(i),
      onEnter: () => setActiveTab('playedRefutation'),
    },
    ...(hasSolution
      ? [
          {
            // +1: the missed position with the best-move arrow comes first.
            length: state.solutionMoves.length + 1,
            select: (i: number) => useTrainingStore.getState().selectSolutionIndex(i - 1),
            onEnter: () => setActiveTab('solution'),
          },
        ]
      : []),
  ];
  const {
    active: autoplayActive,
    stop: stopAutoplay,
    skip: skipAutoplay,
  } = useLineAutoplay({
    runKey:
      isRealMiss && autoplayEnabled
        ? // sequenceToken is bumped on every load, so each miss gets one run.
          `${state.currentIndex}:${state.sequenceToken}`
        : null,
    segments: autoplaySegments,
  });

  // Opening drills: the user's repertoire is the expected answer, so the
  // store needs it before the first opening position is solved.
  const repertoire = useRepertoire();
  useEffect(() => {
    useTrainingStore.getState().setRepertoire(repertoire.data ?? null);
  }, [repertoire.data]);

  // Opening drills open by playing the user's game up to the position, then
  // hand the board over with a short beat on the final position.
  const introLength = state.phase === 'introducing' ? (state.openingIntro?.fens.length ?? 0) : 0;
  const introSegments = useMemo<AutoplaySegment[]>(
    () => [
      {
        length: introLength,
        select: (i: number) => {
          const store = useTrainingStore.getState();
          store.setIntroIndex(i);
          if (i !== introLength - 1) return;
          const token = store.sequenceToken;
          window.setTimeout(() => {
            const cur = useTrainingStore.getState();
            if (cur.sequenceToken === token) cur.finishIntro();
          }, INTRO_HOLD_MS);
        },
      },
    ],
    [introLength],
  );
  const { skip: skipIntro } = useLineAutoplay({
    runKey: state.phase === 'introducing' ? `intro:${state.sequenceToken}` : null,
    segments: introSegments,
    stepMs: INTRO_STEP_MS,
  });

  // Show-answer without autoplay: land on the answer instead of the refutation.
  useEffect(() => {
    if (!isRealMiss || autoplayEnabled || !hasSolution) return;
    setActiveTab('solution');
    useTrainingStore.getState().selectSolutionIndex(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealMiss, state.sequenceToken, autoplayEnabled, hasSolution]);

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
        else if (state.phase === 'incorrect') {
          // Opening misses retry in place: find the move, then move on.
          const isOpening = state.blunders[state.currentIndex]?.kind === 'opening';
          if (state.incorrectRequeue && !isOpening) state.requeueAndAdvance();
          else state.retry();
        }
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        // Arrows step through the line the user is looking at: the visible
        // tab in the post-attempt phases, the refutation while reviewing.
        const step = e.code === 'ArrowRight' ? 1 : -1;
        const base = e.code === 'ArrowRight' ? -1 : 0;
        if (state.phase === 'reviewing' && state.refutationMoves.length > 0) {
          state.selectRefutationIndex((state.activeRefutationIndex ?? base) + step);
        } else if (state.phase === 'correct' || state.phase === 'incorrect') {
          if (state.phase === 'incorrect') stopAutoplay();
          if (activeTab === 'refutation' && state.refutationMoves.length > 0) {
            state.selectRefutationIndex((state.activeRefutationIndex ?? base) + step);
          } else if (
            activeTab === 'solution' &&
            state.phase === 'incorrect' &&
            state.solutionMoves.length > 0
          ) {
            state.selectSolutionIndex((state.activeSolutionIndex ?? base - 1) + step);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            ? `Nothing due in ${activeFilterLabel}`
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
        {activeFilterLabel} · {state.blunders.length} position
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
      // Counts toward the share achievements; fire-and-forget.
      recordShare(true, refreshProfile);
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
  const stepSolution = (dir: 1 | -1) => {
    stopAutoplay();
    state.selectSolutionIndex((state.activeSolutionIndex ?? (dir === 1 ? -2 : -1)) + dir);
  };
  // The line the user is currently looking at (mirrors the ←/→ keyboard handler);
  // surfaced as arrows in the board action bar on mobile.
  const activeLineStep: ((dir: 1 | -1) => void) | null = (() => {
    if (state.phase === 'reviewing' && state.refutationMoves.length > 0) return stepRefutation;
    if (state.phase === 'correct' || state.phase === 'incorrect') {
      if (activeTab === 'refutation' && state.refutationMoves.length > 0) return stepRefutation;
      if (activeTab === 'solution' && state.phase === 'incorrect' && state.solutionMoves.length > 0)
        return stepSolution;
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
            (state.phase === 'correct' || state.phase === 'incorrect') &&
            (autoplayActive ? (
              // Let the refutation play out visibly first; a tap jumps to the
              // end and brings the result cover up right away.
              <button
                type="button"
                aria-label="Skip refutation"
                onClick={skipAutoplay}
                className="absolute inset-0 z-10 bg-transparent"
              />
            ) : (
              <BoardActionOverlay
                message={
                  state.phase === 'correct'
                    ? state.openingVerdict
                      ? state.openingVerdict.kind === 'sound'
                        ? 'Good move'
                        : 'Great!'
                      : 'Solution correct'
                    : state.incorrectFeedback?.message ?? 'Not the best move'
                }
                actionLabel={
                  state.phase === 'correct'
                    ? 'Next'
                    : state.incorrectRequeue && blunder?.kind !== 'opening'
                      ? 'Continue'
                      : 'Try again'
                }
                onAction={() => {
                  if (state.phase === 'correct') state.advance();
                  else if (state.incorrectRequeue && blunder?.kind !== 'opening') state.requeueAndAdvance();
                  else state.retry();
                }}
                dismissLabel="Review the lines"
                onDismiss={overlay.dismiss}
              />
            ))
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
        stepSolution={stepSolution}
        showAnswer={showAnswer}
        stopAutoplay={stopAutoplay}
        onSkipIntro={skipIntro}
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
          onShared={() => recordShare(true, refreshProfile)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
