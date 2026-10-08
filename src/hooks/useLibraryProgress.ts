import { useAuth } from '../auth/useAuth';
import { useSyncStore } from '../state/syncStore';
import type { ProviderProgress } from '../services/syncService';

export type LibraryPhase = 'idle' | 'importing' | 'analyzing' | 'error';

export interface LibraryProgress {
  phase: LibraryPhase;
  /** Games inserted (or fetched, while still fetching) / the fetch target, when known. */
  imported: number;
  importTotal: number | null;
  /** Games analyzed so far / games this sync is analyzing. */
  analyzed: number;
  analyzeTotal: number;
  rateLimited: boolean;
}

/**
 * Sync progress summed over the linked providers — the same arithmetic as
 * the onboarding import screen, for pages that wait on new games.
 */
export function useLibraryProgress(): LibraryProgress {
  const { profile } = useAuth();
  const providers = useSyncStore((s) => s.providers);
  const active: ProviderProgress[] = [];
  if (profile?.lichessUsername) active.push(providers.lichess);
  if (profile?.chesscomUsername) active.push(providers.chesscom);

  const phases = active.map((p) => p.phase);
  const phase: LibraryPhase = phases.some((p) => p === 'fetching' || p === 'inserting')
    ? 'importing'
    : phases.includes('analyzing')
      ? 'analyzing'
      : phases.includes('error')
        ? 'error'
        : 'idle';

  const importing = active.filter((p) => p.phase === 'fetching' || p.phase === 'inserting');
  const imported = importing.reduce((sum, p) => sum + Math.max(p.inserted, p.fetched), 0);
  const importTotal = importing.every((p) => p.total != null)
    ? importing.reduce((sum, p) => sum + (p.total ?? 0), 0)
    : null;

  return {
    phase,
    imported,
    importTotal: importTotal && importTotal > 0 ? importTotal : null,
    analyzed: active.reduce((sum, p) => sum + p.analyzeGameIndex, 0),
    analyzeTotal: active.reduce((sum, p) => sum + p.analyzeGamesTotal, 0),
    rateLimited: active.some((p) => p.rateLimited),
  };
}
