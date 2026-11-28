import { useState } from 'react';
import clsx from 'clsx';
import {
  useAdminRetention,
  type RetentionCohort,
  type RetentionCount,
  type RetentionWeek,
} from '../../hooks/useAdminRetention';
import {
  FLATTEN_RATIO,
  MIN_RELIABLE_N,
  RETENTION_BENCHMARKS,
  WEEK4_TARGET,
  rate,
  releasesInWeek,
  scaleReadout,
  type ScaleVerdict,
} from '../../lib/retentionKpi';

const WEEKLY_ROWS = 12;

const fmtPct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

function cohortLabel(cohort: string): string {
  if (cohort === 'all') return 'All users';
  if (cohort.length === 7) {
    return new Date(`${cohort}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  return new Date(`${cohort}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Signup-cohort retention against the scale-or-fix KPI. Admin-only. */
export function RetentionCard() {
  const { data, isError, error } = useAdminRetention();
  const [grouping, setGrouping] = useState<'week' | 'month'>('week');

  if (isError) {
    return (
      <section className="card">
        <p className="text-incorrect text-sm">
          Couldn't load retention: {(error as Error)?.message ?? 'unknown error'}
        </p>
      </section>
    );
  }
  if (!data?.all) return null;

  const cohorts = grouping === 'week' ? data.byWeek.slice(0, WEEKLY_ROWS) : data.byMonth;

  return (
    <section className="card flex flex-col gap-5" data-testid="retention-card">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Retention</span>
        <span className="text-xs text-text-primary">trained on day N after signup</span>
      </header>

      <ScaleKpi all={data.all} />
      <WeeklyCurve all={data.all} />
      <Benchmarks all={data.all} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="label">Signup cohorts</span>
          <div className="flex gap-1" role="tablist" aria-label="Cohort grouping">
            {(['week', 'month'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={grouping === g}
                onClick={() => setGrouping(g)}
                className={clsx(
                  'font-mono text-xs px-2 py-1 border-2 border-text-primary',
                  grouping === g ? 'bg-text-primary text-bg' : 'text-text-primary',
                )}
              >
                {g === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs font-semibold text-text-primary whitespace-nowrap">
                <th className="text-left px-1 pb-2">{grouping === 'week' ? 'Week of' : 'Month'}</th>
                <th className="text-right px-1 pb-2">Users</th>
                <th className="text-right px-1 pb-2">Trained</th>
                <th className="text-right px-1 pb-2">D1</th>
                <th className="text-right px-1 pb-2">D7</th>
                <th className="text-right px-1 pb-2">Wk 4</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-text-primary/10">
              {[data.all, ...cohorts].map((c) => (
                <CohortRow key={c.cohort} cohort={c} weekly={grouping === 'week'} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.weeks.length > 0 && <WeeklyReturning weeks={data.weeks} />}

      <p className="text-xs text-text-primary">
        D1 and D7 count a user who trained on exactly that day after signup (signup day is day 0,
        in their own timezone); Week 4 counts any day 22–28. A user counts only once that window is
        over for them, so new cohorts fill in instead of reading low. Training = a drilled
        position, an opening review, an endgame play-out or a course lesson. Openings and endgames
        keep only their latest date, so returns made only there are undercounted. Faded cells have
        fewer than {MIN_RELIABLE_N} users. Admin excluded.
      </p>
    </section>
  );
}

const VERDICT_COPY: Record<ScaleVerdict, { title: string; tone: string }> = {
  fix: { title: 'Fix retention before scaling', tone: 'border-incorrect text-incorrect' },
  wait: { title: 'Not enough data to call it yet', tone: 'border-text-primary text-text-primary' },
  scale: { title: 'Retention supports scaling', tone: 'border-correct text-correct' },
};

function ScaleKpi({ all }: { all: RetentionCohort }) {
  const r = scaleReadout(all);
  const copy = VERDICT_COPY[r.verdict];
  const w8 = all.windows.w8;
  return (
    <div className={clsx('border-2 p-3 flex flex-col gap-2', copy.tone)} data-testid="retention-verdict">
      <span className="heading-md">{copy.title}</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-text-primary">
        <div className="flex flex-col gap-0.5">
          <span className="label">Week 4 retention</span>
          <span className="heading-lg tabular-nums">{fmtPct(r.week4Rate)}</span>
          <span className="text-xs tabular-nums">
            {r.week4.retained} of {r.week4.eligible} users
            {r.week4Interval &&
              ` · likely ${fmtPct(r.week4Interval.low)}–${fmtPct(r.week4Interval.high)}`}
            {' · '}target {fmtPct(WEEK4_TARGET)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="label">Week 8 ÷ Week 4</span>
          <span className="heading-lg tabular-nums">
            {r.flattening === null ? '—' : fmtPct(r.flattening)}
          </span>
          <span className="text-xs tabular-nums">
            {r.flattening === null
              ? `needs ${MIN_RELIABLE_N} users 8 weeks in (now ${w8.eligible})`
              : `curve flattening · target ${fmtPct(FLATTEN_RATIO)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

function WeeklyCurve({ all }: { all: RetentionCohort }) {
  const points = [
    { label: 'Week 1', c: all.windows.w1 },
    { label: 'Week 2', c: all.windows.w2 },
    { label: 'Week 4', c: all.windows.w4 },
    { label: 'Week 8', c: all.windows.w8 },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">Retention curve, all users</span>
      {points.map(({ label, c }) => {
        const r = rate(c);
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0">{label}</span>
            <div className="relative flex-1 h-3 bg-text-primary/10 border border-text-primary/20">
              <div className="h-full bg-gold-dark" style={{ width: `${(r ?? 0) * 100}%` }} />
            </div>
            <span className={clsx('w-24 shrink-0 text-right tabular-nums', c.eligible < MIN_RELIABLE_N && 'opacity-60')}>
              {fmtPct(r)} <span className="text-[10px]">({c.retained}/{c.eligible})</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Benchmarks({ all }: { all: RetentionCohort }) {
  const keys = ['d1', 'd7', 'd30'] as const;
  return (
    <div className="flex flex-col gap-2">
      <span className="label">Against published benchmarks (exact day N)</span>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs font-semibold">
              <th className="text-left px-1 pb-1" />
              <th className="text-right px-1 pb-1">D1</th>
              <th className="text-right px-1 pb-1">D7</th>
              <th className="text-right px-1 pb-1">D30</th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-text-primary/10">
            <tr className="font-semibold">
              <td className="px-1 py-1.5">PatternChess</td>
              {keys.map((k) => (
                <td key={k} className={clsx('text-right px-1 py-1.5', all.windows[k].eligible < MIN_RELIABLE_N && 'opacity-60')}>
                  {fmtPct(rate(all.windows[k]))}
                  <span className="block text-[10px] font-normal">n = {all.windows[k].eligible}</span>
                </td>
              ))}
            </tr>
            {RETENTION_BENCHMARKS.map((b) => (
              <tr key={b.label}>
                <td className="px-1 py-1.5">{b.label}</td>
                <td className="text-right px-1 py-1.5">{b.d1}</td>
                <td className="text-right px-1 py-1.5">{b.d7}</td>
                <td className="text-right px-1 py-1.5">{b.d30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CohortRow({ cohort, weekly }: { cohort: RetentionCohort; weekly: boolean }) {
  const releases = weekly && cohort.cohort !== 'all' ? releasesInWeek(cohort.cohort) : [];
  return (
    <tr className={clsx(cohort.cohort === 'all' && 'font-semibold')}>
      <td className="text-left px-1 py-2">
        <span className="whitespace-nowrap">
          {cohort.cohort === 'all' ? 'All users' : cohortLabel(cohort.cohort)}
        </span>
        {releases.map((r) => (
          <span key={r} className="block max-w-[7rem] text-[10px] leading-tight text-gold-dark font-semibold">
            Shipped: {r}
          </span>
        ))}
      </td>
      <td className="text-right px-1 py-2">{cohort.signups}</td>
      <td className="text-right px-1 py-2">{cohort.trained}</td>
      <RetentionCell count={cohort.windows.d1} />
      <RetentionCell count={cohort.windows.d7} />
      <RetentionCell count={cohort.windows.w4} />
    </tr>
  );
}

function RetentionCell({ count }: { count: RetentionCount }) {
  if (count.eligible === 0) {
    return <td className="text-right px-1 py-2 opacity-40">—</td>;
  }
  return (
    <td className={clsx('text-right px-1 py-2 whitespace-nowrap', count.eligible < MIN_RELIABLE_N && 'opacity-60')}>
      <span className="block">{fmtPct(rate(count))}</span>
      <span className="block text-[10px] font-normal">
        {count.retained}/{count.eligible}
      </span>
    </td>
  );
}

function WeeklyReturning({ weeks }: { weeks: RetentionWeek[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.active));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Weekly trainees: returning vs new</span>
        <span className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 bg-gold-dark" aria-hidden /> returning
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 bg-gold-dark/35" aria-hidden /> new
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {weeks.map((w) => {
          const fresh = w.active - w.returning;
          return (
            <div key={w.week} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 tabular-nums">{cohortLabel(w.week)}</span>
              <div className="relative flex-1 h-3 bg-text-primary/10 border border-text-primary/20 flex">
                <div className="h-full bg-gold-dark" style={{ width: `${(w.returning / max) * 100}%` }} />
                <div className="h-full bg-gold-dark/35" style={{ width: `${(fresh / max) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right tabular-nums">
                {w.returning} + {fresh} new
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
