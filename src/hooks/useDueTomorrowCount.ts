import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';

export function useDueTomorrowCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['blunders', 'dueTomorrow', user?.id],
    queryFn: () => supabaseService.getDueTomorrowCount({ userId: user?.id }),
    enabled: !!user,
  });
}
