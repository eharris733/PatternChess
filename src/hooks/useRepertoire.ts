import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { buildRepertoireMap, type RepertoireColor, type RepertoireMove } from '../models/repertoire';
import { supabaseService } from '../services/supabaseService';

export const REPERTOIRE_QUERY_KEY = ['repertoire'] as const;

/** The user's repertoire as a `${color}|${epd}` lookup. */
export function useRepertoire() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...REPERTOIRE_QUERY_KEY, user?.id],
    queryFn: async () => buildRepertoireMap(await supabaseService.getRepertoire()),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
}

/** "Add to repertoire": save the move as the user's answer for the position. */
export function useAddToRepertoire() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: { color: RepertoireColor; fen: string; uci: string; san: string }) =>
      supabaseService.upsertRepertoireMove(input),
    onSuccess: (saved: RepertoireMove) => {
      qc.setQueryData<Map<string, RepertoireMove>>([...REPERTOIRE_QUERY_KEY, user?.id], (prev) => {
        const next = new Map(prev ?? []);
        next.set(`${saved.color}|${saved.epd}`, saved);
        return next;
      });
    },
  });
}
