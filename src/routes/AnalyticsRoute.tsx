import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import {
  useAdminKpis,
  type AdminKpis,
  type AdminKpiSignup,
  type AdminLandingFunnel,
  type AdminLead,
  type AdminTrainingAnalytics,
} from '../hooks/useAdminKpis';
import type { AdminUserCategory } from '../hooks/useAdminUserList';
import { SignupsChart } from '../components/analytics/SignupsChart';
import { Skeleton } from '../components/Skeleton';
import { UserListModal } from '../components/admin/UserListModal';
import {
  chesscomProfileUrl,
  lichessProfileUrl,
} from '../lib/chessProfileUrl';

export function AnalyticsRoute() {
  const { user, loading } = useAuth();
  // Wait for auth to resolve before deciding — avoids redirecting on the first
  // render when the session (and thus user.email) hasn't loaded yet.
  if (loading) return <div className="p-8 text-text-secondary">Loading…</div>;
  // UX gate only — the admin_kpis() RPC re-checks the email server-side.
  if (!isAdminEmail(user?.email)) return <Navigate to="/dashboard" replace />;
  return <AnalyticsContent />;
}

function AnalyticsContent() {
  const { data, isPending, isError, error } = useAdminKpis();
  const [drilldown, setDrilldown] = useState<AdminUserCategory | null>(null);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Admin</span>
        <h1 className="heading-xl">Analytics</h1>
        <p className="text-text-secondary text-sm">
          Landing funnel, signups, and activity across all users.
        </p>
      </header>

      {isError && (
        <section className="card">
          <p className="text-incorrect text-sm">
            Couldn't load analytics: {(error as Error)?.message ?? 'unknown error'}
          </p>
        </section>
      )}

      {isPending && !isError && (
        <>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </>
      )}

      {data && (
        <>
          <TotalsTiles data={data} onDrilldown={setDrilldown} />

          {data.landingFunnel && <LandingFunnelCard funnel={data.landingFunnel} />}

          <section className="card flex flex-col gap-4">
            <header className="flex items-baseline justify-between">
              <span className="label">Signups over time</span>
              <span className="text-text-secondary text-xs tabular-nums">
                {data.totals.signups.toLocaleString()} total
              </span>
            </header>
            <SignupsChart data={data.signupsByDay} />
          </section>

          <FunnelCard data={data} onDrilldown={setDrilldown} />
          <ActivityCard data={data} onDrilldown={setDrilldown} />
          {data.trainingAnalytics && (
            <TrainingAnalyticsCard
              analytics={data.trainingAnalytics}
              onDrilldown={setDrilldown}
            />
          )}
          <PlatformsCard data={data} />
          {data.leads && data.leads.length > 0 && <LeadsCard rows={data.leads} />}
          <RecentSignupsCard rows={data.recentSignups} />
        </>
      )}

      {drilldown && (
        <UserListModal category={drilldown} onClose={() => setDrilldown(null)} />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
        {label}
      </span>
      <span className="heading-md tabular-nums">{value.toLocaleString()}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card flex flex-col gap-1 py-3 text-left hover:bg-text-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-dark"
      >
        {inner}
      </button>
    );
  }
  return <div className="card flex flex-col gap-1 py-3">{inner}</div>;
}

function TotalsTiles({
  data,
  onDrilldown,
}: {
  data: AdminKpis;
  onDrilldown: (c: AdminUserCategory) => void;
}) {
  const { totals, activity } = data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Tile label="Signups" value={totals.signups} onClick={() => onDrilldown('signups')} />
      <Tile label="Synced games" value={totals.synced} onClick={() => onDrilldown('synced')} />
      <Tile label="Found blunders" value={totals.foundBlunders} onClick={() => onDrilldown('foundBlunders')} />
      <Tile label="Trained" value={totals.trained} onClick={() => onDrilldown('trained')} />
      <Tile label="Active 24h" value={activity.dau} onClick={() => onDrilldown('dau')} />
      <Tile label="Active 7d" value={activity.wau} onClick={() => onDrilldown('wau')} />
      <Tile label="Active 30d" value={activity.mau} onClick={() => onDrilldown('mau')} />
      <Tile label="Connected" value={totals.connected} onClick={() => onDrilldown('connected')} />
    </div>
  );
}

