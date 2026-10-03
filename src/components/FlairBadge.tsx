import clsx from 'clsx';
import { flairById, type FlairIcon, type FlairTone } from '../lib/flair';
import { CalendarIcon } from './icons/CalendarIcon';
import { ClockIcon } from './icons/ClockIcon';
import { EndgameIcon } from './icons/EndgameIcon';
import { FlameIcon } from './icons/FlameIcon';
import { OpeningIcon } from './icons/OpeningIcon';
import { TrophyIcon } from './icons/TrophyIcon';

const ICON: Record<FlairIcon, (p: { className?: string }) => JSX.Element> = {
  flame: FlameIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  opening: OpeningIcon,
  endgame: EndgameIcon,
  trophy: TrophyIcon,
};

/** Pill colours per tone (full class strings so Tailwind keeps them). */
export const FLAIR_TONE_CLASS: Record<FlairTone, string> = {
  gold: 'text-gold-dark border-gold-dark',
  accent: 'text-accent border-accent',
  correct: 'text-correct border-correct',
  inaccuracy: 'text-inaccuracy border-inaccuracy',
  mistake: 'text-mistake border-mistake',
};

/** Avatar ring per tone. */
export const FLAIR_RING_CLASS: Record<FlairTone, string> = {
  gold: 'ring-gold-dark',
  accent: 'ring-accent',
  correct: 'ring-correct',
  inaccuracy: 'ring-inaccuracy',
  mistake: 'ring-mistake',
};

/** A player's chosen flair as a small pill. Renders nothing for unknown ids. */
export function FlairBadge({
  flair,
  size = 'sm',
  className,
}: {
  flair: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const def = flairById(flair);
  if (!def) return null;
  const Icon = ICON[def.icon];
  return (
    <span
      data-testid="flair-badge"
      className={clsx(
        'inline-flex items-center gap-1 border bg-surface font-mono uppercase tracking-tight whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        FLAIR_TONE_CLASS[def.tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {def.title}
    </span>
  );
}
