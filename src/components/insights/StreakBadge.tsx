import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { streakStatus } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';

interface StreakBadgeProps {
  collapsed?: boolean;
}

/**
 * Compact streak indicator for the sidebar. Rendered inside the identity
 * cluster wrapper in SidebarNav (no standalone border/background). Visually
 * de-emphasizes if the streak has already lapsed (more missed days than banked
 * freezes) — the displayed number won't reset until the next drill. Banked
 * streak freezes show as snowflakes.
 */
export function StreakBadge({ collapsed }: StreakBadgeProps) {
  const { profile } = useAuth();
  if (!profile) return null;

  const last = profile.lastDrillLocalDate;
  const status = streakStatus({
    currentStreakDays: profile.currentStreakDays,
    lastDrillLocalDate: last,
    timezone: profile.timezone,
    streakFreezes: profile.streakFreezes,
  });
  const stale = !status.alive;
  const days = profile.currentStreakDays;
  const freezes = profile.streakFreezes;
  const freezeTitle = freezes > 0 ? ` · ${freezes} streak freeze${freezes === 1 ? '' : 's'} banked` : '';

  if (days === 0) return null;

  return (
    <div
      className={clsx(
        'flex items-center py-2.5',
        collapsed ? 'justify-center gap-1 px-0' : 'gap-3 px-3',
        stale && 'opacity-50',
      )}
      title={
        stale
          ? `Streak: ${days} (resets on next drill — last drill ${last ?? 'never'})`
          : status.freezesNeeded > 0
            ? `${days}-day streak · train today and ${status.freezesNeeded === 1 ? 'a freeze covers' : `${status.freezesNeeded} freezes cover`} the missed ${status.freezesNeeded === 1 ? 'day' : 'days'}`
            : `${days}-day streak${freezeTitle}`
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
          <span className="text-text-primary"> day{days === 1 ? '' : 's'}</span>
        </span>
      )}
      {!collapsed && freezes > 0 && !stale && (
        <span className="ml-auto inline-flex items-center gap-0.5 text-accent" data-testid="streak-freezes">
          {Array.from({ length: freezes }, (_, i) => (
            <SnowflakeIcon key={i} className="h-3.5 w-3.5" />
          ))}
        </span>
      )}
    </div>
  );
}
