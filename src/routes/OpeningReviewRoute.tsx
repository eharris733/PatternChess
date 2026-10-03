import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import clsx from 'clsx';
import { bookPlayersLabel } from '../chess/bookFormat';
import { WinningChancesDisplay } from '../components/WinningChancesDisplay';
import type { DrawShape } from 'chessground/draw';
import { useAuth } from '../auth/useAuth';
import { BoardPanel } from '../components/BoardPanel';
import { MoveSequencePanel, type MovePair } from '../components/MoveSequencePanel';
import { Skeleton } from '../components/Skeleton';
import { ChevronIcon } from '../components/icons/ChevronIcon';
import { BookExplorerPanel } from '../components/openings/BookExplorerPanel';
import { MasteryDots } from '../components/MasteryDots';
import { useDrillsOfKind } from '../hooks/useDrillsOfKind';
import { SR_BUCKET_LABEL, srBucket } from '../models/blunder';
import { TheoryMovesLine } from '../components/openings/TheoryMovesLine';
import { parseUciMove, toKey } from '../chess/moveUtils';
import { formatOpeningDisplay } from '../chess/openingNames';
import { DEVIATION_REASON_LABEL, MAX_THEORY_PLIES } from '../chess/openingDeviation';
import { MOVE_CLASSIFICATION_LABEL } from '../chess/winningChances';
import { useLineAutoplay } from '../hooks/useLineAutoplay';
import { authService } from '../services/authService';
import { fetchBook } from '../services/openingBookService';
import { parseGame } from '../services/pgnParserService';
import { supabaseService } from '../services/supabaseService';

/** Autoplay pace: an exit around move 10 replays in ~9 s. */
const REPLAY_STEP_MS = 450;

/** Reviews counted this page load, so revisits don't inflate the achievement. */
const countedReviews = new Set<string>();

function arrow(uci: string, brush: string): DrawShape {
  const m = parseUciMove(uci);
  return { orig: toKey(m.from), dest: toKey(m.to), brush };
}

function moveLabel(fen: string, san: string): string {
  const [, turn, , , , full] = fen.split(' ');
  return turn === 'b' ? `${full}...${san}` : `${full}.${san}`;
}

interface BranchMove {
  uci: string;
  san: string;
  fen: string;
  from: string;
  to: string;
}

/**
 * One opening exit, replayed: the game autoplays from the start to the move
 * where the user left theory, then stops there with the theory moves (green)
 * and the played move (red). The database panel follows whatever position is
 * on the board; clicking a book move explores it as a side branch.
 */
export function OpeningReviewRoute() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  // Keyed so moving to a sibling game starts from a clean index/branch
  // instead of painting one frame of the old game's ply on the new line.
  return <OpeningReview key={gameId} gameId={gameId} />;
}

