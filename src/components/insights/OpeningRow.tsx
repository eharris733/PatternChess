import { formatOpeningDisplay, resolveOpeningFamilyName } from '../../chess/openingNames';
import type { OpeningInsightRow } from '../../hooks/useInsights';

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Most-played full ECO code (e.g. "B33") rather than the family wildcard ("B3*") rows are grouped by. */
export function openingDisplayName(row: Pick<OpeningInsightRow, 'ecoFamily' | 'dominantEco'>): string {
  return (
    formatOpeningDisplay({
      name: resolveOpeningFamilyName(row.ecoFamily).name,
      eco: row.dominantEco ?? row.ecoFamily,
    }) ?? row.ecoFamily
  );
}

export function OpeningRow({ row, onClick }: { row: OpeningInsightRow; onClick: () => void }) {
  const colorLabel = row.userColor === 'white' ? '♔' : row.userColor === 'black' ? '♚' : '·';
  const openingName = openingDisplayName(row);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex items-center justify-between py-2.5 gap-3 w-full text-left hover:bg-text-primary/5 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-text-primary text-sm font-semibold truncate">
            <span className="text-text-secondary mr-1">{colorLabel}</span>
            {openingName}
          </p>
          <p className="text-text-secondary text-xs tabular-nums">
            {row.wins}W / {row.losses}L / {row.draws}D · {Math.round(row.blunderRate * 10) / 10}{' '}
            blunders/game
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-text-primary text-sm tabular-nums"
            title="Win rate (wins + ½ draws) in this opening"
          >
            {formatPct(row.winRate)}
          </span>
        </div>
      </button>
    </li>
  );
}
