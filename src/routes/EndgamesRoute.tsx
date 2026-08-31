import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useGames } from '../hooks/useGames';
import { useEndgameScenarios } from '../hooks/useEndgameScenarios';
import { supabaseService } from '../services/supabaseService';
import {
  externalAnalysisUrl,
  resolvePlatform,
} from '../services/externalAnalysisUrlService';
import {
  EndgameScenario,
  EndgameScenarioWithSeverity,
  SCENARIO_STATUS_LABEL,
} from '../models/endgameScenario';
import { useEndgamePlayoutStore } from '../state/endgamePlayoutStore';
import { BoardPanel } from '../components/BoardPanel';
import { BoardActionBar } from '../components/BoardActionBar';
import { BoardStage } from '../components/BoardStage';
import { BoardActionOverlay, useActionOverlay } from '../components/BoardActionOverlay';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { MiniBoard } from '../components/MiniBoard';
import {
  HeldMeter,
  SlipReport,
  SlipPreview,
  usePlayoutHint,
  useSlipLineViewer,
} from '../components/endgame/PlayoutPanel';
import { Skeleton } from '../components/Skeleton';
import { GameRecord } from '../models/gameRecord';

const STATUS_PILL: Record<EndgameScenario['status'], string> = {
  pending: 'bg-gold-light text-text-primary border-text-primary',
  passed: 'bg-correct/20 text-correct border-correct/60',
  failed: 'bg-mistake/20 text-mistake border-mistake/60',
};

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

  // Grouped by what was dropped, worst chances-lost first within each group.
  const sections = useMemo(() => {
    const bySeverity = (a: EndgameScenarioWithSeverity, z: EndgameScenarioWithSeverity) =>
      (z.severity ?? -1) - (a.severity ?? -1) ||
      z.createdAt.getTime() - a.createdAt.getTime();
    return [
      {
        key: 'win',
        title: 'Missed wins',
        items: (scenarios ?? []).filter((s) => s.deservedResult === 'win').sort(bySeverity),
      },
      {
        key: 'draw',
        title: 'Missed draws',
        items: (scenarios ?? []).filter((s) => s.deservedResult === 'draw').sort(bySeverity),
      },
    ].filter((sec) => sec.items.length > 0);
  }, [scenarios]);

  const [selected, setSelected] = useState<EndgameScenario | null>(null);
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState<SlipPreview | null>(null);
  const playout = useEndgamePlayoutStore();
  const hint = usePlayoutHint({
    bestMove: playout.refEval?.bestMove,
    solving: playout.phase === 'solving',
  });
  const slipViewer = useSlipLineViewer({
    slip: playout.slip,
    target: selected?.deservedResult ?? 'win',
    userColor: selected?.userColor ?? 'white',
    active: playout.phase === 'failed',
    onPreview: setPreview,
  });
  const overlay = useActionOverlay(`${selected?.id ?? 'none'}:${playout.phase}`);
  const attemptsRef = useRef(0);

  // Leaving the tab abandons any in-flight play-out.
  useEffect(() => () => useEndgamePlayoutStore.getState().reset(), []);

  const begin = (scenario: EndgameScenario) => {
    setSelected(scenario);
    setPaused(false);
    hint.reset();
    setPreview(null);
    attemptsRef.current = scenario.attempts;
    void playout.start({
      startFen: scenario.startFen,
      userColor: scenario.userColor,
      target: scenario.deservedResult,
      sourceGameId: scenario.gameId,
      onFinish: (r) => {
        attemptsRef.current += 1;
        void supabaseService
          .updateEndgameScenarioResult(scenario.id, {
            status: r.success ? 'passed' : 'failed',
            attempts: attemptsRef.current,
          })
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
  };

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
        backToList();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ---- Play-out view ----
  if (selected) {
    const game = gameById.get(selected.gameId);
    const playing =
      playout.phase === 'solving' || playout.phase === 'thinking' || playout.phase === 'loading';

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
          : 'Draw held — half point rescued.';
    const failedMessage =
      playout.terminal === 'checkmate-by-opponent'
        ? 'Checkmated — the point slipped away again.'
        : playout.terminal
          ? 'Stalemate — the win slipped away.'
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
              (playout.phase === 'passed' || playout.phase === 'failed') && (
                <BoardActionOverlay
                  message={playout.phase === 'passed' ? passedMessage : failedMessage}
                  actionLabel={
                    playout.phase === 'passed'
                      ? 'Return to list'
                      : playout.slip
                        ? 'Retry from the mistake'
                        : 'Restart play-out'
                  }
                  onAction={() => {
                    if (playout.phase === 'passed') backToList();
                    else retry(playout.slip ? 'slip' : 'start');
                  }}
                  dismissLabel={
                    playout.phase === 'failed' && playout.slip
                      ? 'Review the lines'
                      : 'View board'
                  }
                  onDismiss={overlay.dismiss}
                />
              )
            }
          >
            <BoardPanel
              fen={displayedFen}
              orientation={selected.userColor}
              movableFor={playout.phase === 'solving' && !paused ? selected.userColor : null}
              lastMove={preview ? preview.lastMove : playout.lastMove}
              shapes={hint.shapes}
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
              out against the engine — hold the {selected.deservedResult} for{' '}
              {playout.holdTarget} moves (or finish it) to rescue the point.
            </p>
          </div>

          {playing && (
            <HeldMeter
              heldStreak={playout.heldStreak}
              holdTarget={playout.holdTarget}
              depth={playout.refEval?.depth}
            />
          )}

          {playout.phase === 'loading' && (
            <FeedbackBadge tone="info">Setting up the position…</FeedbackBadge>
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
              <button className="btn-primary" onClick={backToList}>
                Return to list<span className="hidden lg:inline"> (Space)</span>
              </button>
            </>
          )}

          {playout.phase === 'failed' && (
            <>
              <FeedbackBadge tone="danger">{failedMessage}</FeedbackBadge>
              {playout.slip && (
                <SlipReport
                  slip={playout.slip}
                  target={selected.deservedResult}
                  logStatus={playout.slipLog}
                  onLog={() => void playout.logSlip()}
                  viewer={slipViewer}
                />
              )}
              {playout.slip && (
                <button className="btn-primary" onClick={() => retry('slip')}>
                  Retry from the mistake<span className="hidden lg:inline"> (Space)</span>
                </button>
              )}
              <button className="btn-ghost" onClick={() => retry('start')}>
                Restart play-out
              </button>
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
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Endgames</h1>
        <p className="text-text-secondary text-sm max-w-2xl">
          Endgames where you had the better result on the board and dropped it — replay them
          against the engine until you can keep the point. Slips you make can be added to your
          training queue.
        </p>
      </header>

      {sections.length === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-secondary">
            No dropped endgames found — every endgame mistake we detected happened in games you
            weren't winning, or you converted your winning endgames. Nice.
          </p>
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
                            STATUS_PILL[s.status],
                          )}
                        >
                          {SCENARIO_STATUS_LABEL[s.status]}
                        </span>
                      </div>
                      {s.severity != null && (
                        <p className="font-mono text-xs text-mistake">
                          −{s.severity}% winning chances
                        </p>
                      )}
                      <p className="text-text-secondary text-sm">
                        {game ? `vs ${game.opponent}` : 'Unknown game'}
                        {game?.playedAt ? ` · ${game.playedAt.toLocaleDateString()}` : ''}
                        {s.attempts > 0
                          ? ` · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`
                          : ''}
                      </p>
                      <div className="mt-auto">
                        <button className="btn-primary" onClick={() => begin(s)}>
                          Play
                        </button>
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
