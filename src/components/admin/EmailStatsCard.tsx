import { useAdminEmailStats, type ReturnRateGroup } from '../../hooks/useAdminEmailStats';

const KIND_LABEL: Record<string, string> = {
  welcome: 'Welcome',
  ready: 'Day-1 "ready"',
  streak_at_risk: 'Streak at risk',
  daily_plan: 'Daily plan',
  weekly_report: 'Weekly report',
};

function pct(g: ReturnRateGroup): string {
  return g.accounts > 0 ? `${Math.round((g.trained / g.accounts) * 100)}%` : '–';
}

/** Email reach and whether sends bring people back. Admin-only. */
export function EmailStatsCard() {
  const { data } = useAdminEmailStats();
  // A shape we don't recognise (an older RPC definition) hides the card instead of breaking /analytics.
  if (!data?.returnRate?.reachable || !data.returnRate.other || !Array.isArray(data.kinds)) return null;
  const { reachable, other } = data.returnRate;

  return (
    <section className="card flex flex-col gap-3" data-testid="email-stats-card">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Emails</span>
        <span className="text-text-secondary text-xs">last 30 days · returned = trained within 24h</span>
      </header>
      <p className="text-sm">
        <span className="font-mono">{data.reachable}</span> reachable ·{' '}
        <span className="font-mono">{data.optedIn}</span> opted in ·{' '}
        <span className="font-mono">{data.noAddress}</span> with no address
        {data.confirmPending > 0 && (
          <>
            {' '}· <span className="font-mono">{data.confirmPending}</span> awaiting confirmation
          </>
        )}
        {' '}· <span className="font-mono">{data.unsubscribed30d}</span> unsubscribed
      </p>
      <p className="text-sm">
        Trained in the last 7 days (accounts a week or older): reachable{' '}
        <span className="font-mono">{pct(reachable)}</span> ({reachable.trained}/{reachable.accounts}) vs everyone else{' '}
        <span className="font-mono">{pct(other)}</span> ({other.trained}/{other.accounts})
      </p>
      {data.kinds.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
              <th className="text-left font-normal pb-2">Email</th>
              <th className="text-right font-normal pb-2">Sent</th>
              <th className="text-right font-normal pb-2">Returned</th>
            </tr>
          </thead>
          <tbody>
            {data.kinds.map((k) => (
              <tr key={k.kind} className="border-t border-text-primary/10">
                <td className="py-1.5">{KIND_LABEL[k.kind] ?? k.kind}</td>
                <td className="py-1.5 text-right">{k.sent}</td>
                <td className="py-1.5 text-right">
                  {k.returned}
                  {k.sent > 0 && (
                    <span className="text-text-secondary"> ({Math.round((k.returned / k.sent) * 100)}%)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
