import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

export function useBlunderStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blunders', 'stats', user?.id],
    queryFn: () => supabaseService.getBlunderStats(),
    enabled: !!user,
    staleTime: 30_000,
  });
}
