import { useCallback, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import { LazyChessgroundReact } from '../../chess/LazyChessgroundReact';
import { isUciMove, moveToUci, uciToSan } from '../../chess/moveUtils';
import { legalDests } from '../../chess/legalDests';
import { winPercent } from '../../chess/winningChances';
import { mateInPhrase, moveCost } from '../../chess/formatEval';
import { getStockfish } from '../../hooks/useStockfish';
import type { BlunderCandidate } from '../../stockfish/stockfishWorkerClient';

interface Props {
  blunder: BlunderCandidate;
  moveLabel?: string;
}

/** Same on-the-fly accept bar as the training screen (CLAUDE.md: ≤5% chances lost). */
const ACCEPT_CHANCES_LOST = 5;

type Phase = 'solving' | 'checking' | 'correct' | 'wrong' | 'revealed';

/**
 * The landing demo's headline position, as a puzzle: the visitor gets to find
 * the move they missed before the answer is shown — the training loop, before
 * any account. A move other than the engine's best is checked with the
 * Stockfish instance the demo already booted.
 */
export function BlunderPreview({ blunder, moveLabel }: Props) {
  const orientation = blunder.sideToMove === 'black' ? 'black' : 'white';
  const [phase, setPhase] = useState<Phase>('solving');
  const [tried, setTried] = useState<{ uci: string; san: string; fen: string } | null>(null);
  const attemptRef = useRef(0);

  const playedSan = useMemo(
    () => uciToSan(blunder.fen, blunder.playedMove) ?? blunder.playedMove,
    [blunder.fen, blunder.playedMove],
  );
  const bestUci = blunder.correctMoves[0]?.move ?? '';
  const bestSan = useMemo(
    () => (bestUci ? uciToSan(blunder.fen, bestUci) ?? bestUci : '—'),
    [blunder.fen, bestUci],
  );

  const cost = moveCost(blunder.evalBefore, blunder.evalAfter);

  const onMove = useCallback(
    (orig: string, dest: string) => {
      const chess = new Chess(blunder.fen);
      let san: string;
      let uci: string;
      try {
        const m = chess.move({ from: orig, to: dest, promotion: 'q' });
        san = m.san;
        uci = moveToUci({ from: m.from, to: m.to, promotion: m.promotion });
      } catch {
        return;
      }
      const fen = chess.fen();
      setTried({ uci, san, fen });
      if (uci === bestUci || blunder.correctMoves.some((c) => c.move === uci)) {
        setPhase('correct');
        return;
      }
      const attempt = ++attemptRef.current;
      setPhase('checking');
      void (async () => {
        let ok = false;
        try {
          const sf = await getStockfish();
          const ev = await sf.evaluatePositionFull(fen, 14);
          const bestEval = blunder.correctMoves[0]?.eval ?? blunder.evalBefore;
          ok = winPercent(bestEval) - winPercent(-ev.scoreCp) <= ACCEPT_CHANCES_LOST;
        } catch {
          /* engine optional: an unchecked move counts as a miss */
        }
        if (attempt === attemptRef.current) setPhase(ok ? 'correct' : 'wrong');
      })();
    },
    [blunder.fen, blunder.correctMoves, blunder.evalBefore, bestUci],
  );

  const retry = () => {
    attemptRef.current += 1;
    setTried(null);
    setPhase('solving');
  };

  const config = useMemo(() => {
    const solving = phase === 'solving';
    const boardFen = tried && phase !== 'revealed' ? tried.fen : blunder.fen;
    const shownMove =
      tried && phase !== 'revealed'
        ? tried.uci
        : phase === 'revealed' && isUciMove(blunder.playedMove)
          ? blunder.playedMove
          : null;
    return {
      fen: boardFen,
      orientation: orientation as 'white' | 'black',
      turnColor: orientation as 'white' | 'black',
      viewOnly: false,
      coordinates: true,
      animation: { enabled: true, duration: 150 },
      movable: {
        free: false,
        color: solving ? (orientation as 'white' | 'black') : undefined,
        dests: solving ? (legalDests(blunder.fen) as Map<Key, Key[]>) : new Map(),
        showDests: true,
      },
      draggable: { enabled: solving },
      selectable: { enabled: solving },
      events: { move: onMove },
      drawable: {
        autoShapes:
          phase === 'revealed' && isUciMove(bestUci)
            ? [
                {
                  orig: bestUci.slice(0, 2) as Key,
                  dest: bestUci.slice(2, 4) as Key,
                  brush: 'green',
                },
              ]
            : [],
      },
      highlight: { lastMove: true, check: true },
      lastMove: shownMove ? [shownMove.slice(0, 2) as Key, shownMove.slice(2, 4) as Key] : undefined,
    };
  }, [blunder.fen, blunder.playedMove, bestUci, orientation, phase, tried, onMove]);

  return (
    <div className="border-2 border-text-primary bg-surface">
      <div className="grid md:grid-cols-[280px_1fr]">
        <div className="border-b-2 md:border-b-0 md:border-r-2 border-text-primary p-4 bg-bg">
          <div className="aspect-square w-full">
            <LazyChessgroundReact config={config} />
          </div>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {moveLabel && (
            <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              {moveLabel}
            </div>
          )}
          {phase === 'solving' || phase === 'checking' || phase === 'wrong' ? (
            <div className="flex flex-col gap-3" data-testid="demo-puzzle">
              <div className="font-mono uppercase text-base sm:text-lg leading-relaxed text-text-primary">
                You played <span className="font-bold">{playedSan}</span> here.
                <br />
                {phase === 'wrong' && tried ? (
                  <>
                    <span className="font-bold">{tried.san}</span> isn&rsquo;t it either.
                  </>
                ) : (
                  <span className="text-gold-dark">Find the better move.</span>
                )}
              </div>
              {phase === 'checking' && (
                <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary" role="status">
                  Checking your move…
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {phase === 'wrong' && (
                  <button type="button" className="btn-primary" onClick={retry}>
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline"
                  disabled={phase === 'checking'}
                  onClick={() => setPhase('revealed')}
                >
                  Show me
                </button>
              </div>
            </div>
          ) : (
            <>
              {phase === 'correct' && tried && (
                <div className="font-mono uppercase text-base sm:text-lg leading-relaxed text-correct" role="status">
                  {tried.uci === bestUci
                    ? `Found it. ${tried.san} is right.`
                    : `${tried.san} works too. The engine's top choice was ${bestSan}.`}
                </div>
              )}
              <div className="font-mono uppercase text-base sm:text-lg leading-relaxed text-text-primary">
                You played{' '}
                <span className="font-bold">{playedSan}</span>.
                <br />
                {cost.kind === 'allowsMate' ? (
                  <>
                    That allows{' '}
                    <span className="text-gold-dark font-bold">{mateInPhrase(cost.moves)}</span>.{' '}
                    <span className="text-gold-dark">{bestSan}</span> was safe.
                  </>
                ) : cost.kind === 'missedMate' ? (
                  <>
                    <span className="text-gold-dark">{bestSan}</span> was{' '}
                    <span className="text-gold-dark font-bold">{mateInPhrase(cost.moves)}</span>.
                  </>
                ) : (
                  <>
                    <span className="text-gold-dark">{bestSan}</span> was{' '}
                    <span className="text-gold-dark font-bold">{Math.round(Math.abs(cost.cp))}cp</span>{' '}
                    stronger.
                  </>
                )}
              </div>
            </>
          )}
          <div className="mt-auto pt-4 border-t-2 border-text-primary/10">
            <div className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              This is one position. We find every blunder like it.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
