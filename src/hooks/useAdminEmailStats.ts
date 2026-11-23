import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { rpc } from '../lib/api';

export interface AdminEmailKind {
  /** A notifier Worker email kind (welcome, ready, streak_at_risk, daily_plan, weekly_report). */
  kind: string;
  /** Sent in the last 30 days. */
  sent: number;
  /** Of those, the user trained within 24h of the send. */
  returned: number;
}

export interface ReturnRateGroup {
  /** Accounts at least a week old. */
  accounts: number;
  /** Of those, trained in the last 7 days. */
  trained: number;
}

export interface AdminEmailStats {
  optedIn: number;
  /** Opted in with an address we can send to. */
  reachable: number;
  /** No address at all (Lichess sign-ins that never added one). */
  noAddress: number;
  prompted: number;
  confirmPending: number;
  unsubscribed30d: number;
  returnRate: { reachable: ReturnRateGroup; other: ReturnRateGroup };
  kinds: AdminEmailKind[];
}

/** Email reach, unsubscribes and send → return rates (`admin.emailStats` RPC, functions/_shared/rpc/admin.ts). */
export function useAdminEmailStats() {
  const { user } = useAuth();
  const admin = !!user && isAdminEmail(user.email);
  return useQuery({
    queryKey: ['admin', 'emailStats', user?.id],
    enabled: admin,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<AdminEmailStats> => {
      return rpc<AdminEmailStats>('admin.emailStats');
    },
  });
}
