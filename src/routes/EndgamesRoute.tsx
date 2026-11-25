import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useGames } from '../hooks/useGames';
import { useEndgameScenarios } from '../hooks/useEndgameScenarios';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';
import {
  EndgameScenario,
  EndgameScenarioWithSeverity,
  isScenarioDue,
} from '../models/endgameScenario';
import { SR_BUCKET_LABEL, SR_BUCKET_ORDER, srBucket, type SrBucket } from '../models/blunder';
import { applyScenarioResult } from '../state/drills/applyDrillResult';
import { MasteryDots } from '../components/MasteryDots';
import { SR_BUCKET_PILL } from '../components/training/PositionSrState';
import { useEndgamePlayoutStore } from '../state/endgamePlayoutStore';
import { FINISH_RULES } from '../chess/adjudication';
import { playSound } from '../lib/sounds';
import { useAuth } from '../auth/useAuth';
import { useDailyQuota } from '../hooks/useDailyQuota';
import { openDailyLimit } from '../state/supporterUnlockStore';
import { DailyLimitBanner } from '../components/supporter/DailyLimitBanner';
import { LockIcon } from '../components/icons/LockIcon';
import { detectTimezone, localDate } from '../services/streakService';
import { recordStreakActivity } from '../services/streakUpdate';
import { startEndgameScenarioVerification } from '../services/endgameScenarioVerifier';
import {
  classifyEndgameType,
  ENDGAME_TYPE_LABEL,
  ENDGAME_TYPE_ORDER,
  isOppositeColoredBishops,
  type EndgameType,
} from '../chess/endgameType';
import { BoardPanel } from '../components/BoardPanel';
import { BoardActionBar } from '../components/BoardActionBar';
import { BoardStage } from '../components/BoardStage';
import { SideToPlay } from '../components/SideToPlay';
import { BoardActionOverlay, useActionOverlay } from '../components/BoardActionOverlay';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { MiniBoard } from '../components/MiniBoard';
import {
  PlayoutProgress,
  SlipReport,
  SlipPreview,
  usePlayoutHint,
  useSlipLineViewer,
} from '../components/endgame/PlayoutPanel';
import { Skeleton } from '../components/Skeleton';
import { GameRecord } from '../models/gameRecord';
import { useT, type Translator } from '../i18n/useT';
import { useDailyPlan } from '../hooks/useDailyPlan';
import { isEndgamesPlanRunState, stepAfter, usePlanStepStart } from '../hooks/usePlanStepStart';
import { nextStepCopy, PlanRunNext } from '../components/insights/PlanRunNext';

type ListFilter = 'all' | 'due' | SrBucket;

/** Cards rendered per type section before "Show more" — each card mounts a board. */
const SECTION_PAGE = 24;

function filterChipClass(active: boolean): string {
  return clsx(
    'px-3 py-1 rounded-none font-mono text-xs uppercase tracking-tight border-2 transition',
    active
      ? 'bg-text-primary text-bg border-text-primary'
      : 'bg-surface text-text-primary border-text-primary/30 hover:border-text-primary',
  );
}

function parseTypeParam(value: string | null): EndgameType | 'all' {
  return ENDGAME_TYPE_ORDER.find((t) => t === value) ?? 'all';
}

/** Review order: the ones you just failed first, then the most overdue. */
function byReviewPriority(a: EndgameScenario, z: EndgameScenario): number {
  return (
    Number(z.lastDrillFailed) - Number(a.lastDrillFailed) ||
    (a.nextDrillAt?.getTime() ?? 0) - (z.nextDrillAt?.getTime() ?? 0)
  );
}

function scenarioHeadline(s: EndgameScenario, t: Translator): string {
  if (s.deservedResult === 'win') {
    return s.actualResult === 'draw' ? t('eg.headline.winDrew') : t('eg.headline.winLost');
  }
  return t('eg.headline.holdLost');
}

