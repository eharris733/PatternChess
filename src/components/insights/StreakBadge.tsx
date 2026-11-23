import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { streakStatus } from '../../services/streakService';
import { FlameIcon } from '../icons/FlameIcon';
import { SnowflakeIcon } from '../icons/SnowflakeIcon';
import { useT } from '../../i18n/useT';

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
  const t = useT();
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
  const freezeTitle = freezes > 0 ? t('streakBadge.banked', { count: freezes }) : '';

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
          ? t('streakBadge.stale', { count: days, last: last ?? t('streakBadge.never') })
          : status.freezesNeeded > 0
            ? status.freezesNeeded === 1
              ? t('streakBadge.freezeCovers', { count: days })
              : t('streakBadge.freezesCover', { count: days, freezes: status.freezesNeeded })
            : `${t('streakBadge.streak', { count: days })}${freezeTitle}`
      }
    >
      <FlameIcon className="h-4 w-4 shrink-0" />
      {collapsed ? (
        <span className="font-mono font-semibold text-gold-dark text-xs tabular-nums">
          {days}
        </span>
      ) : (
        <span className="text-sm tabular-nums">
          {t.rich(
            'streakBadge.days',
            { count: <span className="font-mono font-semibold text-gold-dark">{days}</span> },
            days,
          )}
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
