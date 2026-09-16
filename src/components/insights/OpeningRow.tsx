import { formatOpeningDisplay } from '../../chess/openingNames';
import { KingIcon } from '../icons/KingIcon';
import type { OpeningInsightRow } from '../../hooks/useInsights';

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** The classified family plus the most-played ECO code within it (e.g. "Sicilian Defense · B90"). */
export function openingDisplayName(
  row: Pick<OpeningInsightRow, 'family' | 'dominantEco'>,
): string {
  return formatOpeningDisplay({ name: row.family, eco: row.dominantEco }) ?? row.family;
}

export function OpeningRow({ row, onClick }: { row: OpeningInsightRow; onClick: () => void }) {
  const openingName = openingDisplayName(row);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex items-center justify-between py-2.5 gap-3 w-full text-left hover:bg-text-primary/5 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-text-primary text-sm font-semibold truncate flex items-center gap-2">
            {row.userColor ? (
              <KingIcon
                color={row.userColor}
                title={`Played as ${row.userColor === 'white' ? 'White' : 'Black'}`}
                className="h-5 w-5 shrink-0"
              />
            ) : (
              <span className="text-text-secondary shrink-0" aria-hidden>
                ·
              </span>
            )}
            <span className="truncate">{openingName}</span>
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
