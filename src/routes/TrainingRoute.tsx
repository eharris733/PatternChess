import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { authService } from '../services/authService';
import { recordShare } from '../share/recordShare';
import { flushTrainingWrites, useTrainingStore } from '../state/trainingStore';
import { useDueBlunders } from '../hooks/useDueBlunders';
import { PRACTICE_AHEAD_BATCH, useUpcomingBlunders } from '../hooks/useUpcomingBlunders';
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
import {
  returnLabel,
  continueFocus,
  hasFilter,
  practiceAheadFocus,
  practiceAheadParams,
  returnPathFor,
  type TrainingFocus,
} from './training/trainingFocus';
import { Skeleton } from '../components/Skeleton';
import { EndgameDrillView } from '../components/training/EndgameDrillView';
import { TrainLandingScreen } from '../components/training/TrainLandingScreen';
import { TrainingAnalysisPanel } from '../components/training/TrainingAnalysisPanel';
import { TrainingCompleteScreen } from '../components/training/TrainingCompleteScreen';
import { TrainingDeleteModal } from '../components/training/TrainingDeleteModal';
import { TrainingShareModal } from '../components/training/TrainingShareModal';
import { DRILL_KIND_LABEL, PHASE_LABEL, SPACED_REPETITION_DAYS } from '../models/blunder';
import { MOTIF_LABEL } from '../chess/motifs';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';
import {
  buildPuzzleShareUrl,
  shareOpeningLabelFor,
  sharePlayersLabelFor,
} from '../services/puzzleShareService';
import { playSound } from '../lib/sounds';
import { useT } from '../i18n/useT';
import { useQuotaGuard } from '../hooks/useDailyQuota';
import { detectTimezone, localDate } from '../services/streakService';
import type { QuotaKind } from '../lib/dailyLimit';

/** Opening intro pace, and the pause on the final position before the prompt. */
const INTRO_STEP_MS = 400;
const INTRO_HOLD_MS = 500;

/** Which daily limit a /training focus draws on: opening sessions use the openings one. */
function quotaKindFor(focus: TrainingFocus): QuotaKind {
  return focus.kindFilter === 'opening' ? 'openings' : 'positions';
}

/**
 * /training. A session is one mount of TrainingSession: "Keep training" and
 * "Change focus" flush the finished session's writes, then remount it with the
 * next focus in `location.state`, so the next queue is always fetched fresh
 * (never the pre-session list).
 */
export function TrainingRoute() {
  const [run, setRun] = useState({ n: 0, picker: false });
  const restart = useCallback((picker: boolean) => setRun((r) => ({ n: r.n + 1, picker })), []);
  return <TrainingSession key={run.n} forcePicker={run.picker} onRestart={restart} />;
}

