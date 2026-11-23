import { create } from 'zustand';
import type { QuotaKind } from '../lib/dailyLimit';

/**
 * The "Unlock with Supporter" sheet (SupporterUnlockHost, mounted once in
 * AppShell). Anything locked behind Supporter — a theme, piece set, avatar
 * item, flair, the Obsessed plan — opens it with `openSupporterUnlock({ item })`
 * instead of a dead disabled button. A free player's daily limit opens the
 * same sheet as "Today's positions: done" with a countdown (`openDailyLimit`).
 */
export interface SupporterUnlockRequest {
  /** What the player tried to use, e.g. "Walnut theme" or "Obsessed plan". */
  item: string;
  /** How they could earn it without paying ("Unlocks at 100 positions trained"), if they can. */
  earnHint?: string | null;
  /** Set when a daily limit is what's locked: which one, and when it resets. */
  limit?: DailyLimitInfo | null;
}

export interface DailyLimitInfo {
  kind: QuotaKind;
  /** Today's limit for that kind (the count the copy names). */
  limit: number;
  /** Epoch ms of the reset (next local midnight). */
  resetsAt: number;
}

interface SupporterUnlockState {
  request: SupporterUnlockRequest | null;
  open: (r: SupporterUnlockRequest) => void;
  close: () => void;
}

export const useSupporterUnlockStore = create<SupporterUnlockState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export function openSupporterUnlock(r: SupporterUnlockRequest): void {
  useSupporterUnlockStore.getState().open(r);
}

/** "You've trained your 10 positions for today" + the countdown + Supporter. */
export function openDailyLimit(limit: DailyLimitInfo): void {
  useSupporterUnlockStore.getState().open({ item: '', limit });
}
