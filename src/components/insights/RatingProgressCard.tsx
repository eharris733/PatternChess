import { useMemo } from 'react';
import clsx from 'clsx';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeControlCategory } from '../../services/chessApiService';
import {
  useRatingProgress,
  type CategoryRatingProgress,
  type PlatformSeries,
  type RatingPlatform,
} from '../../hooks/useRatingProgress';
import { InsightCardSkeleton } from '../Skeleton';

const CATEGORY_LABEL: Record<TimeControlCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

const PLATFORM_LABEL: Record<RatingPlatform, string> = {
  lichess: 'Lichess',
  'chess.com': 'Chess.com',
};

// Ink for Lichess, gold for Chess.com — distinct on the cream surface.
// Resolved at paint via CSS variables so the chart re-tints when the theme changes.
const PLATFORM_STROKE: Record<RatingPlatform, string> = {
  lichess: 'rgb(var(--text-primary))',
  'chess.com': 'rgb(var(--accent))',
};

const INK = 'rgb(var(--text-primary))';
const MUTED = 'rgb(var(--text-primary) / 0.45)';

export function RatingProgressCard() {
  const { progress, isPending } = useRatingProgress();
  if (isPending) return <InsightCardSkeleton rows={2} />;
  if (progress.length === 0) return null;
  return <RatingProgressChartList progress={progress} />;
}

export function RatingProgressChartList({
  progress,
}: {
  progress: CategoryRatingProgress[];
}) {
  if (progress.length === 0) return null;
  return (
    <section className="card flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <span className="label">Rating progress</span>
        <span className="text-text-secondary text-xs">since you joined</span>
      </header>
      <ul className="flex flex-col gap-6">
        {progress.map((cat) => (
          <CategoryChart key={cat.category} category={cat} />
        ))}
      </ul>
    </section>
  );
}

function CategoryChart({ category }: { category: CategoryRatingProgress }) {
  const data = useMemo(() => mergeDaily(category.series), [category.series]);
  const span = useMemo(() => {
    const ms = data[data.length - 1].date - data[0].date;
    return ms / (1000 * 60 * 60 * 24); // days
  }, [data]);
  const xFmt = (ms: number) => formatDateTick(ms, span);

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-text-primary text-sm font-semibold">
          {CATEGORY_LABEL[category.category]}
        </p>
        <CategoryLegend series={category.series} />
      </div>
      <div className="h-44 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={INK} strokeOpacity={0.08} vertical={false} />
            <XAxis
              dataKey="date"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={xFmt}
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={{ stroke: MUTED }}
              axisLine={{ stroke: MUTED }}
              minTickGap={36}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={{ stroke: MUTED }}
              axisLine={{ stroke: MUTED }}
              width={36}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: 'rgb(var(--bg))',
                border: `2px solid ${INK}`,
                borderRadius: 0,
                boxShadow: `3px 3px 0 ${INK}`,
                padding: '6px 10px',
              }}
              labelFormatter={(ms) =>
                new Date(ms as number).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })
              }
              formatter={(value, name) => [value, PLATFORM_LABEL[name as RatingPlatform] ?? name]}
              cursor={{ stroke: INK, strokeOpacity: 0.2 }}
            />
            {category.series.map((s) => (
              <Line
                key={s.platform}
                type="monotone"
                dataKey={s.platform}
                stroke={PLATFORM_STROKE[s.platform]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, stroke: PLATFORM_STROKE[s.platform], fill: 'rgb(var(--bg))', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </li>
  );
}

function CategoryLegend({ series }: { series: PlatformSeries[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {series.map((s) => (
        <div key={s.platform} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="inline-block w-3 h-0.5"
            style={{ backgroundColor: PLATFORM_STROKE[s.platform] }}
          />
          <span className="text-text-secondary">{PLATFORM_LABEL[s.platform]}</span>
          <span className="text-text-primary tabular-nums">{s.latestRating}</span>
          <span
            className={clsx(
              'tabular-nums px-1 rounded-none border',
              s.delta > 0
                ? 'text-correct border-correct/50 bg-correct/10'
                : s.delta < 0
                  ? 'text-incorrect border-incorrect/50 bg-incorrect/10'
                  : 'text-text-secondary border-text-primary/40 bg-surface-3',
            )}
          >
            {s.delta >= 0 ? '+' : ''}
            {s.delta}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Collapse per-game points to one point per day per platform — using the day's
 * *last* rating. A player with 30 games today shouldn't show as a zig-zag at
 * today's x; they should show as one point at their end-of-day rating. This is
 * what makes the chart readable.
 */
function mergeDaily(series: PlatformSeries[]): Array<Record<string, number>> {
  // dayMs → { date: dayMs, [platform]: rating }
  const byDay = new Map<number, Record<string, number>>();
  for (const s of series) {
    // points are already chronologically sorted in the hook
    for (const p of s.points) {
      const day = startOfDay(p.at).getTime();
      const row = byDay.get(day) ?? { date: day };
      row[s.platform] = p.rating; // overwrites earlier same-day → keeps last
      byDay.set(day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => a.date - b.date);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDateTick(ms: number, spanDays: number): string {
  const d = new Date(ms);
  if (spanDays > 365) {
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
