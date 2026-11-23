/**
 * Cosmetic rewards: the themes, piece sets and avatar items that path rungs
 * (/path, `PATH_RUNGS` in progression.ts) and a few achievements unlock, plus
 * a streak freeze at some rungs. Everything not listed here is free; an
 * active supporter has every reward. Unlocks are client-checked, like flair,
 * because they are cosmetic; the streak freeze is the one real grant and goes
 * through the server (`profile.claimPathReward`, which re-checks the rung).
 *
 * The reveal modal (src/components/rewards/RewardRevealHost.tsx) shows each
 * newly unlocked reward once, from a per-user seen-set.
 */
import type { AvatarPart } from './avatar';
import { AVATAR_OPTIONS } from './avatar';
import { BOARD_THEME_LABEL, type BoardTheme } from './themeIds';
import { PIECE_SET_INFO, type PieceSet } from './pieceSets';

export type RewardItem =
  | { kind: 'theme'; id: BoardTheme }
  | { kind: 'pieceSet'; id: PieceSet }
  | { kind: 'avatar'; part: AvatarPart; id: string }
  | { kind: 'streakFreeze' };

export type RewardUnlock = { rung: number } | { achievement: string };

export interface Reward {
  /** Stable id for the seen-set (never reuse one for a different item). */
  id: string;
  item: RewardItem;
  unlock: RewardUnlock;
}

export const REWARDS: readonly Reward[] = [
  { id: 'rung-10-walnut', item: { kind: 'theme', id: 'walnut' }, unlock: { rung: 10 } },
  { id: 'rung-25-chessnut', item: { kind: 'pieceSet', id: 'chessnut' }, unlock: { rung: 25 } },
  { id: 'rung-50-beanie', item: { kind: 'avatar', part: 'accessory', id: 'beanie' }, unlock: { rung: 50 } },
  { id: 'rung-50-freeze', item: { kind: 'streakFreeze' }, unlock: { rung: 50 } },
  { id: 'rung-100-tournament', item: { kind: 'theme', id: 'tournament' }, unlock: { rung: 100 } },
  { id: 'rung-200-fantasy', item: { kind: 'pieceSet', id: 'fantasy' }, unlock: { rung: 200 } },
  { id: 'rung-200-freeze', item: { kind: 'streakFreeze' }, unlock: { rung: 200 } },
  { id: 'rung-350-shades', item: { kind: 'avatar', part: 'accessory', id: 'shades' }, unlock: { rung: 350 } },
  { id: 'rung-350-sticker', item: { kind: 'pieceSet', id: 'sticker' }, unlock: { rung: 350 } },
  { id: 'rung-500-midnight', item: { kind: 'theme', id: 'midnight' }, unlock: { rung: 500 } },
  { id: 'rung-500-freeze', item: { kind: 'streakFreeze' }, unlock: { rung: 500 } },
  { id: 'rung-750-celtic', item: { kind: 'pieceSet', id: 'celtic' }, unlock: { rung: 750 } },
  { id: 'rung-1000-crown', item: { kind: 'avatar', part: 'accessory', id: 'crown' }, unlock: { rung: 1000 } },
  { id: 'rung-1000-spatial', item: { kind: 'pieceSet', id: 'spatial' }, unlock: { rung: 1000 } },
  { id: 'ach-streak-7-eyepatch', item: { kind: 'avatar', part: 'accessory', id: 'eyepatch' }, unlock: { achievement: 'streak-7' } },
  { id: 'ach-streak-30-rose', item: { kind: 'theme', id: 'rose' }, unlock: { achievement: 'streak-30' } },
  { id: 'ach-opening-master-10-slate', item: { kind: 'theme', id: 'slate' }, unlock: { achievement: 'opening-master-10' } },
  { id: 'ach-master-50-rhosgfx', item: { kind: 'pieceSet', id: 'rhosgfx' }, unlock: { achievement: 'master-50' } },
  { id: 'ach-endgame-rescue-5-mohawk', item: { kind: 'avatar', part: 'hair', id: 'mohawk' }, unlock: { achievement: 'endgame-rescue-5' } },
  { id: 'ach-invite-1-pink', item: { kind: 'avatar', part: 'hairColor', id: 'pink' }, unlock: { achievement: 'invite-1' } },
];

/** Rungs that also bank a streak freeze (the server's claimPathReward list). */
export const FREEZE_RUNGS: readonly number[] = REWARDS.flatMap((r) =>
  r.item.kind === 'streakFreeze' && 'rung' in r.unlock ? [r.unlock.rung] : [],
);

export interface RewardState {
  /** Lifetime positions trained (the /path metric, usePathProgress().trained). */
  trained: number;
  /** Earned achievement ids. */
  achievements: ReadonlySet<string>;
  isSupporter: boolean;
}

/** Whether a reward is earned. Supporters have every cosmetic; a streak freeze is earned only by the rung. */
export function rewardUnlocked(reward: Reward, state: RewardState): boolean {
  const earned = 'rung' in reward.unlock ? state.trained >= reward.unlock.rung : state.achievements.has(reward.unlock.achievement);
  if (reward.item.kind === 'streakFreeze') return earned;
  return earned || state.isSupporter;
}

function sameItem(a: RewardItem, b: RewardItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'avatar' && b.kind === 'avatar') return a.part === b.part && a.id === b.id;
  if (a.kind === 'streakFreeze') return true;
  return (a as { id: string }).id === (b as { id: string }).id;
}

/** The rewards that grant this item (empty = free for everyone). */
export function rewardsFor(item: RewardItem): Reward[] {
  return REWARDS.filter((r) => sameItem(r.item, item));
}

/** Whether a cosmetic can be picked: free, or unlocked by any reward that grants it. */
export function itemAvailable(item: RewardItem, state: RewardState): boolean {
  const gates = rewardsFor(item);
  return gates.length === 0 || gates.some((r) => rewardUnlocked(r, state));
}

/** What unlocks a locked item, for "Unlocks at 100 positions" hints. */
export function unlockHint(item: RewardItem, achievementTitle: (id: string) => string | null): string | null {
  const gate = rewardsFor(item)[0];
  if (!gate) return null;
  if ('rung' in gate.unlock) return `Unlocks at ${gate.unlock.rung.toLocaleString()} positions trained`;
  const title = achievementTitle(gate.unlock.achievement);
  return title ? `Unlocks with the ${title} achievement` : 'Unlocks with an achievement';
}

export function rewardsForRung(at: number): Reward[] {
  return REWARDS.filter((r) => 'rung' in r.unlock && r.unlock.rung === at);
}

/** Short player-facing name of the reward's item. */
export function rewardTitle(item: RewardItem): string {
  switch (item.kind) {
    case 'theme':
      return `${BOARD_THEME_LABEL[item.id]} theme`;
    case 'pieceSet':
      return `${PIECE_SET_INFO[item.id].label} pieces`;
    case 'avatar': {
      const label = AVATAR_OPTIONS[item.part].find((o) => o.id === item.id)?.label ?? item.id;
      if (item.part === 'hairColor') return `${label} hair for your avatar`;
      if (item.part === 'hair') return `${label} hairstyle for your avatar`;
      return `${label} for your avatar`;
    }
    case 'streakFreeze':
      return 'A streak freeze';
  }
}
