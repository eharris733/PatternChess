import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import { BoardPanel, type BoardMove } from '../components/BoardPanel';
import { BrandLockup } from '../components/BrandLogo';
import { FeedbackBadge } from '../components/FeedbackBadge';
import { WinningChancesDisplay } from '../components/WinningChancesDisplay';
import { decodeSharedPuzzle, type SharedPuzzle } from '../services/puzzleShareService';
import { getStockfish } from '../hooks/useStockfish';
import { moveToUci, parseUciMove, uciToSan } from '../chess/moveUtils';
import { classify, winPercent } from '../chess/winningChances';
import { useForceDefaultTheme } from '../state/themeStore';

type Phase = 'solving' | 'correct' | 'incorrect';

/**
 * Public, logged-out-friendly puzzle player. The entire puzzle travels in the
 * ?d= query param (see puzzleShareService) — no auth, no database reads.
 */
export function PuzzleRoute() {
  useForceDefaultTheme();
  const [params] = useSearchParams();
  const puzzle = useMemo(() => {
    const d = params.get('d');
    return d ? decodeSharedPuzzle(d) : null;
  }, [params]);

  if (!puzzle) {
    return (
      <PuzzlePage>
        <div className="card w-full max-w-md mx-auto flex flex-col gap-4 text-center">
          <h1 className="heading-md">This puzzle link is invalid</h1>
          <p className="text-text-secondary text-sm">
            The link may have been truncated when it was copied. Ask whoever shared it to copy
            the full link and try again.
          </p>
          <SignupCta />
        </div>
      </PuzzlePage>
    );
  }

  return (
    <PuzzlePage>
      <SharedPuzzlePlayer puzzle={puzzle} />
    </PuzzlePage>
  );
}

function PuzzlePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <header className="p-4 border-b-2 border-text-primary/20">
        <Link to="/" className="inline-flex">
          <BrandLockup size="sm" />
        </Link>
      </header>
      <main className="flex-1 p-4 md:p-6 w-full max-w-5xl mx-auto">{children}</main>
    </div>
  );
}

function SignupCta() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-text-secondary text-sm">
        PatternChess turns the blunders from your own games into training positions, then drills
        them with spaced repetition until you stop repeating them.
      </p>
      <Link to="/login" className="btn-primary text-center">
        Train your own blunders — free
      </Link>
    </div>
  );
}

