import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { scanForScenarios } from '../services/endgameScenarioService';
import { supabaseService } from '../services/supabaseService';
import { EndgameScenario } from '../models/endgameScenario';
import { useEndgamePlayoutStore } from '../state/endgamePlayoutStore';
import { BoardPanel } from '../components/BoardPanel';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { Skeleton } from '../components/Skeleton';
import { GameRecord } from '../models/gameRecord';

const STATUS_PILL: Record<EndgameScenario['status'], string> = {
  pending: 'bg-gold-light text-text-primary border-text-primary',
  passed: 'bg-correct/20 text-correct border-correct/60',
  failed: 'bg-mistake/20 text-mistake border-mistake/60',
};

const STATUS_LABEL: Record<EndgameScenario['status'], string> = {
  pending: 'Unplayed',
  passed: 'Rescued',
  failed: 'Dropped again',
};

function scenarioHeadline(s: EndgameScenario): string {
  if (s.deservedResult === 'win') {
    return s.actualResult === 'draw' ? 'Winning — only drew' : 'Winning — lost';
  }
  return 'Holdable — lost';
}

export function EndgamesRoute() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gamesQuery = useGames();
  const games = gamesQuery.data;

  const scenariosQuery = useQuery({
    queryKey: ['endgameScenarios', user?.id],
    queryFn: () => scanForScenarios(games ?? []),
    enabled: !!user && !!games,
  });
  const scenarios = scenariosQuery.data;

  const gameById = useMemo(() => {
    const m = new Map<string, GameRecord>();
    for (const g of games ?? []) m.set(g.id, g);
    return m;
  }, [games]);

  const [selected, setSelected] = useState<EndgameScenario | null>(null);
  const playout = useEndgamePlayoutStore();
  const attemptsRef = useRef(0);

  // Leaving the tab abandons any in-flight play-out.
  useEffect(() => () => useEndgamePlayoutStore.getState().reset(), []);

  const begin = (scenario: EndgameScenario) => {
    setSelected(scenario);
    attemptsRef.current = scenario.attempts;
    void playout.start({
      startFen: scenario.startFen,
      userColor: scenario.userColor,
      target: scenario.deservedResult,
      sourceGameId: scenario.gameId,
      logSlips: true,
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
    void playout.retry(from);
  };

  const backToList = () => {
    playout.reset();
    setSelected(null);
  };

  // ---- Play-out view ----
  if (selected) {
    const game = gameById.get(selected.gameId);
    const playing =
      playout.phase === 'solving' || playout.phase === 'thinking' || playout.phase === 'loading';
    const heldPct = Math.round((playout.heldStreak / playout.holdTarget) * 100);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
        <div className="flex flex-col gap-3">
          <BoardPanel
            fen={playout.fen || selected.startFen}
            orientation={selected.userColor}
            movableFor={playout.phase === 'solving' ? selected.userColor : null}
            lastMove={playout.lastMove}
            onMove={(m) => void playout.processMove(m)}
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

          <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm">
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
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="label">Held</span>
                <span className="font-mono text-xs tabular-nums text-text-secondary">
                  {playout.heldStreak}/{playout.holdTarget} moves
                </span>
              </div>
              <div className="h-2 w-full border-2 border-text-primary bg-surface">
                <div className="h-full bg-gold-dark" style={{ width: `${heldPct}%` }} />
              </div>
            </div>
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

          {playout.phase === 'passed' && (
            <>
              <FeedbackBadge tone="success">
                {playout.terminal === 'checkmate-by-user'
                  ? 'Checkmate — point rescued.'
                  : selected.deservedResult === 'win'
                    ? 'Win secured — point rescued.'
                    : 'Draw held — half point rescued.'}
              </FeedbackBadge>
              <button className="btn-primary" onClick={backToList}>
                Back to endgames
              </button>
            </>
          )}

          {playout.phase === 'failed' && (
            <>
              <FeedbackBadge tone="danger">
                {playout.terminal === 'checkmate-by-opponent'
                  ? 'Checkmated — the point slipped away again.'
                  : playout.terminal
                    ? 'Stalemate — the win slipped away.'
                    : selected.deservedResult === 'win'
                      ? 'That move gives up the win.'
                      : 'That move gives up the draw.'}
              </FeedbackBadge>
              {playout.slip && (
                <div className="bg-surface-3 rounded-none border-2 border-text-primary p-3 text-sm flex flex-col gap-1">
                  <p>
                    <span className="text-text-secondary">You played </span>
                    <span className="font-mono font-bold text-incorrect">
                      {playout.slip.playedSan ?? playout.slip.playedUci}
                    </span>
                  </p>
                  {playout.slip.bestSan && (
                    <p>
                      <span className="text-text-secondary">Engine held with </span>
                      <span className="font-mono font-bold text-correct">
                        {playout.slip.bestSan}
                      </span>
                    </p>
                  )}
                  <p className="text-text-secondary text-xs mt-1">
                    Logged — this position joins your training queue.
                  </p>
                </div>
              )}
              {playout.slip && (
                <button className="btn-primary" onClick={() => retry('slip')}>
                  Retry from the mistake
                </button>
              )}
              <button className="btn-ghost" onClick={() => retry('start')}>
                Restart play-out
              </button>
              <button className="btn-ghost" onClick={backToList}>
                Back to endgames
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
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Endgames</h1>
        <p className="text-text-secondary text-sm max-w-2xl">
          Endgames where you had the better result on the board and dropped it — replay them
          against the engine until you can keep the point. Mistakes get logged into your
          training queue.
        </p>
      </header>

      {!scenarios || scenarios.length === 0 ? (
        <div className="card max-w-xl">
          <p className="text-text-secondary">
            No dropped endgames found — every endgame mistake we detected happened in games you
            weren't winning, or you converted your winning endgames. Nice.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map((s) => {
            const game = gameById.get(s.gameId);
            return (
              <li key={s.id} className="card flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{scenarioHeadline(s)}</span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2',
                      STATUS_PILL[s.status],
                    )}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <p className="text-text-secondary text-sm">
                  {game ? `vs ${game.opponent}` : 'Unknown game'}
                  {game?.playedAt ? ` · ${game.playedAt.toLocaleDateString()}` : ''}
                  {s.attempts > 0
                    ? ` · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`
                    : ''}
                </p>
                <div className="mt-auto">
                  <button className="btn-primary" onClick={() => begin(s)}>
                    {s.status === 'pending' ? 'Play it out' : 'Play again'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