function FunnelBar({
  label,
  count,
  signups,
  onClick,
}: {
  label: string;
  count: number;
  signups: number;
  onClick?: () => void;
}) {
  const pct = signups > 0 ? (count / signups) * 100 : 0;
  const inner = (
    <>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-primary">
          {count.toLocaleString()}
          <span className="text-text-secondary"> · {Math.round(pct)}%</span>
        </span>
      </div>
      <div className="relative h-3 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="absolute inset-y-0 left-0 rounded-none bg-gold-dark"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-1.5 w-full text-left p-1 -m-1 rounded-none hover:bg-text-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-dark"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex flex-col gap-1.5">{inner}</div>;
}

function FunnelCard({
  data,
  onDrilldown,
}: {
  data: AdminKpis;
  onDrilldown: (c: AdminUserCategory) => void;
}) {
  const { totals } = data;
  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Find-your-blunders funnel</span>
        <span className="text-text-secondary text-xs">% of signups</span>
      </header>
      <div className="flex flex-col gap-3">
        <FunnelBar label="Signed up" count={totals.signups} signups={totals.signups} />
        <FunnelBar
          label="Connected account"
          count={totals.connected}
          signups={totals.signups}
          onClick={() => onDrilldown('connected')}
        />
        <FunnelBar
          label="Synced games"
          count={totals.synced}
          signups={totals.signups}
          onClick={() => onDrilldown('synced')}
        />
        <FunnelBar
          label="Found blunders"
          count={totals.foundBlunders}
          signups={totals.signups}
          onClick={() => onDrilldown('foundBlunders')}
        />
        <FunnelBar
          label="Trained"
          count={totals.trained}
          signups={totals.signups}
          onClick={() => onDrilldown('trained')}
        />
      </div>
    </section>
  );
}

function LandingFunnelCard({ funnel }: { funnel: AdminLandingFunnel }) {
  const { views, entered, converted } = funnel;
  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Landing funnel</span>
        <span className="text-text-secondary text-xs">% of visitors</span>
      </header>
      <div className="flex flex-col gap-3">
        <FunnelBar label="Visited landing (humans)" count={views} signups={views} />
        <FunnelBar label="Entered a username" count={entered} signups={views} />
        <FunnelBar label="Created an account" count={converted} signups={views} />
      </div>
      <p className="text-text-secondary text-xs">
        Bots filtered by user-agent and a human-interaction signal — approximate. A visitor is
        counted as converted when their browser later created an account.
      </p>
    </section>
  );
}

