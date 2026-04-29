import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { useStockfish, getStockfish } from '../hooks/useStockfish';
import { EvalDisplay } from '../components/EvalDisplay';

export function EngineTestRoute() {
  const { ready, error, mode } = useStockfish();
  const [score, setScore] = useState<number | null>(null);
  const [bestMove, setBestMove] = useState<string>('');
  const [evaluating, setEvaluating] = useState(false);
  const [isolated, setIsolated] = useState<boolean | null>(null);

  useEffect(() => {
    setIsolated(typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null);
  }, []);

  const run = async () => {
    setEvaluating(true);
    try {
      const sf = await getStockfish();
      const result = await sf.evaluatePositionFull(new Chess().fen(), 12);
      setScore(result.scoreCp);
      setBestMove(result.bestMove);
    } finally {
      setEvaluating(false);
    }
  };

  useEffect(() => {
    if (ready) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div className="max-w-md mx-auto card flex flex-col gap-3">
      <h1 className="heading-md">Engine test</h1>
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">Engine</span>
        <span className="font-mono" data-testid="engine-mode">
          {mode ?? '…'}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">crossOriginIsolated</span>
        <span className="font-mono" data-testid="isolated">
          {isolated === null ? '…' : String(isolated)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">Status</span>
        <span className="font-mono" data-testid="engine-status">
          {error ? `error: ${error}` : ready ? 'ready' : 'loading'}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">Startpos eval</span>
        <span data-testid="engine-eval">
          {score === null ? (evaluating ? 'evaluating…' : '—') : <EvalDisplay cp={score} />}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">Best move</span>
        <span className="font-mono" data-testid="engine-bestmove">
          {bestMove || '—'}
        </span>
      </div>
      <button className="btn-outline mt-2" onClick={run} disabled={!ready || evaluating}>
        Re-evaluate
      </button>
    </div>
  );
}
