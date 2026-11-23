import clsx from 'clsx';
import { useT } from '../i18n/useT';
import { openSupporterUnlock } from '../state/supporterUnlockStore';
import { BOARD_THEMES, BOARD_THEME_LABEL, type BoardTheme } from '../state/themeStore';
import { LockIcon } from './icons/LockIcon';

export interface ThemeSwatchPalette {
  bg: string;
  surface: string;
  textPrimary: string;
  accent: string;
  boardLight: string;
  boardDark: string;
}

/** Static copies of src/styles/themes.css, so a swatch previews a theme without switching to it. */
export const THEME_SWATCHES: Record<BoardTheme, ThemeSwatchPalette> = {
  default: {
    bg: '#F4F4F0',
    surface: '#FFFFFF',
    textPrimary: '#1A1A1A',
    accent: '#C49B2A',
    boardLight: '#F0D9B5',
    boardDark: '#C0AD90',
  },
  inverse: {
    bg: '#1A1A1A',
    surface: '#262624',
    textPrimary: '#F4F4F0',
    accent: '#E4B842',
    boardLight: '#8A8275',
    boardDark: '#5A544A',
  },
  frozen: {
    bg: '#EAF1F8',
    surface: '#FFFFFF',
    textPrimary: '#0F2235',
    accent: '#3A8FD0',
    boardLight: '#DDE9F5',
    boardDark: '#3A8FD0',
  },
  green: {
    bg: '#EEF3EA',
    surface: '#FFFFFF',
    textPrimary: '#1A2E1A',
    accent: '#5BA85B',
    boardLight: '#E1ECD9',
    boardDark: '#5BA85B',
  },
  purple: {
    bg: '#F0EBF5',
    surface: '#FFFFFF',
    textPrimary: '#221636',
    accent: '#8B5BC9',
    boardLight: '#E6DCEF',
    boardDark: '#8B5BC9',
  },
  walnut: {
    bg: '#F6F0E6',
    surface: '#FFFCF6',
    textPrimary: '#2B1E14',
    accent: '#BE7A3C',
    boardLight: '#E8C99B',
    boardDark: '#A26A3F',
  },
  tournament: {
    bg: '#F2F3EE',
    surface: '#FFFFFF',
    textPrimary: '#1E261C',
    accent: '#769656',
    boardLight: '#EEEED2',
    boardDark: '#769656',
  },
  slate: {
    bg: '#ECEEF1',
    surface: '#FFFFFF',
    textPrimary: '#1C2128',
    accent: '#6A84A6',
    boardLight: '#D9DEE5',
    boardDark: '#7D8A9A',
  },
  rose: {
    bg: '#F8EEF0',
    surface: '#FFFFFF',
    textPrimary: '#3A1824',
    accent: '#CE6688',
    boardLight: '#F6DDE3',
    boardDark: '#C97B92',
  },
  midnight: {
    bg: '#101522',
    surface: '#1A2030',
    textPrimary: '#E8ECF4',
    accent: '#9CB6F6',
    boardLight: '#9AA8C4',
    boardDark: '#56658A',
  },
};

interface ThemePickerProps {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
  /** Reward themes the player hasn't unlocked (src/lib/rewards.ts) and what unlocks each. */
  locked?: (theme: BoardTheme) => string | null;
}

export function ThemePicker({ value, onChange, locked }: ThemePickerProps) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="theme-picker">
      {BOARD_THEMES.map((theme) => {
        const palette = THEME_SWATCHES[theme];
        const active = value === theme;
        const lockHint = locked?.(theme) ?? null;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={active}
            aria-label={lockHint ? `${BOARD_THEME_LABEL[theme]} (locked: ${lockHint})` : undefined}
            data-testid={`theme-option-${theme}`}
            data-locked={lockHint != null || undefined}
            onClick={() =>
              lockHint
                ? openSupporterUnlock({
                    item: t('supporterUnlock.theme', { name: BOARD_THEME_LABEL[theme] }),
                    earnHint: t('supporterUnlock.orEarn', { hint: lockHint }),
                  })
                : onChange(theme)
            }
            className={clsx(
              'relative flex flex-col gap-2 p-3 border-2 transition-all text-left',
              active
                ? 'border-text-primary shadow-card translate-x-0 translate-y-0'
                : 'border-text-primary/30 hover:border-text-primary hover:shadow-card-hover',
              lockHint && 'hover:border-text-primary/60 hover:shadow-none',
            )}
            style={{ backgroundColor: palette.surface }}
          >
            <MiniSwatch palette={palette} dim={lockHint != null} />
            <div
              className="font-mono uppercase text-xs tracking-tight flex items-center gap-1"
              style={{ color: palette.textPrimary }}
            >
              {lockHint && <LockIcon className="h-3.5 w-3.5" />}
              {BOARD_THEME_LABEL[theme]}
            </div>
            {lockHint && (
              <div className="text-[11px] leading-tight" style={{ color: palette.textPrimary }}>
                {lockHint}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function MiniSwatch({ palette, dim = false }: { palette: ThemeSwatchPalette; dim?: boolean }) {
  // A 4x4 mini-board next to a chrome strip showing bg + accent.
  const squares: string[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const isLight = (row + col) % 2 === 0;
      squares.push(isLight ? palette.boardLight : palette.boardDark);
    }
  }
  return (
    <div className={clsx('flex items-stretch gap-2 h-12', dim && 'opacity-50')}>
      <div
        className="grid grid-cols-4 grid-rows-4 w-12 h-12 shrink-0 border"
        style={{ borderColor: palette.textPrimary }}
      >
        {squares.map((color, i) => (
          <div key={i} style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="flex flex-col flex-1 gap-1 justify-center">
        <div className="h-2.5 w-full" style={{ backgroundColor: palette.bg, border: `1px solid ${palette.textPrimary}33` }} />
        <div className="h-2.5 w-2/3" style={{ backgroundColor: palette.accent }} />
        <div className="h-2.5 w-1/2" style={{ backgroundColor: palette.textPrimary }} />
      </div>
    </div>
  );
}
