import { create } from 'zustand';
import type { Translator } from '../i18n/useT';

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

export function streakNoticeText(n: StreakNotice, t: Translator): string {
  return n.kind === 'freezeUsed'
    ? t('streak.freezeUsed', { count: n.freezes, days: n.days })
    : t('streak.freezeEarned', { days: n.days });
}
