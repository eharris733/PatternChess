import { create } from 'zustand';

/**
 * The "Unlock with Supporter" sheet (SupporterUnlockHost, mounted once in
 * AppShell). Anything locked behind Supporter — a theme, piece set, avatar
 * item, flair, the Obsessed plan, training past the daily plan — opens it
 * with `openSupporterUnlock({ item })` instead of a dead disabled button.
 */
export interface SupporterUnlockRequest {
  /** What the player tried to use, e.g. "Walnut theme" or "Obsessed plan". */
  item: string;
  /** How they could earn it without paying ("Unlocks at 100 positions trained"), if they can. */
  earnHint?: string | null;
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
