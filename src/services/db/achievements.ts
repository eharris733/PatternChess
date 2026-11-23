import { rpc } from '../../lib/api';

/** Records newly earned achievement ids (achievements.record; idempotent server-side). */
export async function recordAchievements(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await rpc('achievements.record', { ids });
}

export interface AchievementRarity {
  /** Players counted (trained at least once). */
  players: number;
  /** Achievement id → % of those players who have it (empty while the sample is small). */
  pct: Record<string, number>;
}

/** Share of players holding each achievement (functions/_shared/rpc/achievements.ts, cached 1 h). */
export async function getAchievementRarity(): Promise<AchievementRarity> {
  const data = await rpc<{ players?: number; pct?: Record<string, number> } | null>('achievements.rarity');
  return { players: data?.players ?? 0, pct: data?.pct ?? {} };
}
