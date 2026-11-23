import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { useBlunderStats } from './useBlunderStats';
import { useSupporter } from './useSupporter';
import { pathProgress, pathRungs, type PathProgress, type PathRung } from '../lib/progression';
import { playSound } from '../lib/sounds';
import { useFeature } from './useFeature';

export interface PathState extends PathProgress {
  /** Lifetime positions trained (BlunderStats.reviewed). */
  trained: number;
  rungs: PathRung[];
  isSupporter: boolean;
  isPending: boolean;
}

/**
 * Progress up the /path ladder. Chimes once when a new rung is reached, using
 * a per-user high-water mark in localStorage (the first evaluation only seeds
 * it, so history never chimes), like the achievements seen-set.
 */
export function usePathProgress(): PathState {
  const { profile } = useAuth();
  const stats = useBlunderStats();
  const { isSupporter, isPending: supporterPending } = useSupporter();
  const trained = stats.data?.reviewed ?? 0;
  const rungs = pathRungs();
  const progress = pathProgress(trained, rungs);
  const pathOn = useFeature('path');

  useEffect(() => {
    // Unreleased for this user: no chime, and the high-water mark stays unseeded.
    if (!pathOn || !profile?.id || stats.isPending || !stats.data) return;
    const key = `pc:path-seen:${profile.id}`;
    let seen: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      seen = raw == null ? null : Number(raw);
    } catch {
      seen = null;
    }
    if (seen != null && progress.reached > seen) playSound('achievement');
    if (seen == null || progress.reached > seen) {
      try {
        localStorage.setItem(key, String(progress.reached));
      } catch {
        /* private mode */
      }
    }
  }, [pathOn, profile?.id, stats.isPending, stats.data, progress.reached]);

  return { ...progress, trained, rungs, isSupporter, isPending: stats.isPending || supporterPending };
}
