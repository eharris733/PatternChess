import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { supabaseService } from '../services/supabaseService';
import { addDays, detectTimezone, localDate } from '../services/streakService';

export function useCompletedToday() {
  const { user, profile } = useAuth();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  return useQuery({
    queryKey: ['training', 'completedToday', user?.id, today],
    queryFn: () => supabaseService.hasTrainingSessionToday(today),
    enabled: !!user,
    staleTime: 60_000,
  });
}

/**
 * Number of drills (first-attempt position attempts) completed today, summed
 * across today's training sessions. Feeds the dashboard daily-habit card.
 */
export function useDrillsToday() {
  const { user, profile } = useAuth();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  return useQuery({
    queryKey: ['training', 'drillsToday', user?.id, today],
    queryFn: async () => {
      const sessions = await supabaseService.getTrainingSessionsSince(today);
      return sessions.reduce((sum, s) => sum + s.blundersAttempted, 0);
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useRecentTrainingSessions(limit = 10) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['training', 'recent', user?.id, limit],
    queryFn: () => supabaseService.getRecentTrainingSessions(limit),
    enabled: !!user,
  });
}

/**
 * Last `days` days of activity for the streak grid. Returns a map of
 * `YYYY-MM-DD` → boolean (true if any session that day had ≥1 correct attempt).
 */
export function useTrainingActivityWindow(days = 30) {
  const { user, profile } = useAuth();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  const since = addDays(today, -(days - 1));
  return useQuery({
    queryKey: ['training', 'activityWindow', user?.id, since, today],
    queryFn: async () => {
      const sessions = await supabaseService.getTrainingSessionsSince(since);
      const active = new Set<string>();
      for (const s of sessions) {
        if (s.blundersCorrect > 0) active.add(s.localDate);
      }
      const grid: { date: string; active: boolean }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = addDays(today, -i);
        grid.push({ date: d, active: active.has(d) });
      }
      return grid;
    },
    enabled: !!user,
  });
}

/**
 * This week's drilling (last 7 local days, today included): attempts and
 * correct answers summed across sessions. Feeds the dashboard trend chips.
 */
export function useWeeklyActivity() {
  const { user, profile } = useAuth();
  const tz = profile?.timezone ?? detectTimezone();
  const today = localDate(tz);
  const since = addDays(today, -6);
  return useQuery({
    queryKey: ['training', 'weekly', user?.id, since, today],
    queryFn: async () => {
      const sessions = await supabaseService.getTrainingSessionsSince(since);
      return sessions.reduce(
        (acc, s) => ({
          attempted: acc.attempted + s.blundersAttempted,
          correct: acc.correct + s.blundersCorrect,
        }),
        { attempted: 0, correct: 0 },
      );
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
