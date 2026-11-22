import { create } from 'zustand';

/** A one-off streak event worth telling the player about. */
export type StreakNotice =
  | { kind: 'freezeUsed'; days: number; freezes: number }
  | { kind: 'freezeEarned'; days: number; freezes: number };

interface StreakNoticeState {
  notice: StreakNotice | null;
  show: (notice: StreakNotice) => void;
  clear: () => void;
}

/** In-memory only: shown on the dashboard's daily plan until dismissed or reload. */
export const useStreakNoticeStore = create<StreakNoticeState>((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
}));

export function streakNoticeText(n: StreakNotice): string {
  if (n.kind === 'freezeUsed') {
    return n.freezes === 1
      ? `A streak freeze saved your ${n.days}-day streak.`
      : `${n.freezes} streak freezes saved your ${n.days}-day streak.`;
  }
  return `${n.days} days in a row. You earned a streak freeze: miss a day and it keeps your streak alive.`;
}
