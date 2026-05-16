import type { DemoPlatform } from './UsernameInput';

interface Props {
  platform: DemoPlatform;
  active: boolean;
  onClick: () => void;
}

const META: Record<DemoPlatform, { label: string; accent: string; logo: JSX.Element }> = {
  lichess: {
    label: 'Lichess',
    accent: '#1A1A1A',
    logo: <LichessGlyph />,
  },
  chesscom: {
    label: 'Chess.com',
    accent: '#81B64C',
    logo: <ChesscomGlyph />,
  },
};

export function PlatformPill({ platform, active, onClick }: Props) {
  const meta = META[platform];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'inline-flex items-center gap-2 font-mono uppercase text-xs tracking-tight border-2 px-3 py-2 rounded-none transition-colors ' +
        (active
          ? 'border-[#1A1A1A] text-[#F4F4F0]'
          : 'border-[#1A1A1A] bg-transparent text-[#1A1A1A] hover:bg-[#1A1A1A]/5')
      }
      style={active ? { backgroundColor: meta.accent } : undefined}
    >
      <span
        className="inline-flex items-center justify-center h-4 w-4"
        aria-hidden="true"
      >
        {meta.logo}
      </span>
      <span>{meta.label}</span>
    </button>
  );
}

function LichessGlyph() {
  // Stylized knight silhouette in Lichess black/white.
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor">
      <path d="M5 21h14v-2H5v2zm2.5-3h9c-.3-3.5-2-5.5-4-6.5l1.5-4.5h-2L10.5 11C9 11.5 7.8 13 7.5 18zM12 3c.7 0 1.3.3 1.8.8L15 5l-1 1 .5 1H13l-.5-1H12l-.5 1h-1.5l.5-1L9.5 5l1.2-1.2C11.2 3.3 11.7 3 12.4 3H12z" />
    </svg>
  );
}

function ChesscomGlyph() {
  // Stylized knight in chess.com white.
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor">
      <path d="M14.6 3.5C14 3 13.4 3 12.6 3l-2 2c-1 1-1.5 2.5-1.5 4l-1.5 1.5L8.2 12l1.6-.5c0 1.4-.4 2.7-1.3 3.7L7.3 17H17v-2c0-3-1.2-5.7-2.8-7.5l.5-1.5L13.2 6l1.4-1.4c.4-.4.4-1 0-1.4l-.0 0z M5 19h14v2H5z" />
    </svg>
  );
}
