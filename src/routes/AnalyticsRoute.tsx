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
} from '../hooks/useAdminKpis';
import { SignupsChart } from '../components/analytics/SignupsChart';
import { Skeleton } from '../components/Skeleton';

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
          <TotalsTiles data={data} />

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

          <FunnelCard data={data} />
          <ActivityCard data={data} />
          <PlatformsCard data={data} />
          {data.leads && data.leads.length > 0 && <LeadsCard rows={data.leads} />}
          <RecentSignupsCard rows={data.recentSignups} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card flex flex-col gap-1 py-3">
      <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
        {label}
      </span>
      <span className="heading-md tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function TotalsTiles({ data }: { data: AdminKpis }) {
  const { totals, activity } = data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Tile label="Signups" value={totals.signups} />
      <Tile label="Synced games" value={totals.synced} />
      <Tile label="Found blunders" value={totals.foundBlunders} />
      <Tile label="Trained" value={totals.trained} />
      <Tile label="Active 24h" value={activity.dau} />
      <Tile label="Active 7d" value={activity.wau} />
      <Tile label="Active 30d" value={activity.mau} />
      <Tile label="Connected" value={totals.connected} />
    </div>
  );
}

function FunnelBar({
  label,
  count,
  signups,
}: {
  label: string;
  count: number;
  signups: number;
}) {
  const pct = signups > 0 ? (count / signups) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5">
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
    </div>
  );
}

function FunnelCard({ data }: { data: AdminKpis }) {
  const { totals } = data;
  return (
    <section className="card flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <span className="label">Find-your-blunders funnel</span>
        <span className="text-text-secondary text-xs">% of signups</span>
      </header>
      <div className="flex flex-col gap-3">
        <FunnelBar label="Signed up" count={totals.signups} signups={totals.signups} />
        <FunnelBar label="Connected account" count={totals.connected} signups={totals.signups} />
        <FunnelBar label="Synced games" count={totals.synced} signups={totals.signups} />
        <FunnelBar label="Found blunders" count={totals.foundBlunders} signups={totals.signups} />
        <FunnelBar label="Trained" count={totals.trained} signups={totals.signups} />
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
          return (
            <div
              key={`${r.platform ?? '?'}-${r.username}-${i}`}
              className="flex items-center justify-between gap-2 py-2.5 first:pt-0"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-text-primary text-sm truncate">{r.username}</span>
                <span className="text-text-secondary text-[10px] truncate">{handle}</span>
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

function ActivityCard({ data }: { data: AdminKpis }) {
  const { activity } = data;
  return (
    <section className="card flex flex-col gap-3">
      <span className="label">Active users</span>
      <div className="grid grid-cols-3 gap-3 text-center">
        {(
          [
            ['Daily', activity.dau],
            ['Weekly', activity.wau],
            ['Monthly', activity.mau],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="heading-md tabular-nums">{value.toLocaleString()}</span>
            <span className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-text-secondary text-xs">Synced a game or trained in the window.</p>
    </section>
  );
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

function StageBadge({ on, label }: { on: boolean; label: string }) {
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
        {rows.map((r, i) => (
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
              {r.games > 0 && (
                <span className="text-text-secondary text-[10px] tabular-nums ml-auto">
                  {r.games} games · {r.blunders} blunders
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
