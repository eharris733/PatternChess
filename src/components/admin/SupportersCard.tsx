import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { isAdminEmail } from '../../auth/admin';
import { supabaseService, type AdminSupporter } from '../../services/supabaseService';

function csvCell(v: string | null): string {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: AdminSupporter[]) {
  const header = ['handle', 'email', 'status', 'first_supported_at', 'current_period_end', 'cancel_at_period_end', 'beta_invited_at'];
  const lines = rows.map((r) =>
    [r.label, r.email, r.status, r.firstSupportedAt, r.currentPeriodEnd, String(r.cancelAtPeriodEnd), r.betaInvitedAt]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patternchess-supporters-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Everyone who has ever supported (admin only): thanks and the mobile-app beta list. */
export function SupportersCard() {
  const { user } = useAuth();
  const admin = !!user && isAdminEmail(user.email);
  const { data } = useQuery({
    queryKey: ['admin', 'supporters', user?.id],
    enabled: admin,
    staleTime: 60_000,
    retry: false,
    queryFn: () => supabaseService.getAdminSupporters(),
  });
  if (!data) return null;
  const active = data.filter((r) => ['active', 'trialing', 'past_due'].includes(r.status)).length;

  return (
    <section className="card flex flex-col gap-3" data-testid="supporters-card">
      <header className="flex items-baseline justify-between gap-3">
        <span className="label">Supporters</span>
        <span className="text-text-secondary text-xs">
          {active} active · {data.length} ever
        </span>
      </header>
      {data.length === 0 ? (
        <p className="text-sm text-text-primary">No supporters yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="font-mono uppercase text-[10px] tracking-tight text-text-secondary">
                <th className="text-left font-normal pb-2">Player</th>
                <th className="text-left font-normal pb-2">Email</th>
                <th className="text-left font-normal pb-2">Status</th>
                <th className="text-right font-normal pb-2">Since</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.userId} className="border-t border-text-primary/10">
                  <td className="py-1.5">{r.label}</td>
                  <td className="py-1.5 break-all">{r.email ?? ''}</td>
                  <td className="py-1.5">
                    {r.status}
                    {r.cancelAtPeriodEnd ? ' (ending)' : ''}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.firstSupportedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button type="button" className="btn-outline" onClick={() => downloadCsv(data)}>
              Download CSV
            </button>
          </div>
        </>
      )}
    </section>
  );
}
