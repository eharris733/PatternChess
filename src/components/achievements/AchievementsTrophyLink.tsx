import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useAchievements } from '../../hooks/useAchievements';
import { TrophyIcon } from '../icons/TrophyIcon';

/** Badge text for unseen unlocks: 1, 2, then "3+". */
export function unseenBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count >= 3 ? '3+' : String(count);
}

/**
 * Trophy next to the profile name: opens /achievements, with a badge for
 * unlocks you haven't looked at yet (cleared when /achievements is visited).
 */
export function AchievementsTrophyLink({ className }: { className?: string }) {
  const { unseenIds } = useAchievements();
  const badge = unseenBadgeLabel(unseenIds.length);
  return (
    <Link
      to="/achievements"
      data-testid="achievements-link"
      aria-label={badge ? `Achievements, ${unseenIds.length} new` : 'Achievements'}
      title="Achievements"
      className={clsx(
        'relative inline-flex h-9 w-9 items-center justify-center border-2 border-text-primary/20 text-gold-dark transition-colors hover:border-accent',
        className,
      )}
    >
      <TrophyIcon className="h-5 w-5" />
      {badge && (
        <span
          data-testid="achievements-unseen"
          className="absolute -right-2 -top-2 min-w-[1.25rem] rounded-full bg-incorrect px-1 text-center font-mono text-[11px] font-semibold leading-5 text-white"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
