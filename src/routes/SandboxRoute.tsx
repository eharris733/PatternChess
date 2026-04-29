import { useState } from 'react';
import { Chess } from 'chess.js';
import { BoardPanel } from '../components/BoardPanel';

const START = new Chess().fen();

export function SandboxRoute() {
  const [fen, setFen] = useState(START);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  const onMove = ({ from, to, promotion }: { from: string; to: string; promotion?: string }) => {
    const chess = new Chess(fen);
    const m = chess.move({ from, to, promotion });
    if (!m) return;
    setFen(chess.fen());
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="heading-md">Board sandbox</h1>
        <BoardPanel
          fen={fen}
          orientation={orientation}
          movableFor="both"
          onMove={onMove}
        />
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => setFen(START)}>
            Reset
          </button>
          <button
            className="btn-outline"
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
          >
            Flip
          </button>
        </div>
      </div>
      <aside className="card">
        <span className="label">Current FEN</span>
        <pre data-testid="sandbox-fen" className="text-xs font-mono break-all whitespace-pre-wrap mt-2 text-text-secondary">
          {fen}
        </pre>
      </aside>
    </div>
  );
}
