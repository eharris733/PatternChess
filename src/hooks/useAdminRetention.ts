import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { rpc } from '../lib/api';

/** Of `eligible` users (signed up ≥ `day` days ago), `retained` trained on day `day` or later. */
export interface RetentionPoint {
  day: number;
  eligible: number;
  retained: number;
}

export interface RetentionCohort {
  /** `YYYY-MM` signup month, or `all`. */
  cohort: string;
  signups: number;
  trained: number;
  trained2Days: number;
  trained5Days: number;
  curve: RetentionPoint[];
}

export interface RetentionWeek {
  /** Monday, `YYYY-MM-DD`. */
  week: string;
  active: number;
  /** Active users who signed up before this week. */
  returning: number;
}

export interface AdminRetention {
  cohorts: RetentionCohort[];
  weeks: RetentionWeek[];
}

/** Signup-cohort retention + weekly returning users (`admin.retention` RPC, functions/_shared/rpc/admin.ts). */
export function useAdminRetention() {
  const { user } = useAuth();
  const admin = !!user && isAdminEmail(user.email);
  return useQuery({
    queryKey: ['admin', 'retention', user?.id],
    enabled: admin,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminRetention> => {
      return rpc<AdminRetention>('admin.retention');
    },
  });
}
