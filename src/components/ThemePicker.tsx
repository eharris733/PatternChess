import clsx from 'clsx';
import { BOARD_THEMES, BOARD_THEME_LABEL, type BoardTheme } from '../state/themeStore';

interface ThemeSwatchPalette {
  bg: string;
  surface: string;
  textPrimary: string;
  accent: string;
  boardLight: string;
  boardDark: string;
}

const SWATCHES: Record<BoardTheme, ThemeSwatchPalette> = {
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
    boardLight: '#5A544A',
    boardDark: '#2C2820',
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
};

interface ThemePickerProps {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
}

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {BOARD_THEMES.map((theme) => {
        const palette = SWATCHES[theme];
        const active = value === theme;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(theme)}
            className={clsx(
              'flex flex-col gap-2 p-3 border-2 transition-all text-left',
              active
                ? 'border-text-primary shadow-card translate-x-0 translate-y-0'
                : 'border-text-primary/30 hover:border-text-primary hover:shadow-card-hover',
            )}
            style={{ backgroundColor: palette.surface }}
          >
            <MiniSwatch palette={palette} />
            <div
              className="font-mono uppercase text-xs tracking-tight"
              style={{ color: palette.textPrimary }}
            >
              {BOARD_THEME_LABEL[theme]}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MiniSwatch({ palette }: { palette: ThemeSwatchPalette }) {
  // A 4x4 mini-board next to a chrome strip showing bg + accent.
  const squares: string[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const isLight = (row + col) % 2 === 0;
      squares.push(isLight ? palette.boardLight : palette.boardDark);
    }
  }
  return (
    <div className="flex items-stretch gap-2 h-12">
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
