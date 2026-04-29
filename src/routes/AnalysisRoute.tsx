import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { extractHeaders, parseGame } from '../services/pgnParserService';
import { getStockfish } from '../hooks/useStockfish';
import { supabaseService } from '../services/supabaseService';
import { ProgressBar } from '../components/ProgressBar';
import { useAuth } from '../auth/useAuth';
import type { GameRecord } from '../models/gameRecord';

interface LocationState {
  gameIds?: string[];
}

interface GameSummary {
  id: string;
  opponent: string;
  blunderCount: number;
}

export function AnalysisRoute() {
  const location = useLocation() as { state?: LocationState };
  const navigate = useNavigate();
  const { profile } = useAuth();
  const startedRef = useRef(false);

  const gameIds = location.state?.gameIds ?? [];

  const [phase, setPhase] = useState<'idle' | 'loading' | 'analyzing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [gameIndex, setGameIndex] = useState(0);
  const [posIndex, setPosIndex] = useState(0);
  const [posTotal, setPosTotal] = useState(0);
  const [summaries, setSummaries] = useState<GameSummary[]>([]);
  const [currentGame, setCurrentGame] = useState<GameRecord | null>(null);

  useEffect(() => {
    if (gameIds.length === 0) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      setPhase('loading');
      try {
        const sf = await getStockfish();
        setPhase('analyzing');
        for (let i = 0; i < gameIds.length; i++) {
          setGameIndex(i);
          const game = await supabaseService.getGame(gameIds[i]);
          setCurrentGame(game);
          const positions = parseGame(game.pgn);
          setPosTotal(positions.length);
          const headers = extractHeaders(game.pgn);
          const username =
            game.username || profile?.lichessUsername || profile?.chesscomUsername || '';
          const playerSide: 'white' | 'black' | null =
            headers.White?.toLowerCase() === username.toLowerCase()
              ? 'white'
              : headers.Black?.toLowerCase() === username.toLowerCase()
                ? 'black'
                : null;

          const blunders = await sf.analyzeGame(positions, {
            depth: 12,
            playerSide,
            onProgress: (cur) => setPosIndex(cur),
          });

          if (blunders.length > 0) {
            await supabaseService.insertBlunders(
              blunders.map((b) => ({
                game_id: game.id,
                fen: b.fen,
                move_number: b.moveNumber,
                played_move: b.playedMove,
                correct_moves: b.correctMoves,
                eval_before: b.evalBefore,
                eval_after: b.evalAfter,
                eval_swing: b.evalSwing,
                side_to_move: b.sideToMove,
              })),
            );
          }
          await supabaseService.markGameAnalyzed(game.id);

          setSummaries((prev) => [
            ...prev,
            { id: game.id, opponent: game.opponent, blunderCount: blunders.length },
          ]);
        }
        setPhase('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Analysis failed');
        setPhase('error');
      }
    };
    void run();
  }, [gameIds, profile]);

  if (gameIds.length === 0) {
    return (
      <div className="max-w-xl mx-auto card text-center flex flex-col gap-4">
        <h1 className="heading-lg">No games to analyze</h1>
        <p className="text-text-secondary text-sm">Import some games first.</p>
        <button className="btn-primary" onClick={() => navigate('/import')}>
          Import games
        </button>
      </div>
    );
  }

  const totalBlunders = summaries.reduce((s, g) => s + g.blunderCount, 0);

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="heading-xl">Analyzing games</h1>
        <p className="text-text-secondary text-sm mt-1">
          Stockfish is finding blunders worth drilling. Stay on this page.
        </p>
      </header>

      <section className="card flex flex-col gap-4">
        <ProgressBar current={gameIndex + (phase === 'done' ? 1 : 0)} total={gameIds.length} label="Games" />
        <ProgressBar current={posIndex} total={posTotal} label="Positions" />
        {currentGame && phase !== 'done' && (
          <p className="text-sm text-text-secondary">
            Currently: <span className="text-text-primary font-medium">{currentGame.username}</span>{' '}
            vs <span className="text-text-primary font-medium">{currentGame.opponent}</span>
          </p>
        )}
        {error && <p className="text-incorrect text-sm">{error}</p>}
      </section>

      {phase === 'done' && (
        <section className="card flex flex-col gap-4">
          <div>
            <h2 className="heading-md">Done — {totalBlunders} blunder{totalBlunders === 1 ? '' : 's'} found</h2>
            <p className="text-text-secondary text-sm mt-1">Across {gameIds.length} games.</p>
          </div>
          <ul className="divide-y divide-surface-2">
            {summaries.map((s) => (
              <li key={s.id} className="py-2 flex justify-between text-sm">
                <span className="text-text-primary">vs {s.opponent}</span>
                <span className="font-mono text-text-secondary">
                  {s.blunderCount} blunder{s.blunderCount === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-3 mt-2">
            <button
              className="btn-primary"
              disabled={totalBlunders === 0}
              onClick={() => navigate('/training', { state: { gameIds } })}
            >
              Start training
            </button>
            <button className="btn-outline" onClick={() => navigate('/import')}>
              Import more
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
