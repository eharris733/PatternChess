import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { supabase } from '../lib/supabase';

export type AdminUserCategory =
  | 'signups'
  | 'connected'
  | 'synced'
  | 'foundBlunders'
  | 'trained'
  | 'dau'
  | 'wau'
  | 'mau';

export interface AdminUserRow {
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lichessUsername: string | null;
  chesscomUsername: string | null;
  connected: boolean;
  synced: boolean;
  foundBlunders: boolean;
  trained: boolean;
  games: number;
  blunders: number;
  trainingSessions: number;
  lastSessionAt: string | null;
  lastActive: string | null;
}

export function useAdminUserList(category: AdminUserCategory | null) {
  const { user } = useAuth();
  const admin = isAdminEmail(user?.email);
  return useQuery({
    queryKey: ['admin', 'userList', user?.id, category],
    enabled: !!user && admin && !!category,
    staleTime: 60_000,
    queryFn: async (): Promise<AdminUserRow[]> => {
      const { data, error } = await supabase.rpc('admin_user_list', { category });
      if (error) throw error;
      return (data ?? []) as AdminUserRow[];
    },
  });
}
