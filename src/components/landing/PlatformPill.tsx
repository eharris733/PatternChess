import type { DemoPlatform } from './UsernameInput';
import { CHESSCOM_GREEN_DARK, PlatformLogo } from '../icons/PlatformLogos';

interface Props {
  platform: DemoPlatform;
  active: boolean;
  onClick: () => void;
}

const META: Record<DemoPlatform, { label: string; accent: string }> = {
  lichess: { label: 'Lichess', accent: '#1A1A1A' },
  chesscom: { label: 'Chess.com', accent: CHESSCOM_GREEN_DARK },
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
          ? 'border-text-primary text-bg'
          : 'border-text-primary bg-transparent text-text-primary hover:bg-text-primary/5')
      }
      style={active ? { backgroundColor: meta.accent, color: '#F4F4F0' } : undefined}
    >
      {/* On the green active pill the pawn takes the text colour. */}
      <PlatformLogo platform={platform} mono={active} className="h-4 w-4 shrink-0" />
      <span>{meta.label}</span>
    </button>
  );
}
