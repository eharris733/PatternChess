import clsx from 'clsx';
import type { Blunder } from '../../models/blunder';
import { repertoireMoveFor } from '../../models/repertoire';
import { CASTLING_NORMALIZE } from '../../chess/moveUtils';
import { useAddToRepertoire, useRepertoire } from '../../hooks/useRepertoire';
import type { OpeningVerdict } from '../../state/trainingStore';
import { CheckIcon } from '../icons/CheckIcon';
import { TheoryMovesLine } from '../openings/TheoryMovesLine';

function headline(v: OpeningVerdict): string {
  switch (v.kind) {
    case 'repertoire':
      return `Great! ${v.san} is your repertoire move.`;
    case 'book':
      return `Great! ${v.san} is book.`;
    case 'best':
      return `Great! ${v.san} is the engine's top move.`;
    case 'sound':
      return `Good move. ${v.san} holds up.`;
  }
}

function sameUci(a: string, b: string): boolean {
  return (CASTLING_NORMALIZE[a] ?? a) === (CASTLING_NORMALIZE[b] ?? b);
}

/** One-line verdict + "Add to repertoire" after a correct opening answer. */
export function OpeningVerdictPanel({ blunder, verdict }: { blunder: Blunder; verdict: OpeningVerdict }) {
  const color: 'white' | 'black' = blunder.sideToMove === 'white' ? 'white' : 'black';
  const repertoire = useRepertoire();
  const add = useAddToRepertoire();
  const saved = repertoireMoveFor(repertoire.data, color, verdict.fen);
  const isSaved = !!saved && sameUci(saved.uci, verdict.uci);
  const data = blunder.drillData && 'theoryMoves' in blunder.drillData ? blunder.drillData : null;

  return (
    <div className="flex flex-col gap-3" data-testid="opening-verdict">
      <p
        className={clsx(
          'text-base font-semibold',
          verdict.kind === 'sound' ? 'text-text-primary' : 'text-correct',
        )}
      >
        {headline(verdict)}
      </p>
      {/* Who plays it: the chart (book moves) — the headline stays short. */}
      {data && data.theoryMoves.length > 0 ? (
        <TheoryMovesLine moves={data.theoryMoves} source={data.source} highlightUci={verdict.uci} />
      ) : (
        verdict.theorySan &&
        verdict.kind !== 'repertoire' && (
          <p className="text-text-primary text-sm">
            The main line is <span className="font-mono font-semibold">{verdict.theorySan}</span>.
          </p>
        )
      )}

      {isSaved ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-correct" data-testid="in-repertoire">
          <CheckIcon className="h-4 w-4" />
          In your repertoire
        </p>
      ) : (
        <button
          type="button"
          className="btn-outline self-start"
          data-testid="add-to-repertoire"
          disabled={add.isPending || repertoire.isPending}
          onClick={() => add.mutate({ color, fen: verdict.fen, uci: verdict.uci, san: verdict.san })}
        >
          {saved ? `Make ${verdict.san} my move (instead of ${saved.san})` : 'Add to repertoire'}
        </button>
      )}
      {add.isError && <p className="text-incorrect text-sm">Couldn't save that. Try again.</p>}
    </div>
  );
}
