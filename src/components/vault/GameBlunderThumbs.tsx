import { useQuery } from '@tanstack/react-query';
import { supabaseService } from '../../services/supabaseService';
import { uciToSan } from '../../chess/moveUtils';
import type { GameRecord } from '../../models/gameRecord';
import type { Blunder } from '../../models/blunder';
import { MiniBoard } from '../MiniBoard';
import { blunderOrientation } from './vaultHelpers';

export function GameBlunderThumbs({
  game,
  onPreview,
}: {
  game: GameRecord;
  onPreview: (b: Blunder) => void;
}) {
  const { data: blunders, isLoading } = useQuery({
    queryKey: ['gameBlunders', game.id],
    queryFn: () => supabaseService.getBlundersForGames([game.id]),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-5 py-4 border-t-2 border-text-primary/10 text-xs text-text-secondary">
        Loading positions…
      </div>
    );
  }
  if (!blunders || blunders.length === 0) {
    return (
      <div className="px-5 py-4 border-t-2 border-text-primary/10 text-xs text-text-secondary">
        No stored positions for this game.
      </div>
    );
  }
  return (
    <div className="px-5 py-4 border-t-2 border-text-primary/10 bg-surface-3/30">
      <div className="flex flex-wrap gap-4">
        {blunders.map((b) => {
          const played = uciToSan(b.fen, b.playedMove) ?? b.playedMove;
          return (
            <button
              key={b.id}
              type="button"
              className="group flex flex-col items-start gap-1.5 text-left"
              onClick={() => onPreview(b)}
              title="Expand position"
            >
              <MiniBoard
                fen={b.fen}
                orientation={blunderOrientation(game, b)}
                className="w-28 transition-transform group-hover:-translate-y-0.5"
              />
              <span className="font-mono text-[10px] uppercase tracking-tight text-text-secondary">
                Move {b.moveNumber} ·{' '}
                {/* SAN is case-sensitive (Nxd5 ≠ NXD5) — undo the label uppercasing */}
                <span className="text-mistake normal-case">{played}?</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
