import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DrawShape } from 'chessground/draw';
import { BoardPanel } from '../BoardPanel';
import { MasteryDots } from '../MasteryDots';
import { isUciMove, parseUciMove, toKey } from '../../chess/moveUtils';
import { DEVIATION_REASON_LABEL, type DeviationLeak } from '../../chess/openingDeviation';
import { SR_BUCKET_LABEL, srBucket, type Blunder } from '../../models/blunder';
import type { RepertoireMove } from '../../models/repertoire';
import { TheoryMovesLine } from './TheoryMovesLine';
import { useAuth } from '../../auth/useAuth';
import { recordOpeningReview } from '../../lib/openingReviews';

/** Arrow for a UCI move; none for a malformed one (it would draw at NaN). */
function arrow(uci: string, brush: string): DrawShape[] {
  if (!isUciMove(uci)) return [];
  const m = parseUciMove(uci);
  return [{ orig: toKey(m.from), dest: toKey(m.to), brush }];
}

export function moveLabel(fen: string, moveNumber: number, san: string): string {
  return fen.split(' ')[1] === 'b' ? `${moveNumber}...${san}` : `${moveNumber}.${san}`;
}

/**
 * One recurring exit: the position with your move (red) and the theory
 * moves (green), how often it happened, where it sits on the mastery chain,
 * and training it.
 */
export function DeviationCard({
  leak,
  color,
  openingLabel,
  drill,
  repertoireMove,
}: {
  leak: DeviationLeak;
  color: 'white' | 'black';
  openingLabel: string;
  /** The opening drill for this position, when one exists. */
  drill: Blunder | null;
  /** The user's saved move here, when it isn't the move they played. */
  repertoireMove: RepertoireMove | null;
}) {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const shapes = useMemo(
    () => [...leak.theoryMoves.slice(0, 3).flatMap((t) => arrow(t.uci, 'green')), ...arrow(leak.playedUci, 'red')],
    [leak],
  );
  const label = moveLabel(leak.fenBefore, leak.moveNumber, leak.playedSan);
  const train = drill
    ? () => {
        recordOpeningReview(() => void refreshProfile());
        navigate('/training', {
          state: { blunderIds: [drill.id], focusLabel: `${openingLabel} · ${label}` },
        });
      }
    : null;
  const board = (
    <BoardPanel
      fen={leak.fenBefore}
      orientation={color}
      movableFor={null}
      shapes={shapes}
      viewOnly
      coordinates={false}
      sounds={false}
    />
  );

  return (
    <li data-testid="deviation-card" className="flex flex-col sm:flex-row gap-4 border-2 border-text-primary/20 p-3">
      {train ? (
        <button type="button" onClick={train} className="w-full sm:w-40 shrink-0 block" aria-label={`Train ${label}`}>
          {board}
        </button>
      ) : (
        <div className="w-full sm:w-40 shrink-0">{board}</div>
      )}
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-lg font-semibold text-incorrect">You played {label}</span>
          <span className="text-text-primary text-sm font-semibold" data-testid="deviation-count">
            {leak.count === 1 ? 'once' : `in ${leak.count} games`}
          </span>
        </div>
        <span className="label text-text-primary" data-testid="deviation-reason">
          {DEVIATION_REASON_LABEL[leak.reason]}
        </span>
        {leak.theoryMoves.length > 0 ? (
          <TheoryMovesLine moves={leak.theoryMoves} source={leak.reason === 'past_book' ? 'engine' : 'book'} />
        ) : (
          <p className="text-text-primary text-sm">Strong players have no clear main move here.</p>
        )}
        {repertoireMove && (
          <p className="text-text-primary text-sm" data-testid="repertoire-note">
            <span className="font-semibold">Your repertoire: </span>
            <span className="font-mono font-semibold">{repertoireMove.san}</span>
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
          {drill ? (
            <>
              <span className="inline-flex items-center gap-2">
                <MasteryDots cycleNumber={drill.cycleNumber} size="sm" />
                <span className="text-xs font-semibold text-text-primary">{SR_BUCKET_LABEL[srBucket(drill)]}</span>
              </span>
              <button
                type="button"
                className="btn-primary text-sm"
                data-testid="train-position"
                onClick={train ?? undefined}
              >
                Train
              </button>
            </>
          ) : leak.avgChancesLost == null ? (
            <span className="text-xs text-text-primary">Engine check pending</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
