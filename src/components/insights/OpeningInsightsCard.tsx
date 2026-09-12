import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MIN_TOTAL_GAMES_FOR_OPENING,
  useOpeningInsight,
} from '../../hooks/useInsights';
import { InsightCardSkeleton } from '../Skeleton';
import { OpeningRow, openingDisplayName } from './OpeningRow';

const TOP_N = 3;

export function OpeningInsightsCard() {
  const navigate = useNavigate();
  const insight = useOpeningInsight();
  const [showAll, setShowAll] = useState(false);
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const { rows, totalGames } = insight.data;
  if (totalGames < MIN_TOTAL_GAMES_FOR_OPENING) return null;
  if (rows.length === 0) return null;
  const visible = showAll ? rows : rows.slice(0, TOP_N);

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Top openings</span>
        <span className="text-text-secondary text-xs uppercase tracking-tight">
          win rate
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-text-primary/15">
        {visible.map((row) => (
          <OpeningRow
            key={`${row.ecoFamily}-${row.userColor ?? 'unknown'}`}
            row={row}
            onClick={() =>
              navigate('/training', {
                state: {
                  openingFilter: row.ecoFamily,
                  openingColor: row.userColor,
                  openingLabel: openingDisplayName(row),
                },
              })
            }
          />
        ))}
      </ul>
      {rows.length > TOP_N && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-left font-mono uppercase text-[10px] tracking-tight text-text-secondary hover:text-text-primary transition-colors"
        >
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <p className="font-mono uppercase text-[10px] tracking-tight text-gold-dark">
        Select an opening to drill its blunders →
      </p>
    </section>
  );
}