export function EndgamesRoute() {
  const t = useT();
  const queryClient = useQueryClient();
  const { profile, refreshProfile } = useAuth();
  const gamesQuery = useGames();
  const games = gamesQuery.data;

  const scenariosQuery = useEndgameScenarios();
  const scenarios = scenariosQuery.data;

  const gameById = useMemo(() => {
    const m = new Map<string, GameRecord>();
    for (const g of games ?? []) m.set(g.id, g);
    return m;
  }, [games]);

  const [listFilter, setListFilter] = useState<ListFilter>('all');
  // Endgame type lives in the URL (?type=rook) so it survives leaving the tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const typeFilter = parseTypeParam(searchParams.get('type'));
  const setTypeFilter = (type: EndgameType | 'all') =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (type === 'all') next.delete('type');
        else next.set('type', type);
        return next;
      },
      { replace: true },
    );

  const typeById = useMemo(() => {
    const m = new Map<string, EndgameType>();
    for (const s of scenarios ?? []) m.set(s.id, classifyEndgameType(s.startFen));
    return m;
  }, [scenarios]);
  const typeCounts = useMemo(() => {
    const counts = new Map<EndgameType, number>();
    for (const t of typeById.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  }, [typeById]);
  // Everything below (status counts, sections, "Review N due") respects the type filter.
  const typed = useMemo(
    () =>
      (scenarios ?? []).filter((s) => typeFilter === 'all' || typeById.get(s.id) === typeFilter),
    [scenarios, typeFilter, typeById],
  );

  // Grouped by endgame family (material of the start position), worst
  // chances-lost first within each group. Win/draw shows on the card headline.
  const sections = useMemo(() => {
    const bySeverity = (a: EndgameScenarioWithSeverity, z: EndgameScenarioWithSeverity) =>
      (z.severity ?? -1) - (a.severity ?? -1) ||
      z.createdAt.getTime() - a.createdAt.getTime();
    const visible = typed.filter((s) =>
      listFilter === 'all' ? true : listFilter === 'due' ? isScenarioDue(s) : srBucket(s) === listFilter,
    );
    return ENDGAME_TYPE_ORDER.map((type) => ({
      key: type,
      title: t.label('endgameType', type, ENDGAME_TYPE_LABEL[type]),
      items: visible.filter((s) => typeById.get(s.id) === type).sort(bySeverity),
    })).filter((sec) => sec.items.length > 0);
  }, [typed, listFilter, typeById, t]);
  // Cards shown per section; reset whenever the filters change.
  const [sectionShown, setSectionShown] = useState<Partial<Record<EndgameType, number>>>({});
  useEffect(() => setSectionShown({}), [listFilter, typeFilter]);

  const masteredTotal = useMemo(
    () => (scenarios ?? []).filter((s) => srBucket(s) === 'mastered').length,
    [scenarios],
  );
  const bucketCounts = useMemo(() => {
    const counts: Record<SrBucket, number> = { new: 0, learning: 0, tryAgain: 0, mastered: 0 };
    for (const s of typed) counts[srBucket(s)] += 1;
    return counts;
  }, [typed]);
  const dueScenarios = useMemo(
    () => typed.filter((s) => isScenarioDue(s)).sort(byReviewPriority),
    [typed],
  );
  // "Review N due": the remaining ids of the review run, null outside one.
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  // Only a scenario's first finished play-out per visit moves the SR ladder;
  // retries from the slip (or a restart) are practice.
  const playedThisVisit = useRef(new Set<string>());

  // A plan run (the plan card's Endgames step): play what today's step still
  // needs, then move on to the next unfinished step. `target` play-outs,
  // `finished` counts first finishes during the run.
  const location = useLocation();
  const navigate = useNavigate();
  const plan = useDailyPlan();
  const startStep = usePlanStepStart(plan);
  const [planRun, setPlanRun] = useState<{ target: number; finished: number } | null>(null);
  const planRunActive = useRef(false);
  planRunActive.current = planRun != null;
  const runDone = planRun != null && planRun.finished >= planRun.target;
  const runNext = runDone ? stepAfter(plan, 'endgames', true) : null;

  // Free players finish PLAYOUTS_PER_DAY play-outs a day (dailyLimit.ts).
  // Counted from the scenarios played today plus this visit's, so the limit
  // holds before the list refetches. Retrying the current play-out is free.
  const quota = useDailyQuota();
  const tz = profile?.timezone ?? detectTimezone();
  // A function, not a value: the Space handler's closure must still see this
  // visit's play-outs (playedThisVisit is a ref).
  const isEndgamesLocked = () => {
    if (quota.unlimited || quota.endgames.pending) return false;
    const today = localDate(tz);
    const ids = new Set(
      (scenarios ?? []).filter((s) => s.lastPlayedAt && localDate(tz, s.lastPlayedAt) === today).map((s) => s.id),
    );
    for (const id of playedThisVisit.current) ids.add(id);
    return ids.size >= quota.endgames.limit;
  };
  const endgamesLocked = isEndgamesLocked();
  const showEndgameLimit = () =>
    openDailyLimit({ kind: 'endgames', limit: quota.endgames.limit, resetsAt: quota.resetsAt });

  const [selected, setSelected] = useState<EndgameScenario | null>(null);
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState<SlipPreview | null>(null);
  const playout = useEndgamePlayoutStore();
  const hint = usePlayoutHint({
    bestMove: playout.refEval?.bestMove,
    solving: playout.phase === 'solving',
    moveCount: playout.userMovesPlayed,
  });
  const slipViewer = useSlipLineViewer({
    slip: playout.slip,
    target: selected?.deservedResult ?? 'win',
    userColor: selected?.userColor ?? 'white',
    active: playout.phase === 'failed',
    onPreview: setPreview,
  });
  const overlay = useActionOverlay(`${selected?.id ?? 'none'}:${playout.phase}`);

  // Leaving the tab abandons any in-flight play-out.
  useEffect(() => () => useEndgamePlayoutStore.getState().reset(), []);
  // Re-check unverified scenarios here too — the user is about to play them.
  // Play-outs use the opponent engine, so this doesn't contend with them.
  useEffect(() => startEndgameScenarioVerification(), []);

  useEffect(() => {
    if (playout.phase === 'passed') playSound('correct');
    else if (playout.phase === 'failed') playSound('incorrect');
  }, [playout.phase]);

  const begin = (scenario: EndgameScenario) => {
    if (isEndgamesLocked()) {
      showEndgameLimit();
      return;
    }
    setSelected(scenario);
    setPaused(false);
    hint.reset();
    setPreview(null);
    void playout.start({
      startFen: scenario.startFen,
      userColor: scenario.userColor,
      target: scenario.deservedResult,
      sourceGameId: scenario.gameId,
      // The Endgames tab plays to the finish; take-back is a free practice tool here.
      rules: FINISH_RULES,
      allowTakeBack: true,
      onFinish: (r) => {
        const isFirstAttempt = !playedThisVisit.current.has(scenario.id);
        playedThisVisit.current.add(scenario.id);
        if (isFirstAttempt && planRunActive.current) {
          setPlanRun((run) => (run ? { ...run, finished: run.finished + 1 } : run));
        }
        // A finished play-out is training: it keeps the daily streak alive.
        if (profile) {
          void recordStreakActivity({
            currentStreakDays: profile.currentStreakDays,
            longestStreakDays: profile.longestStreakDays,
            lastDrillLocalDate: profile.lastDrillLocalDate,
            timezone: profile.timezone,
            streakFreezes: profile.streakFreezes,
          }).then((next) => {
            if (next?.changed) void refreshProfile();
          });
        }
        void applyScenarioResult(scenario, { success: r.success, isFirstAttempt })
          .write.then(() =>
            queryClient.invalidateQueries({ queryKey: ['endgameScenarios'], refetchType: 'all' }),
          )
          .catch((err) => console.warn('[endgames] failed to save result', err));
      },
    });
  };

  const retry = (from: 'start' | 'slip') => {
    hint.reset();
    setPreview(null);
    void playout.retry(from);
  };

  const backToList = () => {
    playout.reset();
    setSelected(null);
    setPreview(null);
    setReviewQueue(null);
    setPlanRun(null);
  };

  // Start the plan run once the scenarios and today's count are in: due
  // play-outs first, then the ones due soonest, as many as the step needs.
  const planRunRequested = isEndgamesPlanRunState(location.state);
  useEffect(() => {
    if (!planRunRequested || !scenarios || plan.scenariosPending) return;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    const need = Math.max(0, plan.endgamesGoal - plan.playoutsToday);
    // Replaying one already played today wouldn't move today's count.
    const today = localDate(tz);
    const ordered = scenarios.filter((sc) => !(sc.lastPlayedAt && localDate(tz, sc.lastPlayedAt) === today)).sort(
      (a, z) => Number(isScenarioDue(z)) - Number(isScenarioDue(a)) || byReviewPriority(a, z),
    );
    const [first, ...rest] = ordered.slice(0, need);
    if (!first) return;
    setPlanRun({ target: need, finished: 0 });
    planRunActive.current = true;
    setReviewQueue(rest.map((sc) => sc.id));
    begin(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRunRequested, scenarios, plan.scenariosPending]);

  const startReview = () => {
    const [first, ...rest] = dueScenarios;
    if (!first) return;
    if (isEndgamesLocked()) {
      showEndgameLimit();
      return;
    }
    setReviewQueue(rest.map((s) => s.id));
    begin(first);
  };

  // Next scenario of the review run (skipping any that left the list meanwhile).
  const nextDue = () => {
    if (isEndgamesLocked()) {
      backToList();
      showEndgameLimit();
      return;
    }
    const queue = [...(reviewQueue ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const next = scenarios?.find((s) => s.id === id);
      if (next) {
        setReviewQueue(queue);
        playout.reset();
        begin(next);
        return;
      }
    }
    backToList();
  };
  const hasNextDue = (reviewQueue?.length ?? 0) > 0;

  // Space advances the finished play-out, same as the training shell: retry
  // from the mistake after a fail, back to the list after a pass.
  // preventDefault on keydown also stops a still-focused button from
  // re-activating on the Space keyup.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const { phase, slip } = useEndgamePlayoutStore.getState();
      if (phase === 'failed') {
        e.preventDefault();
        retry(slip ? 'slip' : 'start');
      } else if (phase === 'passed') {
        e.preventDefault();
        if (hasNextDue) nextDue();
        else if (runNext && runNext !== 'play') startStep(runNext);
        else backToList();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hasNextDue, runNext]);

  // ---- Play-out view ----
  if (selected) {
    const game = gameById.get(selected.gameId);
    const playing =
      playout.phase === 'solving' || playout.phase === 'judging' || playout.phase === 'thinking';
    const settingUp = playout.phase === 'solving' && playout.refPending && playout.lastMove === null;
    const canTakeBack =
      playout.allowTakeBack && playout.phase === 'solving' && playout.history.length > 0 && !paused;

    const externalPlatform = resolvePlatform(game?.platform, 'lichess');
    const displayedFen = preview?.fen ?? (playout.fen || selected.startFen);
    const externalAnalysis =
      externalPlatform && displayedFen
        ? externalAnalysisUrl(externalPlatform, displayedFen, { orientation: selected.userColor })
        : null;

    const passedMessage =
      playout.terminal === 'checkmate-by-user'
        ? t('eg.passed.mate')
        : selected.deservedResult === 'win'
          ? t('eg.passed.win')
          : playout.terminal
            ? t('eg.passed.draw')
            : t('eg.passed.engineDraw');
    const failedMessage =
      playout.terminal === 'checkmate-by-opponent'
        ? t('eg.failed.mated')
        : playout.terminal === 'stalemate'
          ? t('egDrill.stalemate')
          : playout.terminal === 'draw-rule'
            ? t('eg.failed.drawRule')
          : selected.deservedResult === 'win'
            ? t('egDrill.givesUpWin')
            : t('egDrill.givesUpDraw');

    return (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="flex flex-col gap-3">
          <BoardStage
            paused={paused}
            overlay={
              overlay.enabled &&
              (playout.phase === 'passed' || playout.phase === 'failed') &&
              (slipViewer.autoplayActive ? (
                // Let the lines play out visibly first; a tap jumps to the end.
                <button
                  type="button"
                  aria-label={t('egDrill.skipAutoplay')}
                  onClick={slipViewer.skipAutoplay}
                  className="absolute inset-0 z-10 bg-transparent"
                />
              ) : (
                <BoardActionOverlay
                  message={playout.phase === 'passed' ? passedMessage : failedMessage}
                  actionLabel={
                    playout.phase === 'passed'
                      ? runNext && runNext !== 'play'
                        ? nextStepCopy(runNext, plan, t).action
                        : hasNextDue
                        ? t('eg.nextDue')
                        : t('eg.returnToList')
                      : playout.slip
                        ? t('eg.retryMistake')
                        : t('eg.restart')
                  }
                  onAction={() => {
                    if (playout.phase === 'passed') {
                      if (runNext && runNext !== 'play') startStep(runNext);
                      else if (hasNextDue) nextDue();
                      else backToList();
                    } else retry(playout.slip ? 'slip' : 'start');
                  }}
                  dismissLabel={
                    playout.phase === 'failed' && playout.slip
                      ? t('train.reviewLines')
                      : t('egDrill.viewBoard')
                  }
                  onDismiss={overlay.dismiss}
                />
              ))
            }
          >
            <BoardPanel
              fen={displayedFen}
              orientation={selected.userColor}
              movableFor={playout.phase === 'solving' && !paused ? selected.userColor : null}
              lastMove={preview ? preview.lastMove : playout.lastMove}
              shapes={preview?.shapes ?? hint.shapes}
              onMove={(m) => void playout.processMove(m)}
            />
          </BoardStage>

          <BoardActionBar
            resetKey={selected.id}
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
            onTakeBack={
              playing
                ? () => {
                    hint.reset();
                    setPreview(null);
                    playout.takeBack();
                  }
                : undefined
            }
            takeBackDisabled={!canTakeBack}
          />
        </div>

        <aside className="card flex flex-col gap-4 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
          <header className="flex items-center justify-between">
            <span className="label">{game ? t('vault.pos.vs', { name: game.opponent }) : t('eg.playout')}</span>
            <button
              className="font-mono text-xs uppercase tracking-tight text-text-primary hover:text-text-primary"
              onClick={backToList}
            >
              {t('common.back')}
            </button>
          </header>

          <div className="text-sm">
            <p className="font-semibold text-text-primary">
              {selected.deservedResult === 'win' ? t('eg.convert') : t('eg.hold')}
            </p>
            <p className="text-text-primary mt-1">
              {selected.deservedResult === 'win'
                ? selected.actualResult === 'draw'
                  ? t('eg.inGameDrewWin')
                  : t('eg.inGameLostWin')
                : selected.actualResult === 'draw'
                  ? t('eg.inGameDrewDraw')
                  : t('eg.inGameLostDraw')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <MasteryDots cycleNumber={selected.cycleNumber} />
            <span className="text-xs font-semibold text-text-primary">
              {t.label('srBucket', srBucket(selected), SR_BUCKET_LABEL[srBucket(selected)])}
            </span>
          </div>

          {playing && (
            <SideToPlay
              color={selected.userColor}
              label={
                selected.userColor === 'white'
                  ? playout.phase === 'thinking'
                    ? t('eg.youPlayWhiteOpp')
                    : t('eg.youPlayWhiteMove')
                  : playout.phase === 'thinking'
                    ? t('eg.youPlayBlackOpp')
                    : t('eg.youPlayBlackMove')
              }
            />
          )}

          {playing && (
            <PlayoutProgress
              target={selected.deservedResult}
              userMovesPlayed={playout.userMovesPlayed}
              evalCp={playout.refEval?.scoreCp ?? null}
              depth={playout.refEval?.depth}
              fen={playout.fen || selected.startFen}
              pending={playout.refPending}
            />
          )}

          {settingUp && <FeedbackBadge tone="info">{t('eg.settingUp')}</FeedbackBadge>}
          {playout.phase === 'judging' && (
            <FeedbackBadge tone="info">
              {playout.confirming ? t('egDrill.doubleChecking') : t('egDrill.judging')}
            </FeedbackBadge>
          )}
          {playout.phase === 'thinking' && (
            <FeedbackBadge tone="info">{t('egDrill.opponentThinking')}</FeedbackBadge>
          )}
          {playout.engineError && (
            <FeedbackBadge tone="warning">{t('egDrill.hiccup')}</FeedbackBadge>
          )}
          {hint.level > 0 && playing && (
            <p className="text-text-primary text-xs">{t('eg.hintShown')}</p>
          )}

          {playout.phase === 'passed' && (
            <>
              <FeedbackBadge tone="success">{passedMessage}</FeedbackBadge>
              {runDone && !runNext && plan.allDone && (
                <p className="text-sm font-semibold text-text-primary" data-testid="plan-run-done">
                  {t('train.complete.planDone')}
                </p>
              )}
              {runNext ? (
                <PlanRunNext plan={plan} step={runNext} onGo={startStep} auto />
              ) : hasNextDue ? (
                <button className="btn-primary" onClick={nextDue} data-testid="next-due">
                  {t('eg.nextDueLeft', { count: reviewQueue?.length ?? 0 })}
                  <span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
                </button>
              ) : (
                <button className="btn-primary" onClick={backToList}>
                  {t('eg.returnToList')}<span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
                </button>
              )}
            </>
          )}

          {playout.phase === 'failed' && (
            <>
              <FeedbackBadge tone="danger">{failedMessage}</FeedbackBadge>
              {playout.slip && (
                <SlipReport
                  slip={playout.slip}
                  target={selected.deservedResult}
                  userColor={selected.userColor}
                  logStatus={playout.slipLog}
                  onLog={() => void playout.logSlip()}
                  viewer={slipViewer}
                />
              )}
              {playout.slip && (
                <button className="btn-primary" onClick={() => retry('slip')}>
                  {t('eg.retryMistake')}<span className="hidden lg:inline ml-1.5"> {t('train.panel.space')}</span>
                </button>
              )}
              <button className="btn-ghost" onClick={() => retry('start')}>
                {t('eg.restart')}
              </button>
              {hasNextDue && (
                <button className="btn-ghost" onClick={nextDue}>
                  {t('eg.skipNext', { count: reviewQueue?.length ?? 0 })}
                </button>
              )}
              {runNext && <PlanRunNext plan={plan} step={runNext} onGo={startStep} />}
            </>
          )}
        </aside>
      </div>
    );
  }

  // ---- List view ----
  if (gamesQuery.isLoading || (scenariosQuery.isLoading && !scenarios)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <div className="card flex flex-col items-start gap-3 max-w-xl">
        <h1 className="text-xl font-bold">{t('nav.endgames')}</h1>
        <p className="text-text-primary">{t('eg.noGames')}</p>
        <Link to="/profile" className="btn-primary">
          {t('eg.connect')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{t('nav.endgames')}</h1>
          <p className="text-text-primary text-sm max-w-2xl">{t('eg.lede')}</p>
          {(scenarios?.length ?? 0) > 0 && (
            <p className="text-text-primary text-sm font-semibold" data-testid="endgame-stats">
              {t('eg.masteredOf', { mastered: masteredTotal, total: scenarios?.length ?? 0 })}
            </p>
          )}
        </div>
        {dueScenarios.length > 0 && (
          <button type="button" className="btn-primary gap-2" onClick={startReview} data-testid="review-due">
            {endgamesLocked && <LockIcon className="h-4 w-4" />}
            {t('eg.reviewDue', { count: dueScenarios.length })}
            {typeFilter !== 'all' && ` · ${t.label('endgameType', typeFilter, ENDGAME_TYPE_LABEL[typeFilter])}`}
          </button>
        )}
      </header>

      {endgamesLocked && (
        <DailyLimitBanner kind="endgames" limit={quota.endgames.limit} resetsAt={quota.resetsAt} />
      )}

      {typeCounts.size > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('eg.filterType')}>
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            aria-pressed={typeFilter === 'all'}
            className={filterChipClass(typeFilter === 'all')}
          >
            {t('eg.allTypes')}
            <span> · {scenarios?.length ?? 0}</span>
          </button>
          {ENDGAME_TYPE_ORDER.filter((type) => typeCounts.has(type)).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(type)}
              aria-pressed={typeFilter === type}
              className={filterChipClass(typeFilter === type)}
            >
              {t.label('endgameType', type, ENDGAME_TYPE_LABEL[type])}
              <span> · {typeCounts.get(type)}</span>
            </button>
          ))}
        </div>
      )}

      {(scenarios?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('eg.filterStatus')}>
          {(
            [
              ['all', t('eg.all'), typed.length],
              ['due', t('eg.due'), dueScenarios.length],
              ...SR_BUCKET_ORDER.map(
                (b) => [b, t.label('srBucket', b, SR_BUCKET_LABEL[b]), bucketCounts[b]] as const,
              ),
            ] as ReadonlyArray<readonly [ListFilter, string, number]>
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setListFilter(key)}
              aria-pressed={listFilter === key}
              className={filterChipClass(listFilter === key)}
            >
              {label}
              <span> · {count}</span>
            </button>
          ))}
        </div>
      )}

      {(scenarios?.length ?? 0) === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-primary">
            {t('eg.noneDropped')}
          </p>
        </div>
      ) : sections.length === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-primary">{t('eg.nothingHere')}</p>
        </div>
      ) : (
        sections.map((section) => {
          const shown = sectionShown[section.key] ?? SECTION_PAGE;
          return (
          <section key={section.key} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-primary">
              {section.title}
              <span className="font-mono font-normal"> · {section.items.length}</span>
            </h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.items.slice(0, shown).map((s) => {
                const game = gameById.get(s.gameId);
                return (
                  <li key={s.id} className="card flex gap-3">
                    <MiniBoard
                      fen={s.startFen}
                      orientation={s.userColor}
                      className="w-28 shrink-0 self-start border-2 border-text-primary"
                    />
                    <div className="flex flex-col gap-2 min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-text-primary">
                          {scenarioHeadline(s, t)}
                        </span>
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2',
                            SR_BUCKET_PILL[srBucket(s)],
                          )}
                        >
                          {t.label('srBucket', srBucket(s), SR_BUCKET_LABEL[srBucket(s)])}
                        </span>
                        {isOppositeColoredBishops(s.startFen) && (
                          <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2 border-text-primary/30 text-text-primary">
                            {t('eg.ocb')}
                          </span>
                        )}
                      </div>
                      <MasteryDots cycleNumber={s.cycleNumber} size="sm" />
                      <p className="text-text-primary text-sm">
                        {game ? t('vault.pos.vs', { name: game.opponent }) : t('eg.unknownGame')}
                        {game?.playedAt ? ` · ${game.playedAt.toLocaleDateString()}` : ''}
                        {s.attempts > 0
                          ? ` · ${t('eg.attempts', { count: s.attempts })}`
                          : ''}
                      </p>
                      <div className="mt-auto flex items-center gap-3">
                        <button className="btn-primary" onClick={() => begin(s)}>
                          {t('common.play')}
                        </button>
                        {isScenarioDue(s) && (
                          <span className="text-xs font-semibold text-gold-dark" data-testid="scenario-due">
                            {t('eg.dueBadge')}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {section.items.length > shown && (
              <button
                type="button"
                className="btn-outline self-center"
                onClick={() =>
                  setSectionShown((prev) => ({ ...prev, [section.key]: shown + SECTION_PAGE }))
                }
              >
                {t('vault.showMoreLeft', { count: section.items.length - shown })}
              </button>
            )}
          </section>
          );
        })
      )}
    </div>
  );
}