function OpeningReview({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const drillsQuery = useDrillsOfKind('opening');
  const [params] = useSearchParams();
  const siblings = useMemo(() => (params.get('games') ?? '').split(',').filter(Boolean), [params]);
  const { profile, refreshProfile } = useAuth();

  const gameQuery = useQuery({
    queryKey: ['games', 'one', gameId],
    queryFn: () => supabaseService.getGame(gameId),
    enabled: !!gameId,
    staleTime: 5 * 60_000,
  });
  const devQuery = useQuery({
    queryKey: ['openings', 'deviation', gameId],
    queryFn: () => supabaseService.getDeviationForGame(gameId),
    enabled: !!gameId,
  });

  // The opening window only — the review is about where theory was left.
  const positions = useMemo(
    () => (gameQuery.data ? parseGame(gameQuery.data.pgn).slice(0, MAX_THEORY_PLIES + 1) : []),
    [gameQuery.data],
  );
  const dev = devQuery.data ?? null;
  const exitPly =
    dev?.status === 'user_left' && dev.ply != null && dev.ply < positions.length - 1 ? dev.ply : null;
  // Last ply the book still covered (BOOK tags run up to it).
  const bookEnd =
    dev == null ? null : dev.status === 'user_left' && dev.reason !== 'past_book' ? dev.ply : dev.bookEndPly;
  const target = Math.max(0, exitPly ?? Math.min(bookEnd ?? positions.length - 1, positions.length - 1));

  const [index, setIndex] = useState(0);
  const [branch, setBranch] = useState<string[]>([]);
  const [replayNonce, setReplayNonce] = useState(0);

  // One batched book lookup for the whole line before the replay starts, so
  // every step renders its database panel from cache (no per-step fetch).
  const linePrefetch = useQuery({
    queryKey: ['book', 'line', gameId, positions.length],
    queryFn: async () => {
      await fetchBook(positions.map((p) => p.fen));
      return true;
    },
    enabled: positions.length > 0,
    staleTime: Infinity,
  });

  const ready = positions.length > 0 && !devQuery.isPending && !linePrefetch.isPending;
  const segments = useMemo(
    () => [
      {
        length: target + 1,
        select: (i: number) => {
          setBranch([]);
          setIndex(i);
        },
      },
    ],
    [target],
  );
  const autoplay = useLineAutoplay({
    runKey: ready ? `${gameId}:${replayNonce}` : null,
    segments,
    stepMs: REPLAY_STEP_MS,
  });

  // Count the review once per game per page load (StrictMode-safe).
  const countedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || !gameId || !dev || countedRef.current === gameId || countedReviews.has(gameId)) return;
    countedRef.current = gameId;
    countedReviews.add(gameId);
    void authService
      .incrementOpeningReviews()
      .then(() => refreshProfile())
      .catch((err) => console.warn('[openings] count review failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, dev, profile?.id]);

  const baseFen = positions[index]?.fen ?? new Chess().fen();
  const branchLine = useMemo<BranchMove[]>(() => {
    const out: BranchMove[] = [];
    try {
      const c = new Chess(baseFen);
      for (const uci of branch) {
        const mv = c.move(parseUciMove(uci));
        out.push({ uci, san: mv.san, fen: c.fen(), from: mv.from, to: mv.to });
      }
    } catch {
      /* stale branch after a game switch — show what applied */
    }
    return out;
  }, [baseFen, branch]);

  const inBranch = branchLine.length > 0;
  const displayFen = inBranch ? branchLine[branchLine.length - 1].fen : baseFen;
  const lastMove = useMemo<[string, string] | null>(() => {
    if (inBranch) {
      const b = branchLine[branchLine.length - 1];
      return [b.from, b.to];
    }
    const uci = index > 0 ? positions[index - 1]?.uciMove : null;
    if (!uci) return null;
    const m = parseUciMove(uci);
    return [m.from, m.to];
  }, [inBranch, branchLine, index, positions]);
  const atExit = !inBranch && exitPly != null && index === exitPly;

  const shapes = useMemo<DrawShape[]>(() => {
    if (!atExit || !dev?.playedUci) return [];
    return [...dev.theoryMoves.slice(0, 3).map((t) => arrow(t.uci, 'green')), arrow(dev.playedUci, 'red')];
  }, [atExit, dev]);

  const lastIndex = positions.length - 1;
  const step = useCallback(
    (dir: 1 | -1) => {
      autoplay.stop();
      if (branch.length > 0) {
        if (dir === -1) setBranch((b) => b.slice(0, -1));
        return;
      }
      setIndex((i) => Math.min(Math.max(i + dir, 0), Math.max(lastIndex, 0)));
    },
    [autoplay, branch.length, lastIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const pairs = useMemo<MovePair[]>(() => {
    const out: MovePair[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
      const p = positions[i];
      if (!p.sanMove) continue;
      const tag = i === exitPly ? 'exit' : bookEnd != null && i < bookEnd ? 'book' : undefined;
      const cell = { san: p.sanMove, key: `p${i + 1}`, tag };
      const last = out[out.length - 1];
      if (p.sideToMove === 'white') out.push({ moveNumber: p.moveNumber, white: cell });
      else if (last && last.moveNumber === p.moveNumber) last.black = cell;
      else out.push({ moveNumber: p.moveNumber, black: cell });
    }
    return out;
  }, [positions, exitPly, bookEnd]);

  const game = gameQuery.data;
  const orientation = game?.userColor ?? dev?.userColor ?? 'white';
  const siblingIdx = siblings.indexOf(gameId);
  const siblingQuery = siblings.length > 1 ? `?games=${siblings.join(',')}` : '';

  if (gameQuery.isError || (gameQuery.isSuccess && positions.length === 0)) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <Link to="/openings" className="label hover:underline">
          Back to openings
        </Link>
        <div className="card">
          <p className="text-text-secondary text-sm">We couldn't load this game.</p>
        </div>
      </div>
    );
  }

  if (!game || !ready) {
    return (
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const opening = formatOpeningDisplay({
    name: dev?.openingName ?? game.openingName,
    eco: null,
  });

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4" data-testid="opening-review">
      <header className="flex flex-col gap-1">
        <Link to="/openings" className="label hover:underline self-start">
          Back to openings
        </Link>
        <h1 className="heading-lg">{opening ?? 'Opening review'}</h1>
        <p className="text-text-secondary text-sm">
          vs {game.opponent} · as {orientation === 'white' ? 'White' : 'Black'}
          {game.playedAt && ` · ${game.playedAt.toLocaleDateString()}`}
        </p>
        {siblings.length > 1 && (
          <nav className="flex flex-wrap items-center gap-2 mt-1" aria-label="Games with this exit">
            <span className="label">Same exit in</span>
            {siblings.map((id, i) => (
              <Link
                key={id}
                to={`/openings/review/${id}${siblingQuery}`}
                className={clsx('pill', i === siblingIdx && 'ring-2 ring-accent')}
                aria-current={i === siblingIdx ? 'page' : undefined}
              >
                Game {i + 1}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6">
        <div className="flex flex-col gap-3 min-w-0">
          <BoardPanel
            fen={displayFen}
            orientation={orientation}
            movableFor={null}
            viewOnly
            lastMove={lastMove}
            shapes={shapes}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-ghost h-9 w-10 flex items-center justify-center"
                onClick={() => step(-1)}
                aria-label="Previous move"
              >
                <ChevronIcon className="h-4 w-4 rotate-180" />
              </button>
              <button
                type="button"
                className="btn-ghost h-9 w-10 flex items-center justify-center"
                onClick={() => step(1)}
                disabled={inBranch || index >= lastIndex}
                aria-label="Next move"
              >
                <ChevronIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {autoplay.active ? (
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={autoplay.skip}
                  data-testid="skip-replay"
                >
                  Skip to the exit
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => setReplayNonce((n) => n + 1)}
                  data-testid="replay"
                >
                  Replay
                </button>
              )}
              {(inBranch || (exitPly != null && index !== exitPly && !autoplay.active)) && (
                <button
                  type="button"
                  className="btn-outline text-xs"
                  data-testid="back-to-exit"
                  onClick={() => {
                    autoplay.stop();
                    setBranch([]);
                    setIndex(target);
                  }}
                >
                  {inBranch ? 'Back to the game' : 'Go to the exit'}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="card flex flex-col gap-4 self-start">
          {dev && dev.status === 'user_left' && dev.playedSan && dev.fenBefore && dev.reason ? (
            <div className="flex flex-col gap-2" data-testid="exit-summary">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-lg font-semibold text-incorrect">
                  You played {moveLabel(dev.fenBefore, dev.playedSan)}
                </span>
                <span className="label text-text-primary">{DEVIATION_REASON_LABEL[dev.reason]}</span>
                {dev.classification && dev.classification !== 'good' && (
                  <span className="label text-incorrect">
                    {MOVE_CLASSIFICATION_LABEL[dev.classification]}
                  </span>
                )}
              </div>
              {dev.reason !== 'past_book' && dev.bookTier && dev.positionGames ? (
                <p className="text-text-primary text-sm" data-testid="played-share">
                  {Math.round(((dev.playedGames ?? 0) / dev.positionGames) * 100)}% of{' '}
                  {bookPlayersLabel(dev.bookTier)} played {dev.playedSan} here.
                </p>
              ) : null}
              {dev.evalBefore != null && dev.evalAfter != null && (
                <WinningChancesDisplay
                  evalBefore={dev.evalBefore}
                  evalAfter={dev.evalAfter}
                  mover={dev.userColor ?? orientation}
                  orientation={orientation}
                />
              )}
              {dev.chancesLost == null && (
                <p className="text-text-primary text-sm">The engine check is still pending.</p>
              )}
              {dev.theoryMoves.length > 0 && (
                <TheoryMovesLine
                  moves={dev.theoryMoves}
                  source={dev.reason === 'past_book' ? 'engine' : 'book'}
                />
              )}
              {(() => {
                const drill = dev.blunderId ? drillsQuery.data?.get(dev.blunderId) : undefined;
                if (!drill) return null;
                return (
                  <div className="flex flex-wrap items-center gap-3 pt-1" data-testid="review-drill">
                    <MasteryDots cycleNumber={drill.cycleNumber} size="sm" />
                    <span className="text-xs font-semibold text-text-primary">
                      {SR_BUCKET_LABEL[srBucket(drill)]}
                    </span>
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      onClick={() =>
                        navigate('/training', {
                          state: {
                            blunderIds: [drill.id],
                            focusLabel: `${opening ?? 'Opening'} · ${moveLabel(dev.fenBefore!, dev.playedSan!)}`,
                          },
                        })
                      }
                    >
                      Train this position
                    </button>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-text-primary text-sm">
              You didn't leave theory first in this game. Step through to see where the book ran out.
            </p>
          )}

          {inBranch && (
            <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="branch-trail">
              <span className="label mr-1">Exploring</span>
              <span className="text-text-secondary">your game</span>
              {branchLine.map((b, i) => (
                <span key={i} className="font-mono text-text-primary">
                  {' › '}
                  {moveLabel(i === 0 ? baseFen : branchLine[i - 1].fen, b.san)}
                </span>
              ))}
            </div>
          )}

          <BookExplorerPanel
            fen={displayFen}
            gameMoveUci={inBranch ? null : (positions[index]?.uciMove ?? null)}
            playedUci={atExit ? (dev?.playedUci ?? null) : null}
            theoryUcis={atExit ? (dev?.theoryMoves ?? []).map((t) => t.uci) : []}
            onPlay={(uci) => {
              autoplay.stop();
              setBranch((b) => [...b, uci]);
            }}
          />

          <div className="border-t-2 border-text-primary/20 pt-3">
            <p className="label mb-2">Your game, first {MAX_THEORY_PLIES / 2} moves</p>
            <MoveSequencePanel
              pairs={pairs}
              activeKey={inBranch ? null : `p${index}`}
              onSelect={(key) => {
                const i = Number.parseInt(key.slice(1), 10);
                if (Number.isNaN(i)) return;
                autoplay.stop();
                setBranch([]);
                setIndex(i);
              }}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
