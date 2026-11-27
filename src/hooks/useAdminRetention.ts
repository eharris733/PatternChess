import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { rpc } from '../lib/api';

/** A retention window: active on any day `start`..`end` after signup (signup day = day 0). */
export interface RetentionWindow {
  key: 'd1' | 'd7' | 'd30' | 'w1' | 'w2' | 'w4' | 'w8';
  label: string;
  start: number;
  end: number;
}

/** Of `eligible` users (whose window has fully passed), `retained` were active inside it. */
export interface RetentionCount {
  eligible: number;
  retained: number;
}

export interface RetentionCohort {
  /** `YYYY-MM-DD` signup week (Monday), `YYYY-MM` signup month, or `all`. */
  cohort: string;
  signups: number;
  trained: number;
  trained2Days: number;
  trained5Days: number;
  windows: Record<RetentionWindow['key'], RetentionCount>;
}

export interface RetentionWeek {
  /** Monday, `YYYY-MM-DD`. */
  week: string;
  active: number;
  /** Active users who signed up before this week. */
  returning: number;
}

export interface AdminRetention {
  windows: RetentionWindow[];
  all: RetentionCohort;
  byWeek: RetentionCohort[];
  byMonth: RetentionCohort[];
  weeks: RetentionWeek[];
}

/** Signup-cohort retention + weekly returning users (`admin.retention` RPC, functions/_shared/rpc/admin.ts). */
export function useAdminRetention() {
  const { user } = useAuth();
  const admin = !!user && isAdminEmail(user.email);
  return useQuery({
    queryKey: ['admin', 'retention', 'v2', user?.id],
    enabled: admin,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminRetention> => {
      return rpc<AdminRetention>('admin.retention');
    },
  });
}
