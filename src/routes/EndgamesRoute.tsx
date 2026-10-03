import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { startEndgameScenarioVerification } from '../services/endgameScenarioVerifier';
import {
  classifyEndgameType,
  ENDGAME_TYPE_LABEL,
  ENDGAME_TYPE_ORDER,
  isOppositeColoredBishops,
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

type ListFilter = 'all' | 'due' | SrBucket;

/** Review order: the ones you just failed first, then the most overdue. */
function byReviewPriority(a: EndgameScenario, z: EndgameScenario): number {
  return (
    Number(z.lastDrillFailed) - Number(a.lastDrillFailed) ||
    (a.nextDrillAt?.getTime() ?? 0) - (z.nextDrillAt?.getTime() ?? 0)
  );
}

function scenarioHeadline(s: EndgameScenario): string {
  if (s.deservedResult === 'win') {
    return s.actualResult === 'draw' ? 'Winning — only drew' : 'Winning — lost';
  }
  return 'Holdable — lost';
}

export function EndgamesRoute() {
  const queryClient = useQueryClient();
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

  // Grouped by endgame family (material of the start position), worst
  // chances-lost first within each group. Win/draw shows on the card headline.
  const sections = useMemo(() => {
    const bySeverity = (a: EndgameScenarioWithSeverity, z: EndgameScenarioWithSeverity) =>
      (z.severity ?? -1) - (a.severity ?? -1) ||
      z.createdAt.getTime() - a.createdAt.getTime();
    const visible = (scenarios ?? []).filter((s) =>
      listFilter === 'all' ? true : listFilter === 'due' ? isScenarioDue(s) : srBucket(s) === listFilter,
    );
    return ENDGAME_TYPE_ORDER.map((type) => ({
      key: type,
      title: ENDGAME_TYPE_LABEL[type],
      items: visible.filter((s) => classifyEndgameType(s.startFen) === type).sort(bySeverity),
    })).filter((sec) => sec.items.length > 0);
  }, [scenarios, listFilter]);

  const bucketCounts = useMemo(() => {
    const counts: Record<SrBucket, number> = { new: 0, learning: 0, tryAgain: 0, mastered: 0 };
    for (const s of scenarios ?? []) counts[srBucket(s)] += 1;
    return counts;
  }, [scenarios]);
  const dueScenarios = useMemo(
    () => (scenarios ?? []).filter((s) => isScenarioDue(s)).sort(byReviewPriority),
    [scenarios],
  );
  // "Review N due": the remaining ids of the review run, null outside one.
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null);
  // Only a scenario's first finished play-out per visit moves the SR ladder;
  // retries from the slip (or a restart) are practice.
  const playedThisVisit = useRef(new Set<string>());

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
        void applyScenarioResult(scenario, { success: r.success, isFirstAttempt })
          .then(() =>
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
  };

  const startReview = () => {
    const [first, ...rest] = dueScenarios;
    if (!first) return;
    setReviewQueue(rest.map((s) => s.id));
    begin(first);
  };

  // Next scenario of the review run (skipping any that left the list meanwhile).
  const nextDue = () => {
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
        else backToList();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hasNextDue]);

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
        ? 'Checkmate — point rescued.'
        : selected.deservedResult === 'win'
          ? 'Win secured — point rescued.'
          : playout.terminal
            ? 'Draw held — half point rescued.'
            : 'Engine accepts the draw — half point rescued.';
    const failedMessage =
      playout.terminal === 'checkmate-by-opponent'
        ? 'Checkmated — the point slipped away again.'
        : playout.terminal === 'stalemate'
          ? 'Stalemate — the win slipped away.'
          : playout.terminal === 'draw-rule'
            ? 'Drawn by rule — the win slipped away.'
          : selected.deservedResult === 'win'
            ? 'That move gives up the win.'
            : 'That move gives up the draw.';

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
                  aria-label="Skip autoplay"
                  onClick={slipViewer.skipAutoplay}
                  className="absolute inset-0 z-10 bg-transparent"
                />
              ) : (
                <BoardActionOverlay
                  message={playout.phase === 'passed' ? passedMessage : failedMessage}
                  actionLabel={
                    playout.phase === 'passed'
                      ? hasNextDue
                        ? 'Next due'
                        : 'Return to list'
                      : playout.slip
                        ? 'Retry from the mistake'
                        : 'Restart play-out'
                  }
                  onAction={() => {
                    if (playout.phase === 'passed') {
                      if (hasNextDue) nextDue();
                      else backToList();
                    } else retry(playout.slip ? 'slip' : 'start');
                  }}
                  dismissLabel={
                    playout.phase === 'failed' && playout.slip
                      ? 'Review the lines'
                      : 'View board'
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
            <span className="label">{game ? `vs ${game.opponent}` : 'Endgame play-out'}</span>
            <button
              className="font-mono text-xs uppercase tracking-tight text-text-secondary hover:text-text-primary"
              onClick={backToList}
            >
              Back
            </button>
          </header>

          <div className="text-sm">
            <p className="font-semibold text-text-primary">
              {selected.deservedResult === 'win' ? 'Convert this win.' : 'Hold this draw.'}
            </p>
            <p className="text-text-secondary mt-1">
              In the game you {selected.actualResult === 'draw' ? 'only drew' : 'lost'}. Play it
              out against the engine —{' '}
              {selected.deservedResult === 'win'
                ? 'deliver checkmate to rescue the point.'
                : 'hold until the engine gives up on winning to rescue the half point.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <MasteryDots cycleNumber={selected.cycleNumber} />
            <span className="text-xs font-semibold text-text-primary">{SR_BUCKET_LABEL[srBucket(selected)]}</span>
          </div>

          {playing && (
            <SideToPlay
              color={selected.userColor}
              label={`You play ${selected.userColor === 'white' ? 'White' : 'Black'} — ${
                playout.phase === 'thinking' ? 'opponent to move' : 'your move'
              }`}
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

          {settingUp && <FeedbackBadge tone="info">Setting up the position…</FeedbackBadge>}
          {playout.phase === 'judging' && (
            <FeedbackBadge tone="info">Judging your move…</FeedbackBadge>
          )}
          {playout.phase === 'thinking' && (
            <FeedbackBadge tone="info">Opponent thinking…</FeedbackBadge>
          )}
          {playout.engineError && (
            <FeedbackBadge tone="warning">Engine hiccup — keep playing</FeedbackBadge>
          )}
          {hint.level > 0 && playing && (
            <p className="text-text-secondary text-xs">Hint shown.</p>
          )}

          {playout.phase === 'passed' && (
            <>
              <FeedbackBadge tone="success">{passedMessage}</FeedbackBadge>
              {hasNextDue ? (
                <button className="btn-primary" onClick={nextDue} data-testid="next-due">
                  Next due ({reviewQueue?.length} left)
                  <span className="hidden lg:inline ml-1.5"> (Space)</span>
                </button>
              ) : (
                <button className="btn-primary" onClick={backToList}>
                  Return to list<span className="hidden lg:inline ml-1.5"> (Space)</span>
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
                  Retry from the mistake<span className="hidden lg:inline ml-1.5"> (Space)</span>
                </button>
              )}
              <button className="btn-ghost" onClick={() => retry('start')}>
                Restart play-out
              </button>
              {hasNextDue && (
                <button className="btn-ghost" onClick={nextDue}>
                  Skip to the next due ({reviewQueue?.length} left)
                </button>
              )}
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
        <h1 className="text-xl font-bold">Endgames</h1>
        <p className="text-text-secondary">
          No games yet. Sync your chess.com or Lichess games and analyze them — then this tab
          finds the endgames where you dropped points and lets you replay them.
        </p>
        <Link to="/profile" className="btn-primary">
          Connect an account
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">Endgames</h1>
          <p className="text-text-primary text-sm max-w-2xl">
            Endgames where you dropped points. Play them out against the engine until you keep the
            point; each one comes back on the same schedule as your other drills.
          </p>
          {(scenarios?.length ?? 0) > 0 && (
            <p className="text-text-primary text-sm font-semibold" data-testid="endgame-stats">
              {bucketCounts.mastered} of {scenarios?.length} mastered
            </p>
          )}
        </div>
        {dueScenarios.length > 0 && (
          <button type="button" className="btn-primary" onClick={startReview} data-testid="review-due">
            Review {dueScenarios.length} due
          </button>
        )}
      </header>

      {(scenarios?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {(
            [
              ['all', 'All', scenarios?.length ?? 0],
              ['due', 'Due', dueScenarios.length],
              ...SR_BUCKET_ORDER.map((b) => [b, SR_BUCKET_LABEL[b], bucketCounts[b]] as const),
            ] as ReadonlyArray<readonly [ListFilter, string, number]>
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setListFilter(key)}
              aria-pressed={listFilter === key}
              className={clsx(
                'px-3 py-1 rounded-none font-mono text-xs uppercase tracking-tight border-2 transition',
                listFilter === key
                  ? 'bg-text-primary text-bg border-text-primary'
                  : 'bg-surface text-text-primary border-text-primary/30 hover:border-text-primary',
              )}
            >
              {label}
              <span> · {count}</span>
            </button>
          ))}
        </div>
      )}

      {(scenarios?.length ?? 0) === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-secondary">
            No dropped endgames found — every endgame mistake we detected happened in games you
            weren't winning, or you converted your winning endgames. Nice.
          </p>
        </div>
      ) : sections.length === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-primary">Nothing here yet.</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-3">
            <h2 className="font-mono uppercase tracking-tight text-sm text-text-secondary">
              {section.title}
              <span className="text-text-secondary/60"> · {section.items.length}</span>
            </h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.items.map((s) => {
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
                          {scenarioHeadline(s)}
                        </span>
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2',
                            SR_BUCKET_PILL[srBucket(s)],
                          )}
                        >
                          {SR_BUCKET_LABEL[srBucket(s)]}
                        </span>
                        {isOppositeColoredBishops(s.startFen) && (
                          <span className="px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2 border-text-primary/30 text-text-secondary">
                            Opposite-coloured bishops
                          </span>
                        )}
                      </div>
                      <MasteryDots cycleNumber={s.cycleNumber} size="sm" />
                      <p className="text-text-primary text-sm">
                        {game ? `vs ${game.opponent}` : 'Unknown game'}
                        {game?.playedAt ? ` · ${game.playedAt.toLocaleDateString()}` : ''}
                        {s.attempts > 0
                          ? ` · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`
                          : ''}
                      </p>
                      <div className="mt-auto flex items-center gap-3">
                        <button className="btn-primary" onClick={() => begin(s)}>
                          Play
                        </button>
                        {isScenarioDue(s) && (
                          <span className="text-xs font-semibold text-gold-dark" data-testid="scenario-due">
                            Due
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
