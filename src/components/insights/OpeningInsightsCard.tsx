import { useState } from 'react';
import { useQuotaGuard } from '../../hooks/useDailyQuota';
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
  const { guard } = useQuotaGuard();
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
        <span className="text-text-primary text-xs">Win rate</span>
      </header>
      <ul className="flex flex-col divide-y divide-text-primary/15">
        {visible.map((row) => (
          <OpeningRow
            key={`${row.family}-${row.userColor ?? 'unknown'}`}
            row={row}
            onClick={() =>
              guard('positions') && navigate('/training', {
                state: {
                  openingFilter: row.family,
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
          className="self-start text-xs font-semibold text-text-primary underline underline-offset-2"
        >
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
      <p className="text-xs text-text-primary">Tap an opening to drill its blunders.</p>
    </section>
  );
}
