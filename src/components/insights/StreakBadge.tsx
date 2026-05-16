import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { addDays, detectTimezone, localDate } from '../../services/streakService';

interface StreakBadgeProps {
  collapsed?: boolean;
}

/**
 * Compact streak indicator for the sidebar. Shows the user's current streak
 * with a flame icon. Visually de-emphasizes if the streak has already lapsed
 * (last drill > 1 day ago) — the displayed number won't reset until the next
 * drill.
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
        'mx-2 mb-1 flex items-center gap-3 px-3 py-2 rounded-none border-2 border-[#1A1A1A] bg-surface-3',
        stale && 'opacity-50',
      )}
      title={
        stale
          ? `Streak: ${days} (resets on next drill — last drill ${last ?? 'never'})`
          : `${days}-day streak`
      }
    >
      <span className="text-base shrink-0" aria-hidden>🔥</span>
      {!collapsed && (
        <span className="text-sm tabular-nums">
          <span className="font-mono font-semibold text-gold-dark">{days}</span>
          <span className="text-text-secondary"> day{days === 1 ? '' : 's'}</span>
        </span>
      )}
    </div>
  );
}
