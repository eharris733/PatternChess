import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { addDays, detectTimezone, localDate } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';

interface StreakBadgeProps {
  collapsed?: boolean;
}

/**
 * Compact streak indicator for the sidebar. Rendered inside the identity
 * cluster wrapper in SidebarNav (no standalone border/background). Visually
 * de-emphasizes if the streak has already lapsed (last drill > 1 day ago) —
 * the displayed number won't reset until the next drill.
 */
export function StreakBadge({ collapsed }: StreakBadgeProps) {
  const { profile } = useAuth();
  if (!profile) return null;

  const tz = profile.timezone ?? detectTimezone();
  const today = localDate(tz);
  const yesterday = addDays(today, -1);
  const last = profile.lastDrillLocalDate;
  const stale = !last || (last !== today && last !== yesterday);
  const days = profile.currentStreakDays;

  if (days === 0) return null;

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5',
        collapsed && 'justify-center',
        stale && 'opacity-50',
      )}
      title={
        stale
          ? `Streak: ${days} (resets on next drill — last drill ${last ?? 'never'})`
          : `${days}-day streak`
      }
    >
      <FlameIcon className="h-4 w-4 shrink-0" />
      {collapsed ? (
        <span className="font-mono font-semibold text-gold-dark text-xs tabular-nums">
          {days}
        </span>
      ) : (
        <span className="text-sm tabular-nums">
          <span className="font-mono font-semibold text-gold-dark">{days}</span>
          <span className="text-text-secondary"> day{days === 1 ? '' : 's'}</span>
        </span>
      )}
    </div>
  );
}
