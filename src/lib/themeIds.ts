/**
 * App/board theme ids and labels (pure, so the server can validate them).
 * Palettes live in src/styles/themes.css; the store is src/state/themeStore.ts.
 * The first five are the originals that `profiles.board_theme`'s CHECK
 * allows; every theme is stored in `profiles.theme` (migration 0005).
 */
export const BOARD_THEMES = [
  'default',
  'inverse',
  'frozen',
  'green',
  'purple',
  'walnut',
  'tournament',
  'slate',
  'rose',
  'midnight',
] as const;
export type BoardTheme = (typeof BOARD_THEMES)[number];

/** Themes the legacy `profiles.board_theme` column accepts. */
export const LEGACY_BOARD_THEMES: readonly BoardTheme[] = ['default', 'inverse', 'frozen', 'green', 'purple'];

export const BOARD_THEME_LABEL: Record<BoardTheme, string> = {
  default: 'Default',
  inverse: 'Inverse',
  frozen: 'Frozen',
  green: 'Green',
  purple: 'Purple',
  walnut: 'Walnut',
  tournament: 'Tournament',
  slate: 'Slate',
  rose: 'Rose',
  midnight: 'Midnight',
};

export function isBoardTheme(v: unknown): v is BoardTheme {
  return typeof v === 'string' && (BOARD_THEMES as readonly string[]).includes(v);
}