function LeadsCard({ rows }: { rows: AdminLead[] }) {
  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Entered accounts (leads)</span>
        <span className="text-text-secondary text-xs">latest {rows.length}</span>
      </header>
      <div className="flex flex-col divide-y-2 divide-text-primary/10">
        {rows.map((r, i) => {
          const handle =
            r.platform === 'lichess'
              ? `lichess.org/@/${r.username}`
              : r.platform === 'chesscom'
                ? `chess.com/member/${r.username}`
                : r.username;
          const href =
            r.platform === 'lichess'
              ? lichessProfileUrl(r.username)
              : r.platform === 'chesscom'
                ? chesscomProfileUrl(r.username)
                : null;
          return (
            <div
              key={`${r.platform ?? '?'}-${r.username}-${i}`}
              className="flex items-center justify-between gap-2 py-2.5 first:pt-0"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-text-primary text-sm truncate">{r.username}</span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-secondary text-[10px] truncate hover:text-text-primary underline-offset-2 hover:underline"
                  >
                    {handle}
                  </a>
                ) : (
                  <span className="text-text-secondary text-[10px] truncate">{handle}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.attempts > 1 && (
                  <span className="text-text-secondary text-[10px] tabular-nums">
                    ×{r.attempts}
                  </span>
                )}
                <StageBadge on={r.converted} label={r.converted ? 'Signed up' : 'No account'} />
                <span className="text-text-secondary text-xs tabular-nums">
                  {new Date(r.lastSeen).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityCard({
  data,
  onDrilldown,
}: {
  data: AdminKpis;
  onDrilldown: (c: AdminUserCategory) => void;
}) {
  const { activity } = data;
  const cells: ReadonlyArray<readonly [string, number, AdminUserCategory]> = [
    ['Daily', activity.dau, 'dau'],
    ['Weekly', activity.wau, 'wau'],
    ['Monthly', activity.mau, 'mau'],
  ];
  return (
    <section className="card flex flex-col gap-3">
      <span className="label">Active users</span>
      <div className="grid grid-cols-3 gap-3 text-center">
        {cells.map(([label, value, category]) => (
          <button
            key={label}
            type="button"
            onClick={() => onDrilldown(category)}
            className="flex flex-col gap-1 py-1 hover:bg-text-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-gold-dark"
          >
            <span className="heading-md tabular-nums">{value.toLocaleString()}</span>
            <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              {label}
            </span>
          </button>
        ))}
      </div>
      <p className="text-text-secondary text-xs">Synced a game or trained in the window.</p>
    </section>
  );
}

function TrainingAnalyticsCard({
  analytics,
  onDrilldown,
}: {
  analytics: AdminTrainingAnalytics;
  onDrilldown: (c: AdminUserCategory) => void;
}) {
  const { avgDurationSeconds, medianDurationSeconds, sessionsWithDuration } = analytics;
  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Training engagement</span>
        <span className="text-text-secondary text-xs">
          {sessionsWithDuration.toLocaleString()} timed session
          {sessionsWithDuration === 1 ? '' : 's'}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <DurationTile label="Avg session" seconds={avgDurationSeconds} />
        <DurationTile label="Median session" seconds={medianDurationSeconds} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          Sessions per day · last 30 days
        </span>
        <SignupsChart
          data={analytics.sessionsByDay}
          valueLabel="Sessions"
          emptyLabel="No training sessions in the last 30 days."
        />
      </div>

      {analytics.topTrainees.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              Top trainees
            </span>
            <button
              type="button"
              onClick={() => onDrilldown('trained')}
              className="text-text-secondary text-xs hover:text-text-primary underline-offset-2 hover:underline"
            >
              see all
            </button>
          </div>
          <div className="flex flex-col divide-y-2 divide-text-primary/10">
            {analytics.topTrainees.map((t, i) => (
              <div
                key={`${t.email ?? 'anon'}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2 first:pt-0"
              >
                <span className="text-text-primary text-sm truncate">
                  {t.email ?? t.displayName ?? 'unknown'}
                </span>
                <span className="text-text-secondary text-xs tabular-nums shrink-0">
                  {t.sessions.toLocaleString()} session{t.sessions === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DurationTile({ label, seconds }: { label: string; seconds: number }) {
  return (
    <div className="card flex flex-col gap-1 py-3">
      <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
        {label}
      </span>
      <span className="heading-md tabular-nums">{formatDuration(seconds)}</span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 1) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function PlatformsCard({ data }: { data: AdminKpis }) {
  if (data.platforms.length === 0) return null;
  return (
    <section className="card flex flex-col gap-3">
      <span className="label">By platform</span>
      <div className="flex flex-col gap-2">
        {data.platforms.map((p) => (
          <div key={p.platform} className="flex items-baseline justify-between text-sm">
            <span className="text-text-primary capitalize">{p.platform}</span>
            <span className="text-text-secondary tabular-nums">
              {p.users.toLocaleString()} users · {p.games.toLocaleString()} games
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StageBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={clsx(
        'font-mono uppercase text-[9px] tracking-tight px-1 py-0.5 border rounded-none',
        on
          ? 'text-gold-dark border-gold-dark/50 bg-gold-dark/10'
          : 'text-text-secondary/50 border-text-primary/15',
      )}
    >
      {label}
    </span>
  );
}

function RecentSignupsCard({ rows }: { rows: AdminKpiSignup[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="card flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <span className="label">Recent signups</span>
        <span className="text-text-secondary text-xs">latest {rows.length}</span>
      </header>
      <div className="flex flex-col divide-y-2 divide-text-primary/10">
        {rows.map((r, i) => {
          const handles: { href: string; label: string }[] = [];
          if (r.lichessUsername)
            handles.push({
              href: lichessProfileUrl(r.lichessUsername),
              label: `lichess.org/@/${r.lichessUsername}`,
            });
          if (r.chesscomUsername)
            handles.push({
              href: chesscomProfileUrl(r.chesscomUsername),
              label: `chess.com/member/${r.chesscomUsername}`,
            });
          const meta: string[] = [];
          if (r.trainingSessions > 0)
            meta.push(`${r.trainingSessions} session${r.trainingSessions === 1 ? '' : 's'}`);
          if (r.games > 0) meta.push(`${r.games} games`);
          if (r.blunders > 0) meta.push(`${r.blunders} blunders`);
          return (
            <div key={`${r.email ?? 'anon'}-${i}`} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-text-primary text-sm truncate">
                  {r.email ?? r.displayName ?? 'unknown'}
                </span>
                <span className="text-text-secondary text-xs tabular-nums shrink-0">
                  {new Date(r.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <StageBadge on={r.connected} label="Connected" />
                <StageBadge on={r.synced} label="Synced" />
                <StageBadge on={r.foundBlunders} label="Blunders" />
                <StageBadge on={r.trained} label="Trained" />
                {meta.length > 0 && (
                  <span className="text-text-secondary text-[10px] tabular-nums ml-auto">
                    {meta.join(' · ')}
                  </span>
                )}
              </div>
              {handles.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {handles.map((h) => (
                    <a
                      key={h.href}
                      href={h.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-secondary text-[10px] truncate hover:text-text-primary underline-offset-2 hover:underline"
                    >
                      {h.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
