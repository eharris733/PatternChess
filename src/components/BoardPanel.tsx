import { useMemo, useState } from 'react';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import { ChessgroundReact } from '../chess/chessgroundReact';
import { isCheck, legalDests, turnColor } from '../chess/legalDests';
import clsx from 'clsx';

export type Side = 'white' | 'black';

export interface BoardMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface BoardPanelProps {
  fen: string;
  orientation: Side;
  /** 'white' | 'black' | 'both' enables interaction; null disables. */
  movableFor: Side | 'both' | null;
  lastMove?: [string, string] | null;
  shapes?: DrawShape[];
  onMove?: (move: BoardMove) => void;
  /** Disable chessground entirely (view-only). */
  viewOnly?: boolean;
  /** Show rank/file coordinates (default true). */
  coordinates?: boolean;
  className?: string;
}

const PROMO_PIECES: Array<{ role: 'q' | 'r' | 'b' | 'n'; label: string }> = [
  { role: 'q', label: '♛' },
  { role: 'r', label: '♜' },
  { role: 'b', label: '♝' },
  { role: 'n', label: '♞' },
];

export function BoardPanel({
  fen,
  orientation,
  movableFor,
  lastMove,
  shapes,
  onMove,
  viewOnly,
  coordinates = true,
  className,
}: BoardPanelProps) {
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);

  const dests = useMemo(() => (viewOnly ? new Map<string, string[]>() : legalDests(fen)), [fen, viewOnly]);
  const turn = useMemo(() => turnColor(fen), [fen]);
  const inCheck = useMemo(() => isCheck(fen), [fen]);

  const config = useMemo<Config>(() => {
    const cgDests = new Map<any, any[]>();
    for (const [k, v] of dests) cgDests.set(k as any, v as any[]);
    return {
      fen,
      orientation,
      turnColor: turn,
      check: inCheck ? turn : false,
      lastMove: (lastMove ?? undefined) as any,
      coordinates,
      viewOnly: !!viewOnly,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: viewOnly || !movableFor ? undefined : movableFor === 'both' ? 'both' : movableFor,
        dests: cgDests,
        showDests: true,
        events: {
          after: (orig: string, dest: string) => {
            if (!onMove) return;
            const isPromotion = needsPromotion(fen, orig, dest);
            if (isPromotion) {
              setPendingPromo({ from: orig, to: dest });
              return;
            }
            onMove({ from: orig, to: dest });
          },
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        shapes: shapes ?? [],
      },
    };
  }, [fen, orientation, turn, inCheck, lastMove, movableFor, onMove, shapes, dests, viewOnly, coordinates]);

  return (
    <div className={clsx('relative aspect-square w-full max-w-[min(640px,calc(100vh-5rem))] mx-auto', className)}>
      <ChessgroundReact config={config} className="w-full h-full" />
      {pendingPromo && (
        <div className="absolute inset-0 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm z-10">
          <div className="bg-surface rounded-none border-2 border-text-primary p-3 shadow-card flex gap-2">
            {PROMO_PIECES.map((p) => (
              <button
                key={p.role}
                className="w-12 h-12 text-3xl rounded-none border-2 border-transparent hover:border-accent hover:bg-accent/15 text-text-primary transition-colors"
                onClick={() => {
                  if (!pendingPromo || !onMove) return;
                  onMove({ from: pendingPromo.from, to: pendingPromo.to, promotion: p.role });
                  setPendingPromo(null);
                }}
                aria-label={`Promote to ${p.role}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function needsPromotion(fen: string, from: string, to: string): boolean {
  // 7th-rank pawn moving to 8th, or 2nd-rank pawn moving to 1st
  const fromRank = from[1];
  const toRank = to[1];
  const fenBoard = fen.split(' ')[0];
  // Find piece at `from` square by walking ranks (FEN top is rank 8).
  const ranks = fenBoard.split('/');
  const fileIdx = from.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankIdx = 8 - Number.parseInt(fromRank, 10);
  const row = ranks[rankIdx] ?? '';
  let i = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) {
      i += Number.parseInt(ch, 10);
    } else {
      if (i === fileIdx) {
        if (ch.toLowerCase() === 'p') {
          return (
            (ch === 'P' && fromRank === '7' && toRank === '8') ||
            (ch === 'p' && fromRank === '2' && toRank === '1')
          );
        }
        return false;
      }
      i++;
    }
  }
  return false;
}
