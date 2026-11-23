import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import type { BlunderPhase, DrillKind } from '../models/blunder';
import { supabaseService } from '../services/supabaseService';

/** Positions per "Practice ahead" batch. */
export const PRACTICE_AHEAD_BATCH = 10;
/** Rows fetched when a client-side focus (motif, opening, situation) narrows the batch afterwards. */
export const PRACTICE_AHEAD_FILTER_POOL = 200;

export interface UpcomingParams {
  kind?: DrillKind | null;
  excludeKind?: DrillKind | null;
  phase?: BlunderPhase | null;
  limit?: number;
}

/**
 * "Practice ahead": the drills due next (not due yet), soonest first. Keyed
 * under ['blunders'] so finishing a session refreshes it, and never persisted
 * (src/lib/queryPersist.ts), like the due queue.
 */
export function useUpcomingBlunders(params: UpcomingParams, opts: { enabled?: boolean } = {}) {
  const { user } = useAuth();
  const p = {
    kind: params.kind ?? null,
    excludeKind: params.excludeKind ?? null,
    phase: params.phase ?? null,
    limit: params.limit ?? PRACTICE_AHEAD_BATCH,
  };
  return useQuery({
    queryKey: ['blunders', 'upcoming', user?.id, p.kind, p.excludeKind, p.phase, p.limit],
    queryFn: () => supabaseService.getUpcomingBlunders(p),
    enabled: !!user && (opts.enabled ?? true),
  });
}