function SharedPuzzlePlayer({ puzzle }: { puzzle: SharedPuzzle }) {
  const [phase, setPhase] = useState<Phase>('solving');
  const [fen, setFen] = useState(puzzle.fen);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [revealedBest, setRevealedBest] = useState(false);
  const [showedPlayed, setShowedPlayed] = useState(false);
  const [engineUnavailable, setEngineUnavailable] = useState(false);

  const sideLabel = puzzle.stm === 'white' ? 'White' : 'Black';
  const bestUci = puzzle.cm[0]?.m ?? null;
  const playedSan = useMemo(() => uciToSan(puzzle.fen, puzzle.pm) ?? puzzle.pm, [puzzle]);

  const onMove = async (move: BoardMove) => {
    if (phase !== 'solving' || evaluating) return;
    const uci = moveToUci(move);

    const chess = new Chess(puzzle.fen);
    let result;
    try {
      result = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    } catch {
      setFen(puzzle.fen);
      return;
    }
    if (!result) return;
    const newFen = chess.fen();
    setFen(newFen);
    setLastMove([move.from, move.to]);

    let isCorrect = puzzle.cm.some((c) => c.m === uci);

    // Same on-the-fly accept rule as the training screen: anything within 5%
    // win chance of the stored best move counts. Engine failure (e.g. missing
    // cross-origin isolation on an unusual host) degrades to stored-moves-only.
    if (!isCorrect && puzzle.cm.length > 0) {
      setEvaluating(true);
      try {
        const sf = await getStockfish();
        const ev = await sf.evaluatePositionFull(newFen, 18);
        const chancesLost = winPercent(puzzle.cm[0].e) - winPercent(-ev.scoreCp);
        if (Math.abs(chancesLost) <= 5) {
          isCorrect = true;
        } else if (uci !== puzzle.pm) {
          const cl = classify(chancesLost);
          setFeedback(
            cl === 'blunder'
              ? "That's a blunder"
              : cl === 'mistake'
                ? "That's a mistake"
                : cl === 'inaccuracy'
                  ? "That's an inaccuracy"
                  : 'Good move, but there is better',
          );
        }
      } catch {
        setEngineUnavailable(true);
      } finally {
        setEvaluating(false);
      }
    }

    if (isCorrect) {
      setPhase('correct');
      setFeedback(null);
      setShapes([{ orig: move.from as any, dest: move.to as any, brush: 'green' }]);
    } else {
      setPhase('incorrect');
      if (uci === puzzle.pm) setFeedback('This is the move that was played in the game');
      setShapes([]);
    }
  };

  const tryAgain = () => {
    setPhase('solving');
    setFen(puzzle.fen);
    setLastMove(null);
    setShapes([]);
    setFeedback(null);
  };

  // Arrow color language matches training: green = best move, red = the blunder.
  const revealBest = () => {
    if (!bestUci) return;
    const m = parseUciMove(bestUci);
    setRevealedBest(true);
    setFen(puzzle.fen);
    setLastMove(null);
    setShapes((cur) => [
      ...cur.filter((s) => s.brush !== 'green'),
      { orig: m.from as any, dest: m.to as any, brush: 'green' },
    ]);
  };

  const showPlayed = () => {
    const m = parseUciMove(puzzle.pm);
    setShowedPlayed(true);
    setFen(puzzle.fen);
    setLastMove(null);
    setShapes((cur) => [
      ...cur.filter((s) => s.brush !== 'red'),
      { orig: m.from as any, dest: m.to as any, brush: 'red' },
    ]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <BoardPanel
        fen={fen}
        orientation={puzzle.stm}
        movableFor={phase === 'solving' ? puzzle.stm : null}
        lastMove={lastMove}
        shapes={shapes}
        coordinates={false}
        onMove={(m) => void onMove(m)}
      />

      <aside className="card flex flex-col gap-4 self-start">
        <header className="flex flex-col gap-1">
          <span className="label">{puzzle.lbl ?? 'Shared puzzle'}</span>
          {puzzle.op && <span className="text-text-secondary text-xs">{puzzle.op}</span>}
        </header>

        <div className="flex items-center gap-2 text-text-primary">
          <span
            className={
              puzzle.stm === 'white'
                ? 'w-3 h-3 rounded-full border-2 border-text-primary bg-surface'
                : 'w-3 h-3 rounded-full border-2 border-text-primary bg-black'
            }
          />
          <span className="font-medium">{sideLabel} to play</span>
        </div>

        <p className="text-text-secondary text-sm">
          A move was played here that threw the game away. Can you find a better one?
        </p>

        {evaluating && <FeedbackBadge tone="info">Analyzing your move…</FeedbackBadge>}
        {phase === 'correct' && <FeedbackBadge tone="success">Solution correct</FeedbackBadge>}
        {phase === 'incorrect' && (
          <FeedbackBadge tone="danger">{feedback ?? 'Incorrect'}</FeedbackBadge>
        )}
        {engineUnavailable && (
          <p className="text-text-secondary text-xs">
            Couldn't verify with the engine on this device — only the stored best moves are
            accepted.
          </p>
        )}

        {phase !== 'solving' && (
          <WinningChancesDisplay evalBefore={puzzle.eb} evalAfter={puzzle.ea} />
        )}

        <div className="flex flex-col gap-2">
          {phase === 'incorrect' && (
            <button className="btn-primary" onClick={tryAgain}>
              Try again
            </button>
          )}
          {bestUci && (
            <button className="btn-outline" onClick={revealBest} disabled={revealedBest}>
              {revealedBest
                ? `Best move: ${uciToSan(puzzle.fen, bestUci) ?? bestUci}`
                : 'Reveal best move'}
            </button>
          )}
          <button className="btn-outline" onClick={showPlayed} disabled={showedPlayed}>
            {showedPlayed ? `Played in the game: ${playedSan}` : 'Show what they played'}
          </button>
        </div>

        <div className="border-t-2 border-text-primary/20 pt-4">
          <SignupCta />
        </div>
      </aside>
    </div>
  );
}
