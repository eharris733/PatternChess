import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import type { Blunder } from '../models/blunder';
import { supabaseService } from '../services/supabaseService';

/** Live drills of one kind, keyed by id, with their SR state (mastery views). */
export function useDrillsOfKind(kind: 'opening' | 'endgame') {
  const { user } = useAuth();
  return useQuery({
    // Under ['blunders'] so finishing a drill session refreshes it.
    queryKey: ['blunders', 'kind', kind, user?.id],
    queryFn: async () => {
      const rows = await supabaseService.getDrillsOfKind(kind);
      return new Map<string, Blunder>(rows.map((b) => [b.id, b]));
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

/** Drills due now (the same rule as the due queue). */
export function isDue(b: Blunder, now: Date = new Date()): boolean {
  return !!b.nextDrillAt && b.nextDrillAt.getTime() <= now.getTime();
}
