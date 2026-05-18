import clsx from 'clsx';
import {
  MIN_GAMES_FOR_OPENING_DELTA,
  MIN_TOTAL_GAMES_FOR_OPENING,
  useOpeningInsight,
} from '../../hooks/useInsights';
import { formatOpeningDisplay, resolveOpeningFamilyName } from '../../chess/openingNames';
import { InsightCardSkeleton } from '../Skeleton';

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function deltaTone(delta: number): 'good' | 'bad' | 'neutral' {
  if (delta >= 0.03) return 'good';
  if (delta <= -0.03) return 'bad';
  return 'neutral';
}

export function OpeningInsightsCard() {
  const insight = useOpeningInsight();
  if (insight.isPending) return <InsightCardSkeleton rows={3} />;
  if (!insight.data) return null;
  const { rows, totalGames, band, benchmarkSource } = insight.data;
  if (totalGames < MIN_TOTAL_GAMES_FOR_OPENING) return null;
  if (rows.length === 0) return null;

  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Top openings</span>
        <span className="text-text-secondary text-xs tabular-nums">
          band {band}
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-[#1A1A1A]/15">
        {rows.map((row) => {
          const colorLabel = row.userColor === 'white' ? '♔' : row.userColor === 'black' ? '♚' : '·';
          const sample = row.games;
          const showDelta = sample >= MIN_GAMES_FOR_OPENING_DELTA && row.benchmark !== null;
          const delta = showDelta ? row.winRate - (row.benchmark ?? 0) : null;
          const tone = delta !== null ? deltaTone(delta) : 'neutral';
          return (
            <li
              key={`${row.ecoFamily}-${row.userColor ?? 'unknown'}`}
              className="flex items-center justify-between py-2.5 gap-3"
            >
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-semibold truncate">
                  <span className="text-text-secondary mr-1">{colorLabel}</span>
                  {formatOpeningDisplay(resolveOpeningFamilyName(row.ecoFamily))}
                </p>
                <p className="text-text-secondary text-xs tabular-nums">
                  {row.wins}W / {row.losses}L / {row.draws}D · {Math.round(row.blunderRate * 10) / 10} blunders/game
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-text-primary text-sm tabular-nums">
                  {formatPct(row.winRate)}
                </span>
                {showDelta && delta !== null && (
                  <span
                    className={clsx(
                      'font-mono uppercase text-[10px] tabular-nums tracking-tight px-1.5 py-0.5 rounded-none border-2 border-[#1A1A1A]',
                      tone === 'good' && 'bg-correct/15 text-correct',
                      tone === 'bad' && 'bg-incorrect/15 text-incorrect',
                      tone === 'neutral' && 'bg-surface-3 text-text-secondary',
                    )}
                  >
                    {delta >= 0 ? '+' : ''}
                    {Math.round(delta * 100)}%
                  </span>
                )}
                {!showDelta && (
                  <span className="text-xs text-text-secondary">Need more data</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {benchmarkSource && (
        <p className="text-text-secondary text-xs">vs same-band benchmark · {benchmarkSource}</p>
      )}
    </section>
  );
}
