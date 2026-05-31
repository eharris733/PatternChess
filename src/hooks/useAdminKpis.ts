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
}

export interface AdminKpis {
  totals: AdminKpiTotals;
  activity: AdminKpiActivity;
  signupsByDay: AdminKpiSignupDay[];
  platforms: AdminKpiPlatform[];
  recentSignups: AdminKpiSignup[];
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
