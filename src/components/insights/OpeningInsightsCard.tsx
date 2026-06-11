import { useNavigate } from 'react-router-dom';
import {
  MIN_TOTAL_GAMES_FOR_OPENING,
  useOpeningInsight,
} from '../../hooks/useInsights';
import { formatOpeningDisplay, resolveOpeningFamilyName } from '../../chess/openingNames';
import { InsightCardSkeleton } from '../Skeleton';

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function OpeningInsightsCard() {
  const navigate = useNavigate();
  const insight = useOpeningInsight();
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const { rows, totalGames } = insight.data;
  if (totalGames < MIN_TOTAL_GAMES_FOR_OPENING) return null;
  if (rows.length === 0) return null;

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Top openings</span>
        <span className="text-text-secondary text-xs uppercase tracking-tight">
          win rate
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-text-primary/15">
        {rows.map((row) => {
          const colorLabel = row.userColor === 'white' ? '♔' : row.userColor === 'black' ? '♚' : '·';
          // Show the most-played full ECO code (e.g. "B33") rather than the
          // family wildcard ("B3*") the rows are grouped by.
          const openingName = formatOpeningDisplay({
            name: resolveOpeningFamilyName(row.ecoFamily).name,
            eco: row.dominantEco ?? row.ecoFamily,
          });
          return (
            <li key={`${row.ecoFamily}-${row.userColor ?? 'unknown'}`}>
              <button
                type="button"
                onClick={() =>
                  navigate('/training', {
                    state: {
                      openingFilter: row.ecoFamily,
                      openingColor: row.userColor,
                      openingLabel: openingName,
                    },
                  })
                }
                className="flex items-center justify-between py-2.5 gap-3 w-full text-left hover:bg-text-primary/5 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-text-primary text-sm font-semibold truncate">
                    <span className="text-text-secondary mr-1">{colorLabel}</span>
                    {openingName}
                  </p>
                  <p className="text-text-secondary text-xs tabular-nums">
                    {row.wins}W / {row.losses}L / {row.draws}D · {Math.round(row.blunderRate * 10) / 10} blunders/game
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-text-primary text-sm tabular-nums" title="Win rate (wins + ½ draws) in this opening">
                    {formatPct(row.winRate)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="font-mono uppercase text-[10px] tracking-tight text-gold-dark">
        Select an opening to drill its blunders →
      </p>
    </section>
  );
}
