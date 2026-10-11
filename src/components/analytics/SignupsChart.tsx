import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AdminKpiSignupDay } from '../../hooks/useAdminKpis';

const INK = 'rgb(var(--text-primary))';
const MUTED = 'rgb(var(--text-primary) / 0.45)';
const GOLD = 'rgb(var(--accent))';

function formatTick(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * One row per calendar day from the first date through today (UTC, matching the
 * server's day buckets), with 0 for days the RPC omits. The axis is categorical,
 * so a missing day would otherwise collapse and squash the timeline.
 */
function fillDays(data: AdminKpiSignupDay[]): AdminKpiSignupDay[] {
  if (data.length === 0) return [];
  const counts = new Map(data.map((d) => [d.date, d.count]));
  const sorted = [...counts.keys()].sort();
  const today = new Date().toISOString().slice(0, 10);
  const last = sorted[sorted.length - 1] > today ? sorted[sorted.length - 1] : today;
  const rows: AdminKpiSignupDay[] = [];
  for (const d = new Date(`${sorted[0]}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    rows.push({ date, count: counts.get(date) ?? 0 });
    if (date >= last) break;
  }
  return rows;
}

/** Daily bar chart over `{date, count}` rows. Mirrors RatingProgressCard's recharts styling. */
export function SignupsChart({
  data,
  valueLabel = 'Signups',
  emptyLabel = 'No signups yet.',
}: {
  data: AdminKpiSignupDay[];
  valueLabel?: string;
  emptyLabel?: string;
}) {
  const rows = useMemo(() => fillDays(data), [data]);
  if (rows.length === 0) {
    return <p className="text-text-secondary text-sm">{emptyLabel}</p>;
  }
  return (
    <div className="h-48 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={INK} strokeOpacity={0.08} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickLine={{ stroke: MUTED }}
            axisLine={{ stroke: MUTED }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: MUTED, fontSize: 11 }}
            tickLine={{ stroke: MUTED }}
            axisLine={{ stroke: MUTED }}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: 'rgb(var(--bg))',
              border: `2px solid ${INK}`,
              borderRadius: 0,
              boxShadow: `3px 3px 0 ${INK}`,
              padding: '6px 10px',
            }}
            labelFormatter={(date) =>
              new Date(`${date as string}T00:00:00`).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            }
            formatter={(value) => [value, valueLabel]}
            cursor={{ fill: 'rgb(var(--text-primary) / 0.06)' }}
          />
          <Bar dataKey="count" fill={GOLD} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
