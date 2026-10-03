import type { Blunder } from '../../models/blunder';
import { TheoryMovesLine } from '../openings/TheoryMovesLine';

/**
 * Post-attempt note for kind='opening' drills: what strong players (or, past
 * the book, the engine) play here. Render only after the first move — before
 * it, the kind must stay concealed.
 */
export function OpeningTheoryNote({ blunder }: { blunder: Blunder }) {
  const data = blunder.kind === 'opening' && blunder.drillData && 'theoryMoves' in blunder.drillData
    ? blunder.drillData
    : null;
  if (!data || data.theoryMoves.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="opening-theory-note">
      <span className="label">
        {data.source === 'engine' ? 'After theory' : 'Opening theory'}
        {data.openingFamily ? ` · ${data.openingFamily}` : ''}
      </span>
      <TheoryMovesLine moves={data.theoryMoves} source={data.source} />
      {data.source === 'book' && data.positionGames > 0 && (
        <p className="text-text-secondary text-xs">
          From {data.positionGames.toLocaleString()} games in this position.
        </p>
      )}
    </div>
  );
}