function TrainingSession({
  forcePicker,
  onRestart,
}: {
  /** Open on the focus picker even when nothing is due ("Change focus"). */
  forcePicker: boolean;
  onRestart: (picker: boolean) => void;
}) {
  const navigate = useNavigate();
  const t = useT();
  const location = useLocation() as { state?: TrainingFocus | null };
  const { profile, refreshProfile } = useAuth();
  const { quota, guard } = useQuotaGuard();

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
  const [pickedFilter, setPickedFilter] = useState<TrainingFocus | null>(null);
  const [pickerOpen, setPickerOpen] = useState(forcePicker);
  const filterChosen = !!location.state || pickedFilter !== null;
  const effectiveState: TrainingFocus = pickedFilter ?? location.state ?? {};

  const contextFilter = effectiveState.contextFilter ?? null;
  const phaseFilter = effectiveState.phaseFilter ?? null;
  const motifFilter = effectiveState.motifFilter ?? null;
  const openingFilter = effectiveState.openingFilter ?? null;
  const openingColor = effectiveState.openingColor ?? null;
  const openingLabel = effectiveState.openingLabel ?? null;
  const kindFilter = effectiveState.kindFilter ?? null;
  const focusIds = effectiveState.blunderIds ?? null;
  const focusLabel = effectiveState.focusLabel ?? null;
  const practiceAhead = !!effectiveState.practiceAhead;
  const planRun = !!effectiveState.planRun;
  const planTz = profile?.timezone ?? detectTimezone();
  const dueBlunders = useDueBlunders(effectiveState.gameIds, focusIds ?? undefined);
  const dueData = dueBlunders.data;
  // Practice ahead: the drills due next. Also fetched (same key) for the empty
  // state's "Practice ahead" offer, so taking it starts instantly.
  const state = useTrainingStore();
  const queueEmpty = state.phase === 'empty' || state.phase === 'complete';
  const upcoming = useUpcomingBlunders(practiceAheadParams(effectiveState), {
    enabled: practiceAhead || queueEmpty,
  });
  const sourceQuery = practiceAhead ? upcoming : dueBlunders;
  const sourceData = sourceQuery.data;
  // With nothing due at all, skip the landing picker: the empty state (with
  // its "Practice ahead") renders directly instead of a flash of the picker.
  // "Change focus" and "Pick a focus" open the picker regardless.
  const dueConfirmedEmpty = dueBlunders.isFetched && (dueData?.length ?? 0) === 0;
  const sessionReady = !pickerOpen && (filterChosen || dueConfirmedEmpty);

  // Restart in place: end and flush this session's writes first, so the next
  // queue is fetched after them, then remount with the next focus.
  const [restarting, setRestarting] = useState(false);
  const restartWith = (next: TrainingFocus | null, picker = false) => {
    setRestarting(true);
    useTrainingStore.getState().reset();
    void flushTrainingWrites().finally(() => {
      navigate('/training', { replace: true, state: next ?? null });
      onRestart(picker);
    });
  };
  const backToPicker = () => restartWith(null, true);
  // "Keep training": the same focus (an openings session stays in openings).
  const keepTraining = () => {
    const next = continueFocus(effectiveState, state.blunders);
    if (!guard(quotaKindFor(next ?? {}))) return;
    if (next) restartWith(next);
    else backToPicker();
  };
  const startPracticeAhead = () => guard(quotaKindFor(effectiveState)) && restartWith(practiceAheadFocus(effectiveState));
  const resetToUnfiltered = () => restartWith({});

  // Context and opening filters both need the blunders' games (the per-blunder
  // game fetch in the store isn't enough for batch filtering); phase doesn't.
  const needsGames = !!contextFilter || !!openingFilter;
  const gameIdsForFilter = useMemo(() => {
    if (!needsGames || !sourceData) return null;
    const ids = new Set<string>();
    for (const b of sourceData) if (b.gameId) ids.add(b.gameId);
    return Array.from(ids);
  }, [needsGames, sourceData]);

  const filterGamesQuery = useQuery({
    queryKey: ['training', 'filterGames', gameIdsForFilter],
    queryFn: () => fetchGamesByIds(gameIdsForFilter ?? []),
    enabled: needsGames && !!gameIdsForFilter,
  });

  const filteredBlunders = useMemo(() => {
    if (!sourceData) return null;
    let list = phaseFilter ? sourceData.filter((b) => b.phase === phaseFilter) : sourceData;
    if (kindFilter) list = list.filter((b) => b.kind === kindFilter);
    // The plan's Train step leaves opening drills to the Openings step.
    else if (planRun && !focusIds) list = list.filter((b) => b.kind !== 'opening');
    // The Openings step counts distinct drills reviewed today, so a plan run
    // never spends its review on one already reviewed today.
    if (planRun && kindFilter === 'opening') {
      const today = localDate(planTz);
      list = list.filter((b) => !(b.lastDrilledAt && localDate(planTz, b.lastDrilledAt) === today));
    }
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
    // A practice-ahead pool may be larger than one batch (client-side filters).
    return practiceAhead ? list.slice(0, PRACTICE_AHEAD_BATCH) : list;
  }, [
    sourceData,
    practiceAhead,
    planRun,
    planTz,
    focusIds,
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
  const focusFilterLabel = focusIds
    ? (focusLabel ?? t('train.selectedPositions'))
    : kindFilter
      ? t('train.kindReviews', { kind: t.label('drillKind', kindFilter, DRILL_KIND_LABEL[kindFilter]) })
      : contextFilter
    ? filterLabel(contextFilter, t)
    : openingFilter
      ? openingLabel ?? openingFilter
      : phaseFilter
        ? t.label('phase', phaseFilter, PHASE_LABEL[phaseFilter])
        : motifFilter
          ? t.label('motif', motifFilter, MOTIF_LABEL[motifFilter])
          : null;
  const activeFilterLabel =
    practiceAhead && focusFilterLabel
      ? t('train.practiceAheadSuffix', { focus: focusFilterLabel })
      : practiceAhead
        ? t('plan.practiceAhead')
        : focusFilterLabel;
  // Where "Back to …" goes for this focus (/openings, /endgames), if anywhere.
  const returnPath = returnPathFor(effectiveState, state.blunders.length > 0 ? state.blunders : (sourceData ?? null));

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

  // Free players stop at their plan's limits for the day (dailyLimit.ts): the
  // store skips new goal positions past the Train goal and new opening drills
  // past the openings limit, and ends the session once only those are left.
  // A plan run drills what its step still needs, for supporters too.
  // Wait for today's counts to settle: right after a session (Keep training,
  // the next plan step) they are refetching, and the cached ones would hand
  // out the same limit again.
  const countsFetching =
    useIsFetching({ queryKey: ['training', 'drillsToday'] }) + useIsFetching({ queryKey: ['blunders', 'kind', 'opening'] });
  // A plan run sizes itself from today's counts, so it also needs them to have
  // loaded: a failed fetch would read as nothing done and hand out the whole goal.
  const capReady =
    !!profile &&
    !quota.positions.pending &&
    !quota.openings.pending &&
    countsFetching === 0 &&
    (!planRun || (quota.positions.known && quota.openings.known));
  const stepLeft = (q: { limit: number; used: number }) => Math.max(0, q.limit - q.used);
  const dailyCap = planRun ? stepLeft(quota.positions) : quota.positions.remaining;
  const openingsCap = planRun ? stepLeft(quota.openings) : quota.openings.remaining;

  useEffect(() => {
    if (restarting || !sessionReady || !filteredBlunders || !capReady) return;
    // Only initialize the store from the query when we haven't started training yet
    // (loading) or when the queue was empty (waiting for a sync to populate).
    // Don't interrupt an active session (reviewing/solving/correct/incorrect/complete).
    const { phase } = useTrainingStore.getState();
    if (phase === 'loading' || phase === 'empty') {
      useTrainingStore.getState().setRevealBeforeSolve(profile?.revealBeforeSolve ?? false);
      useTrainingStore.getState().setDailyCap(dailyCap, openingsCap);
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
    restarting,
    sessionReady,
    filteredBlunders,
    capReady,
    dailyCap,
    openingsCap,
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
        if (state.phase === 'introducing') skipIntro();
        else if (state.phase === 'reviewing') state.proceedFromReview();
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

  if (!sessionReady && !restarting) {
    return (
      <TrainLandingScreen
        due={dueData ?? null}
        onPick={(filter: TrainingFocus) => {
          if (!guard(quotaKindFor(filter))) return;
          setPickedFilter(filter);
          setPickerOpen(false);
        }}
      />
    );
  }

  if (
    restarting ||
    sourceQuery.isLoading ||
    (needsGames && filterGamesQuery.isLoading) ||
    state.phase === 'loading'
  ) {
    return (
      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6"
        aria-busy="true"
        aria-label={t('train.loadingPosition')}
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

  if (state.phase === 'empty' || (state.phase === 'complete' && state.totalAttempted === 0 && !state.cappedOut)) {
    // What "Practice ahead" would drill for this focus (motif narrows here;
    // opening/situation focuses narrow once the batch is loaded).
    const offer = upcoming.data
      ? motifFilter
        ? upcoming.data.filter((b) => b.motifs.includes(motifFilter))
        : upcoming.data
      : [];
    const canPractice = !practiceAhead && offer.length > 0;
    // Until the practice-ahead lookup answers we can't tell "keep going" from
    // "nothing to drill yet" (it just ran out after a finished focus, too), so
    // show a placeholder instead of the dead-end copy and buttons.
    const offerPending = !practiceAhead && upcoming.isPending;
    const returnBack = returnPath ? (
      <button className={canPractice ? 'btn-outline' : 'btn-primary'} onClick={() => navigate(returnPath)}>
        {returnLabel(returnPath, t)}
      </button>
    ) : null;
    const syncButton = hasAccount ? (
      <button
        className={canPractice || returnBack ? 'btn-outline' : 'btn-primary'}
        disabled={isSyncing || !profile}
        onClick={() => profile && void triggerNow(profile)}
      >
        {isSyncing ? t('plan.play.checking') : t('plan.play.check')}
      </button>
    ) : (
      <button className="btn-outline" onClick={() => navigate('/profile')}>
        {t('train.linkAccount')}
      </button>
    );
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-4" data-testid="training-empty">
        <h1 className="heading-lg">
          {practiceAhead
            ? focusFilterLabel
              ? t('train.empty.nothingComingIn', { focus: focusFilterLabel })
              : t('train.empty.nothingLeft')
            : focusFilterLabel
              ? t('train.empty.nothingDueIn', { focus: focusFilterLabel })
              : t('train.empty.caughtUp')}
        </h1>
        {offerPending ? (
          <div className="flex flex-col gap-4" aria-busy="true" data-testid="training-empty-pending">
            <Skeleton className="h-4 w-3/4 mx-auto" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <p className="text-text-primary text-sm">
            {/* Practice ahead lists every live position that isn't due, so an
                empty practice-ahead queue means this focus has none at all yet. */}
            {canPractice
              ? t('train.empty.keepGoing')
              : hasAccount
                ? t('train.empty.nothingYet')
                : t('train.empty.linkToStart')}
          </p>
        )}
        {!offerPending && canPractice && (
          <button className="btn-primary" onClick={startPracticeAhead} data-testid="practice-ahead">
            {t('plan.practiceAhead')}
          </button>
        )}
        {!offerPending && (
          <>
            {returnBack}
            {focusFilterLabel && !returnPath && !kindFilter && (
              <button className="btn-outline" onClick={resetToUnfiltered}>
                {t('train.empty.everythingDue')}
              </button>
            )}
            {!focusFilterLabel && (
              <button className="btn-outline" onClick={backToPicker}>
                {t('train.empty.pickFocus')}
              </button>
            )}
            {syncButton}
          </>
        )}
      </div>
    );
  }

  if (state.phase === 'complete') {
    return (
      <TrainingCompleteScreen
        totalCorrect={state.totalCorrect}
        totalAttempted={state.totalAttempted}
        focusLabel={focusFilterLabel}
        returnLabel={returnPath ? returnLabel(returnPath, t) : null}
        onReturn={returnPath ? () => navigate(returnPath) : null}
        onKeepTraining={keepTraining}
        onBackToDashboard={() => navigate('/dashboard')}
        onStartFocus={(focus) => restartWith(focus)}
        sessionFocused={hasFilter(effectiveState)}
        cappedOut={state.cappedOut}
        cappedKind={state.cappedKind}
        limitResetsAt={quota.resetsAt}
        planRun={planRun}
        runStep={kindFilter === 'opening' ? 'openings' : planRun ? 'train' : null}
        unlimited={quota.unlimited}
      />
    );
  }

  const blunder = state.blunders[state.currentIndex];

  const filterBanner = activeFilterLabel ? (
    <div
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-none border-2 border-text-primary bg-surface-3 px-3 py-2"
      data-testid="training-focus-banner"
    >
      <span className="font-mono text-xs uppercase tracking-tight text-gold-dark">
        {t('train.banner.positions', { focus: activeFilterLabel, count: state.blunders.length })}
      </span>
      <span className="flex items-baseline gap-3">
        {returnPath && (
          <button
            className="font-mono text-xs uppercase tracking-tight text-text-primary hover:text-gold-dark"
            onClick={() => navigate(returnPath)}
          >
            {returnLabel(returnPath, t)}
          </button>
        )}
        <button
          className="font-mono text-xs uppercase tracking-tight text-text-primary hover:text-gold-dark"
          onClick={backToPicker}
        >
          {t('train.changeFocus')}
        </button>
      </span>
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
    state.currentContext?.gameState === 'missedWin' ? t('train.engineLine') : t('train.whyItLoses');
  const triedSan = state.playedRefutationMoves[0]?.san ?? null;

  const sharePlayersLabel = blunder ? sharePlayersLabelFor(blunder, state.game) : null;
  const shareOpeningLabel = shareOpeningLabelFor(state.game);
  const shareUrl = blunder
    ? buildPuzzleShareUrl(blunder, {
        players: sharePlayersLabel,
        opening: shareOpeningLabel,
        anonymous: shareAnonymous,
      })
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
              {t('common.dismiss')}
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
                aria-label={t('train.skipRefutation')}
                onClick={skipAutoplay}
                className="absolute inset-0 z-10 bg-transparent"
              />
            ) : (
              <BoardActionOverlay
                message={
                  state.phase === 'correct'
                    ? state.openingVerdict
                      ? state.openingVerdict.kind === 'sound'
                        ? t('train.goodMove')
                        : t('train.great')
                      : t('train.solutionCorrect')
                    : state.incorrectFeedback?.message ?? t('train.notBest')
                }
                actionLabel={
                  state.phase === 'correct'
                    ? t('common.next')
                    : state.incorrectRequeue && blunder?.kind !== 'opening'
                      ? t('train.continue')
                      : t('common.tryAgain')
                }
                onAction={() => {
                  if (state.phase === 'correct') state.advance();
                  else if (state.incorrectRequeue && blunder?.kind !== 'opening') state.requeueAndAdvance();
                  else state.retry();
                }}
                dismissLabel={t('train.reviewLines')}
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
                setDeleteError(res.error ?? t('train.deleteFailed'));
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
