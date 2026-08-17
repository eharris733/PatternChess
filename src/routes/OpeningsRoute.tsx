import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { supabaseService } from '../services/supabaseService';
import { RepertoireColor, RepertoireMove } from '../models/repertoire';
import { getFrequencyIndex } from '../services/positionFrequencyService';
import {
  BuilderQueueItem,
  buildGuidedQueue,
  weightedExplorerMove,
} from '../services/repertoireBuilderService';
import { fetchExplorer } from '../services/openingExplorerService';
import { getStockfish } from '../hooks/useStockfish';
import { moveToUci, parseUciMove, toEpd, uciToSan } from '../chess/moveUtils';
import { BoardPanel } from '../components/BoardPanel';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { Skeleton } from '../components/Skeleton';

interface LocationState {
  color?: RepertoireColor;
  /** Deep link from a trainer's "extend your repertoire from here" prompt. */
  startEpd?: string;
  line?: string[];
}

interface DecisionNode {
  epd: string;
  fen: string;
  line: string[];
  total: number;
  source: 'games' | 'masters';
}

function lineToSans(line: string[]): string[] {
  const chess = new Chess();
  const sans: string[] = [];
  for (const uci of line) {
    try {
      const m = parseUciMove(uci);
      const r = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      if (!r) break;
      sans.push(r.san);
    } catch {
      break;
    }
  }
  return sans;
}

