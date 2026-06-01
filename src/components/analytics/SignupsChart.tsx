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

/** Daily signups bar chart. Mirrors RatingProgressCard's recharts styling. */
export function SignupsChart({ data }: { data: AdminKpiSignupDay[] }) {
  const rows = useMemo(
    () => [...data].sort((a, b) => a.date.localeCompare(b.date)),
    [data],
  );
  if (rows.length === 0) {
    return <p className="text-text-secondary text-sm">No signups yet.</p>;
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
            formatter={(value) => [value, 'Signups']}
            cursor={{ fill: 'rgb(var(--text-primary) / 0.06)' }}
          />
          <Bar dataKey="count" fill={GOLD} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
