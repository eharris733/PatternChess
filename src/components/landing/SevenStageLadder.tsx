import { useMemo } from 'react';
import type { Key } from 'chessground/types';
import { ChessgroundReact } from '../../chess/chessgroundReact';
import { RANKS } from '../../lib/ranks';
import { SPACED_REPETITION_DAYS } from '../../models/blunder';

// Fried Liver Attack teaching position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5
// d5 5.exd5. Black to move — Nxd5 looks natural but walks into 6.Nxf7!; Na5
// sidesteps the trap. Same FEN across all three stages — what changes is what
// the trainee sees, not the board.
const FEN = 'r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5';
const BLUNDER: [Key, Key] = ['f6', 'd5'];
const CORRECT: [Key, Key] = ['c6', 'a5'];

type Stage = {
  rep: number;
  day: number;
  rank: string;
  headline: string;
  body: string;
  shapes: 'blunder' | 'both' | 'correct';
  highlight: boolean;
};

const STAGES: Stage[] = [
  {
    rep: 1,
    day: 1,
    rank: RANKS[0].name, // Apprentice
    headline: 'You blunder',
    body: "First encounter. Stockfish shows the move you missed — it stings, you log it, you move on.",
    shapes: 'blunder',
    highlight: false,
  },
  {
    rep: 4,
    day: 7,
    rank: RANKS[3].name, // Bishop
    headline: "You're seeing it",
    body: 'A week of reviews in. The shape is familiar; the right move starts to surface before you finish reading the position.',
    shapes: 'both',
    highlight: false,
  },
  {
    rep: 7,
    day: 56,
    rank: RANKS[6].name, // Master
    headline: 'Locked in',
    body: 'Eight weeks later, the pattern is automatic — and you spot it across the board, in your own games, without thinking.',
    shapes: 'correct',
    highlight: true,
  },
];

function MiniBoard({ shapes }: { shapes: Stage['shapes'] }) {
  const config = useMemo(() => {
    const autoShapes: { orig: Key; dest: Key; brush: string }[] = [];
    if (shapes === 'blunder' || shapes === 'both') {
      autoShapes.push({ orig: BLUNDER[0], dest: BLUNDER[1], brush: 'red' });
    }
    if (shapes === 'correct' || shapes === 'both') {
      autoShapes.push({ orig: CORRECT[0], dest: CORRECT[1], brush: 'green' });
    }
    return {
      fen: FEN,
      orientation: 'black' as const,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false, duration: 0 },
      drawable: { autoShapes },
      highlight: { lastMove: false, check: false },
    };
  }, [shapes]);

  return (
    <div className="aspect-square w-full">
      <ChessgroundReact config={config} />
    </div>
  );
}

export function SevenStageLadder() {
  return (
    <div className="mt-12 border-2 border-text-primary bg-surface shadow-card">
      <div className="border-b-2 border-text-primary bg-bg px-6 py-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div className="font-mono uppercase tracking-tight text-sm text-text-primary">
          The seven-stage ladder
        </div>
        <div className="font-mono uppercase text-[10px] tracking-tight text-text-primary/60">
          One pattern · same position · drilled until it's yours
        </div>
      </div>

      <div className="grid md:grid-cols-3 divide-y-2 md:divide-y-0 md:divide-x-2 divide-text-primary">
        {STAGES.map((stage) => (
          <div
            key={stage.rep}
            className={
              'p-6 flex flex-col gap-4 ' +
              (stage.highlight ? 'bg-gold-dark/10' : 'bg-surface')
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono uppercase text-[10px] tracking-tight text-text-primary/60 whitespace-nowrap">
                Rep {stage.rep} · Day {stage.day}
              </span>
              <span
                className={
                  'font-mono uppercase text-[11px] tracking-tight font-bold ' +
                  (stage.highlight ? 'text-gold-dark' : 'text-text-primary')
                }
              >
                {stage.rank}
              </span>
            </div>

            <div className="border-2 border-text-primary p-2 bg-bg">
              <MiniBoard shapes={stage.shapes} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="font-mono uppercase text-sm text-text-primary">
                {stage.headline}
              </div>
              <p className="text-xs sm:text-sm text-text-primary/80 leading-relaxed">
                {stage.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t-2 border-text-primary px-6 py-6 bg-bg">
        <div className="font-mono uppercase text-[10px] tracking-tight text-text-primary/60 mb-4">
          Every blunder climbs the same ladder — Apprentice to Master.
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-3">
          {RANKS.map((rank, i) => {
            const day = SPACED_REPETITION_DAYS[i];
            const featured = i === 0 || i === 3 || i === 6;
            return (
              <div key={rank.name} className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="flex items-center w-full">
                  <div
                    className={
                      'flex-1 h-0.5 ' + (i === 0 ? 'invisible' : 'bg-text-primary/40')
                    }
                  />
                  <div
                    className={
                      'w-3 h-3 border-2 border-text-primary flex-shrink-0 ' +
                      (featured ? 'bg-gold-dark' : 'bg-surface')
                    }
                  />
                  <div
                    className={
                      'flex-1 h-0.5 ' +
                      (i === RANKS.length - 1 ? 'invisible' : 'bg-text-primary/40')
                    }
                  />
                </div>
                <div
                  className={
                    'text-[9px] sm:text-[11px] font-mono uppercase tracking-tight truncate w-full text-center ' +
                    (featured ? 'text-text-primary font-bold' : 'text-text-primary/70')
                  }
                >
                  {rank.name}
                </div>
                <div className="text-[9px] sm:text-[10px] font-mono text-gold-dark">
                  Day {day}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 font-mono uppercase text-[10px] tracking-tight text-text-primary/60 text-right">
          Each drill survived advances you one rung.
        </div>
      </div>
    </div>
  );
}