function formatLine(sans: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.${sans[i]}`);
    else parts.push(sans[i]);
  }
  return parts.join(' ');
}

/**
 * Masters-walk fallback: when the user's own games offer no uncovered
 * positions (no games yet, or every reached position is covered), walk from
 * the start position — own nodes follow the repertoire, opponent nodes sample
 * a weighted-random masters reply — and present the first uncovered own node.
 */
async function findMastersNode(
  color: RepertoireColor,
  repertoire: Map<string, RepertoireMove>,
): Promise<DecisionNode | null> {
  const chess = new Chess();
  const line: string[] = [];
  for (let ply = 0; ply < 24; ply++) {
    const fen = chess.fen();
    const epd = toEpd(fen);
    const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
    if (sideToMove === color) {
      const chosen = repertoire.get(epd);
      if (!chosen) return { epd, fen, line: [...line], total: 0, source: 'masters' };
      const m = parseUciMove(chosen.uci);
      try {
        if (!chess.move({ from: m.from, to: m.to, promotion: m.promotion })) return null;
      } catch {
        return null;
      }
      line.push(chosen.uci);
    } else {
      const book = await fetchExplorer(fen, { db: 'masters' });
      if (!book) return null;
      const reply = weightedExplorerMove(book);
      if (!reply) return null;
      const m = parseUciMove(reply.uci);
      try {
        if (!chess.move({ from: m.from, to: m.to, promotion: m.promotion })) return null;
      } catch {
        return null;
      }
      line.push(reply.uci);
    }
  }
  return null;
}

export function OpeningsRoute() {
  const { user } = useAuth();
  const location = useLocation() as { state?: LocationState };
  const queryClient = useQueryClient();
  const gamesQuery = useGames();
  const games = gamesQuery.data;

  const [color, setColor] = useState<RepertoireColor>(location.state?.color ?? 'white');
  const [pendingStartEpd, setPendingStartEpd] = useState<string | null>(
    location.state?.startEpd ?? null,
  );
  // Bumped to re-roll the masters walk ("new line").
  const [walkNonce, setWalkNonce] = useState(0);

  const repertoireQuery = useQuery({
    queryKey: ['repertoire', user?.id, color],
    queryFn: () => supabaseService.getRepertoireMoves(color),
    enabled: !!user,
  });
  const repertoire = useMemo(() => {
    const m = new Map<string, RepertoireMove>();
    for (const r of repertoireQuery.data ?? []) m.set(r.epd, r);
    return m;
  }, [repertoireQuery.data]);

  const indexQuery = useQuery({
    queryKey: ['freqIndex', user?.id, games?.length, games?.[0]?.id],
    queryFn: () => getFrequencyIndex(games ?? []),
    enabled: !!games,
  });
  const stats = useMemo(
    () => indexQuery.data?.forColor(color) ?? new Map(),
    [indexQuery.data, color],
  );

  const queue = useMemo(() => {
    if (!repertoireQuery.data) return null;
    return buildGuidedQueue({ color, repertoire, stats });
  }, [color, repertoire, stats, repertoireQuery.data]);

  // Deep-linked start position takes priority when it's still uncovered.
  const gamesNode: DecisionNode | null = useMemo(() => {
    if (!queue) return null;
    let item: BuilderQueueItem | undefined;
    if (pendingStartEpd) item = queue.find((q) => q.epd === pendingStartEpd);
    item = item ?? queue[0];
    return item ? { ...item, source: 'games' } : null;
  }, [queue, pendingStartEpd]);

  const mastersWalkQuery = useQuery({
    queryKey: ['mastersWalk', user?.id, color, repertoire.size, walkNonce],
    queryFn: () => findMastersNode(color, repertoire),
    enabled: !!repertoireQuery.data && queue !== null && queue.length === 0,
    staleTime: Infinity,
  });

  const node: DecisionNode | null = gamesNode ?? mastersWalkQuery.data ?? null;

  const positionStats = node ? stats.get(node.epd) : undefined;

  const mastersQuery = useQuery({
    queryKey: ['explorer', 'masters', node?.epd],
    queryFn: () => fetchExplorer(node!.fen, { db: 'masters' }),
    enabled: !!node,
    staleTime: Infinity,
  });

  const engineQuery = useQuery({
    queryKey: ['builderEval', node?.epd],
    queryFn: async () => {
      const sf = await getStockfish();
      return sf.evaluatePositionFull(node!.fen, 18);
    },
    enabled: !!node,
    staleTime: Infinity,
  });

  const [saving, setSaving] = useState(false);
  const [lastPick, setLastPick] = useState<string | null>(null);

  useEffect(() => {
    setLastPick(null);
  }, [node?.epd]);

  const pick = async (uci: string, san: string | null) => {
    if (!node || saving) return;
    const resolvedSan = san ?? uciToSan(node.fen, uci);
    if (!resolvedSan) return;
    setSaving(true);
    try {
      await supabaseService.setRepertoireMove(color, node.epd, uci, resolvedSan);
      setLastPick(resolvedSan);
      if (pendingStartEpd === node.epd) setPendingStartEpd(null);
      await queryClient.invalidateQueries({ queryKey: ['repertoire'] });
    } catch (err) {
      console.warn('[openings] failed to save repertoire move', err);
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    if (pendingStartEpd) setPendingStartEpd(null);
    else if (gamesNode && queue && queue.length > 1) {
      // Rotate: drop the current node to the back by remembering it as covered
      // for this render is complex — simplest is to deep-link the next item.
      setPendingStartEpd(queue[1].epd);
    } else {
      setWalkNonce((n) => n + 1);
    }
  };

  const covered = repertoire.size;
  const sans = node ? lineToSans(node.line) : [];
  const orientation = color;

  if (gamesQuery.isLoading || repertoireQuery.isLoading || (games && indexQuery.isLoading)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">Openings</h1>
          <p className="text-text-secondary text-sm max-w-2xl">
            Build a repertoire out of the positions you actually reach. Pick your move at each
            branch — what you've played, the masters book, and the engine are all in front of
            you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['white', 'black'] as const).map((c) => (
            <button
              key={c}
              className={clsx(
                'px-3 py-1.5 rounded-none font-mono text-xs uppercase tracking-tight border-2 transition-colors',
                color === c
                  ? 'bg-accent/15 border-text-primary text-text-primary'
                  : 'border-text-primary/40 text-text-secondary hover:text-text-primary',
              )}
              onClick={() => {
                setColor(c);
                setPendingStartEpd(null);
              }}
            >
              As {c}
            </button>
          ))}
        </div>
      </header>

      {!node ? (
        <div className="card max-w-xl flex flex-col gap-2">
          {mastersWalkQuery.isLoading ? (
            <p className="text-text-secondary">Finding the next position…</p>
          ) : (
            <>
              <p className="text-text-secondary">
                Nothing to decide right now — your {color} repertoire covers every position we
                can walk to ({covered} position{covered === 1 ? '' : 's'}).
              </p>
              <button className="btn-primary self-start" onClick={() => setWalkNonce((n) => n + 1)}>
                Explore another line
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between rounded-none border-2 border-text-primary bg-surface-3 px-3 py-2">
              <span className="font-mono text-xs uppercase tracking-tight text-gold-dark">
                {sans.length > 0 ? formatLine(sans) : 'Start position'}
              </span>
              <span className="font-mono text-xs tabular-nums text-text-secondary">
                {node.source === 'games'
                  ? `seen ${node.total}× in your games`
                  : 'from master games'}
              </span>
            </div>
            <BoardPanel
              fen={node.fen}
              orientation={orientation}
              movableFor={saving ? null : color}
              lastMove={null}
              onMove={(m) => void pick(moveToUci(m), null)}
            />
            <p className="text-text-secondary text-xs">
              Play your repertoire move on the board, or pick one from the lists.
            </p>
          </div>

          <aside className="card flex flex-col gap-4 self-start max-h-[calc(100vh-3rem)] overflow-y-auto">
            <header className="flex items-center justify-between">
              <span className="label">Your move as {color}</span>
              <span className="font-mono text-xs tabular-nums text-gold-dark">
                {covered} covered
              </span>
            </header>

            {lastPick && <FeedbackBadge tone="success">Saved {lastPick}</FeedbackBadge>}
            {saving && <FeedbackBadge tone="info">Saving…</FeedbackBadge>}

            {positionStats && positionStats.userMoves.size > 0 && (
              <section>
                <p className="label mb-2">You played here</p>
                <ul className="flex flex-col gap-1">
                  {[...positionStats.userMoves.entries()]
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([uci, t]) => {
                      const san = uciToSan(node.fen, uci);
                      if (!san) return null;
                      const score = Math.round(((t.wins + t.draws / 2) / t.count) * 100);
                      return (
                        <li key={uci}>
                          <button
                            className="w-full flex items-center justify-between px-2 py-1.5 rounded-none border-2 border-text-primary/30 hover:border-text-primary hover:bg-accent/10 transition-colors text-left"
                            onClick={() => void pick(uci, san)}
                          >
                            <span className="font-mono font-bold">{san}</span>
                            <span className="font-mono text-xs text-text-secondary">
                              {t.count}× · scored {score}%
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}

            <section>
              <p className="label mb-2">Masters book</p>
              {mastersQuery.isLoading ? (
                <p className="text-text-secondary text-sm">Loading book…</p>
              ) : mastersQuery.data && mastersQuery.data.moves.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {mastersQuery.data.moves.slice(0, 6).map((m) => {
                    const total = m.white + m.draws + m.black;
                    const whitePct = total > 0 ? Math.round((m.white / total) * 100) : 0;
                    const drawPct = total > 0 ? Math.round((m.draws / total) * 100) : 0;
                    return (
                      <li key={m.uci}>
                        <button
                          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-none border-2 border-text-primary/30 hover:border-text-primary hover:bg-accent/10 transition-colors text-left"
                          onClick={() => void pick(m.uci, m.san)}
                        >
                          <span className="font-mono font-bold shrink-0">{m.san}</span>
                          <span className="flex-1 h-2 border border-text-primary/40 overflow-hidden flex">
                            <span className="bg-surface h-full" style={{ width: `${whitePct}%` }} />
                            <span
                              className="bg-text-primary/30 h-full"
                              style={{ width: `${drawPct}%` }}
                            />
                            <span className="bg-text-primary h-full flex-1" />
                          </span>
                          <span className="font-mono text-[10px] text-text-secondary shrink-0">
                            {total.toLocaleString()}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-text-secondary text-sm">Out of the masters book here.</p>
              )}
            </section>

            <section>
              <p className="label mb-2">Engine</p>
              {engineQuery.isLoading ? (
                <p className="text-text-secondary text-sm">Analyzing…</p>
              ) : engineQuery.data && engineQuery.data.bestMove ? (
                (() => {
                  const san = uciToSan(node.fen, engineQuery.data.bestMove);
                  if (!san) return <p className="text-text-secondary text-sm">—</p>;
                  const cp = engineQuery.data.scoreCp;
                  const evalLabel =
                    Math.abs(cp) >= 9000
                      ? cp > 0
                        ? 'mate'
                        : '-mate'
                      : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
                  return (
                    <button
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-none border-2 border-text-primary/30 hover:border-text-primary hover:bg-accent/10 transition-colors text-left"
                      onClick={() => void pick(engineQuery.data.bestMove, san)}
                    >
                      <span className="font-mono font-bold">{san}</span>
                      <span className="font-mono text-xs text-text-secondary">{evalLabel}</span>
                    </button>
                  );
                })()
              ) : (
                <p className="text-text-secondary text-sm">—</p>
              )}
            </section>

            <div className="mt-auto pt-2 flex items-center justify-between">
              <button
                className="font-mono text-xs uppercase tracking-tight text-text-secondary hover:text-text-primary"
                onClick={skip}
              >
                Skip this position
              </button>
              {queue && queue.length > 0 && (
                <span className="font-mono text-xs tabular-nums text-text-secondary">
                  {queue.length} to decide
                </span>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
