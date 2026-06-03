import { useEffect } from 'react';
import { create } from 'zustand';

export const BOARD_THEMES = ['default', 'inverse', 'frozen', 'green', 'purple'] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];

export const BOARD_THEME_LABEL: Record<BoardTheme, string> = {
  default: 'Default',
  inverse: 'Inverse',
  frozen: 'Frozen',
  green: 'Green',
  purple: 'Purple',
};

const STORAGE_KEY = 'patternchess.boardTheme';

function isBoardTheme(v: unknown): v is BoardTheme {
  return typeof v === 'string' && (BOARD_THEMES as readonly string[]).includes(v);
}

function readInitial(): BoardTheme {
  if (typeof window === 'undefined') return 'default';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isBoardTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return 'default';
}

/**
 * Whether this device has an explicit, persisted theme choice. Used to decide
 * who wins when the local theme and the signed-in profile's theme disagree: a
 * device that has chosen a theme keeps it (and syncs it up), so a stale/default
 * server value can never clobber the user's choice across sessions.
 */
export function hasStoredTheme(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return isBoardTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

function applyToDom(theme: BoardTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: BoardTheme;
  setTheme: (t: BoardTheme) => void;
}

const initial = readInitial();
applyToDom(initial);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  setTheme: (t) => {
    applyToDom(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
    set({ theme: t });
  },
}));

/**
 * Forces the document theme to "default" for the lifetime of the calling
 * component. On unmount, restores whatever theme the store currently holds.
 * Use on unauthenticated surfaces (login, landing) so they always render
 * on-brand regardless of the signed-in user's preference.
 */
export function useForceDefaultTheme() {
  useEffect(() => {
    applyToDom('default');
    return () => {
      applyToDom(useThemeStore.getState().theme);
    };
  }, []);
}
