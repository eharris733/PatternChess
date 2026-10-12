import clsx from 'clsx';
import {
  useAdminRetention,
  type RetentionCohort,
  type RetentionPoint,
  type RetentionWeek,
} from '../../hooks/useAdminRetention';

/** Below this many eligible users a percentage is noise — rendered muted. */
const MIN_RELIABLE_N = 10;
/** The bar for "retention is good enough to grow": D30 ≥ 20% over ≥ 20 users. */
const TARGET_DAY = 30;
const TARGET_PCT = 20;
const TARGET_N = 20;

function cohortLabel(cohort: string): string {
  if (cohort === 'all') return 'All users';
  const d = new Date(`${cohort}-01T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function pct(p: RetentionPoint): number {
  return p.eligible > 0 ? (p.retained / p.eligible) * 100 : 0;
}

/** Signup-cohort retention + weekly returning vs new trainees. Admin-only. */
export function RetentionCard() {
  const { data, isError, error } = useAdminRetention();

  if (isError) {
    return (
      <section className="card">
        <p className="text-incorrect text-sm">
          Couldn't load retention: {(error as Error)?.message ?? 'unknown error'}
        </p>
      </section>
    );
  }
  if (!data || data.cohorts.length === 0) return null;

  const all = data.cohorts.find((c) => c.cohort === 'all');
  const days = all?.curve.map((p) => p.day) ?? [];

  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Retention</span>
        <span className="text-text-secondary text-xs">trained again on day N or later</span>
      </header>

      {all && <Headline cohort={all} />}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              <th className="text-left font-normal px-1 pb-2">Cohort</th>
              <th className="text-right font-normal px-1 pb-2">Signups</th>
              <th className="text-right font-normal px-1 pb-2">Trained</th>
              {days.map((d) => (
                <th key={d} className="text-right font-normal px-1 pb-2">
                  D{d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-text-primary/10">
            {data.cohorts.map((c) => (
              <tr key={c.cohort} className={clsx(c.cohort === 'all' && 'font-semibold')}>
                <td className="text-left px-1 py-2 whitespace-nowrap">{cohortLabel(c.cohort)}</td>
                <td className="text-right px-1 py-2">{c.signups}</td>
                <td className="text-right px-1 py-2">{c.trained}</td>
                {c.curve.map((p) => (
                  <RetentionCell key={p.day} point={p} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.weeks.length > 0 && <WeeklyReturning weeks={data.weeks} />}

      <p className="text-text-secondary text-xs">
        Active = a training session with at least one attempted position (UTC days; admin
        excluded). Users too new to have reached day N are left out of that column. Visits that
        only browse /openings, /endgames or the Vault don't count. Muted cells have fewer than{' '}
        {MIN_RELIABLE_N} users.
      </p>
    </section>
  );
}

function Headline({ cohort }: { cohort: RetentionCohort }) {
  const target = cohort.curve.find((p) => p.day === TARGET_DAY);
  const trainedPct = cohort.signups > 0 ? (cohort.trained / cohort.signups) * 100 : 0;
  const twoDayPct = cohort.trained > 0 ? (cohort.trained2Days / cohort.trained) * 100 : 0;
  const met = !!target && target.eligible >= TARGET_N && pct(target) >= TARGET_PCT;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="card flex flex-col gap-1 py-3">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          D{TARGET_DAY} retention
        </span>
        <span className={clsx('heading-md tabular-nums', met ? 'text-correct' : 'text-text-primary')}>
          {target && target.eligible > 0 ? `${Math.round(pct(target))}%` : '—'}
        </span>
        <span className="text-text-secondary text-[10px]">
          target ≥ {TARGET_PCT}% · n = {target?.eligible ?? 0}
        </span>
      </div>
      <div className="card flex flex-col gap-1 py-3">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          Signed up → trained
        </span>
        <span className="heading-md tabular-nums">{Math.round(trainedPct)}%</span>
        <span className="text-text-secondary text-[10px]">
          {cohort.trained} of {cohort.signups}
        </span>
      </div>
      <div className="card flex flex-col gap-1 py-3">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          Trained 2+ days
        </span>
        <span className="heading-md tabular-nums">{Math.round(twoDayPct)}%</span>
        <span className="text-text-secondary text-[10px]">
          {cohort.trained2Days} of {cohort.trained} · 5+ days: {cohort.trained5Days}
        </span>
      </div>
    </div>
  );
}

function RetentionCell({ point }: { point: RetentionPoint }) {
  if (point.eligible === 0) {
    return <td className="text-right px-1 py-2 text-text-secondary/50">—</td>;
  }
  const reliable = point.eligible >= MIN_RELIABLE_N;
  return (
    <td
      className={clsx('text-right px-1 py-2 whitespace-nowrap', !reliable && 'text-text-secondary')}
      title={`${point.retained} of ${point.eligible} users`}
    >
      <span className="block">{Math.round(pct(point))}%</span>
      <span className="block text-[10px] text-text-secondary font-normal">
        {point.retained}/{point.eligible}
      </span>
    </td>
  );
}

function WeeklyReturning({ weeks }: { weeks: RetentionWeek[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.active));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          Weekly trainees · returning vs new
        </span>
        <span className="flex items-center gap-3 text-[10px] text-text-secondary">
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
              <span className="w-14 shrink-0 text-text-secondary tabular-nums">
                {new Date(`${w.week}T00:00:00`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <div className="relative flex-1 h-3 bg-text-primary/10 border border-text-primary/20 flex">
                <div className="h-full bg-gold-dark" style={{ width: `${(w.returning / max) * 100}%` }} />
                <div className="h-full bg-gold-dark/35" style={{ width: `${(fresh / max) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right tabular-nums text-text-primary">
                {w.returning}
                <span className="text-text-secondary"> + {fresh} new</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
