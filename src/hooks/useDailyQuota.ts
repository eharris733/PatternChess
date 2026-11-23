import { useEffect, useMemo, useState } from 'react';
import { useDailyPlan } from './useDailyPlan';
import { useSupporter } from './useSupporter';
import { FIXED_DAILY_LIMIT, nextLocalMidnight, type QuotaKind } from '../lib/dailyLimit';
import { openDailyLimit } from '../state/supporterUnlockStore';

export interface QuotaState {
  /** Done today. */
  used: number;
  /** Today's free limit. */
  limit: number;
  /** A free player used it all: this kind of training is locked until `resetsAt`. */
  locked: boolean;
  /** Today's count (or the supporter status) is still loading. */
  pending: boolean;
  /** What's left today for a free player; null = unlimited (supporters). */
  remaining: number | null;
}

/**
 * Free players' daily limits (src/lib/dailyLimit.ts), from the same counts as
 * the daily plan: positions = the Train goal's first attempts, openings =
 * opening drills reviewed today, endgames = play-outs finished today.
 * Supporters (and anything still loading) are never locked; /training and
 * /endgames re-check at the start of a drill.
 */
/**
 * When today's limits reset (next local midnight in `tz`, epoch ms). The
 * caller re-renders once it passes, so a `today` computed in render rolls
 * over and the locks lift without a reload.
 */
export function useLimitReset(tz: string, today: string): number {
  // `today` is a dep on purpose: a new local day means a new midnight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resetsAt = useMemo(() => nextLocalMidnight(tz).getTime(), [tz, today]);
  const [, rerender] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => rerender((n) => n + 1), Math.max(1000, resetsAt - Date.now() + 1000));
    return () => window.clearTimeout(id);
  }, [resetsAt]);
  return resetsAt;
}

export function useDailyQuota() {
  const plan = useDailyPlan();
  const supporter = useSupporter();
  const resetsAt = useLimitReset(plan.tz, plan.today);

  const unlimited = supporter.isSupporter;
  const ready = !supporter.isPending;
  const state = (used: number, limit: number, countPending: boolean): QuotaState => ({
    used,
    limit,
    locked: ready && !unlimited && !countPending && used >= limit,
    pending: !ready || (!unlimited && countPending),
    remaining: unlimited ? null : Math.max(0, limit - used),
  });

  return {
    unlimited,
    ready,
    resetsAt,
    positions: state(plan.drillsToday, plan.goals.positionsPerDay, plan.drillsPending),
    openings: state(plan.openingsToday, FIXED_DAILY_LIMIT.openings, plan.openingsPending),
    endgames: state(plan.playoutsToday, FIXED_DAILY_LIMIT.endgames, plan.scenariosPending),
  };
}

export type DailyQuota = ReturnType<typeof useDailyQuota>;

/**
 * `guard(kind)` → true when the player may start that kind of training; when
 * it's locked it opens the daily-limit sheet instead and returns false.
 */
export function useQuotaGuard() {
  const quota = useDailyQuota();
  const guard = (kind: QuotaKind): boolean => {
    const q = quota[kind];
    if (!q.locked) return true;
    openDailyLimit({ kind, limit: q.limit, resetsAt: quota.resetsAt });
    return false;
  };
  return { quota, guard };
}
