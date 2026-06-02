import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { supabase } from '../lib/supabase';

export interface AdminKpiTotals {
  signups: number;
  connected: number;
  synced: number;
  foundBlunders: number;
  trained: number;
}

export interface AdminKpiActivity {
  dau: number;
  wau: number;
  mau: number;
}

export interface AdminKpiSignupDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface AdminKpiPlatform {
  platform: string;
  users: number;
  games: number;
}

export interface AdminKpiSignup {
  email: string | null;
  displayName: string | null;
  createdAt: string;
  connected: boolean;
  synced: boolean;
  foundBlunders: boolean;
  trained: boolean;
  games: number;
  blunders: number;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  trainingSessions: number;
  lastSessionAt: string | null;
  lastActive: string | null;
}

export interface AdminLandingFunnel {
  views: number; // human (non-bot) landing visitors
  entered: number; // visitors who entered a chess.com/lichess username
  converted: number; // ...who then created an account
}

export interface AdminLead {
  username: string;
  platform: string | null;
  attempts: number;
  lastSeen: string;
  converted: boolean;
}

export interface AdminTrainingTopTrainee {
  email: string | null;
  displayName: string | null;
  sessions: number;
}

export interface AdminTrainingAnalytics {
  avgDurationSeconds: number;
  medianDurationSeconds: number;
  sessionsWithDuration: number;
  sessionsByDay: AdminKpiSignupDay[];
  topTrainees: AdminTrainingTopTrainee[];
}

export interface AdminKpis {
  totals: AdminKpiTotals;
  activity: AdminKpiActivity;
  signupsByDay: AdminKpiSignupDay[];
  platforms: AdminKpiPlatform[];
  recentSignups: AdminKpiSignup[];
  // Added by the landing_funnel migration. Optional so the page still renders
  // against the older RPC until that migration is applied.
  landingFunnel?: AdminLandingFunnel;
  viewsByDay?: AdminKpiSignupDay[];
  leads?: AdminLead[];
  // Added by the admin_drilldown migration.
  trainingAnalytics?: AdminTrainingAnalytics;
}

export function useAdminKpis() {
  const { user } = useAuth();
  const admin = isAdminEmail(user?.email);
  return useQuery({
    queryKey: ['admin', 'kpis', user?.id],
    enabled: !!user && admin,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminKpis> => {
      const { data, error } = await supabase.rpc('admin_kpis');
      if (error) throw error;
      return data as AdminKpis;
    },
  });
}
