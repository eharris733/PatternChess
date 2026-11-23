import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../../auth/useAuth';
import { useSupporter } from '../../hooks/useSupporter';
import { useDrillsToday } from '../../hooks/useTrainingActivity';
import { useLimitReset } from '../../hooks/useDailyQuota';
import { DEFAULT_DAILY_GOALS, effectiveGoals } from '../../lib/dailyGoal';
import { detectTimezone, localDate } from '../../services/streakService';
import { openDailyLimit } from '../../state/supporterUnlockStore';
import { DailyLimitCountdown } from './DailyLimitCountdown';
import { LockIcon } from '../icons/LockIcon';
import { useT } from '../../i18n/useT';

/**
 * The sidebar's place for Supporter (replaced the "Support" link, 2026-11-23):
 * free players see today's positions against their limit ("Positions today
 * 7/10" + a bar), which turns into the countdown and "Go unlimited" once the
 * limit is used up. Clicking it trains while there's room and opens the
 * daily-limit sheet once locked. Supporters never see it (no limit), and it
 * stays out of the way while the counts load.
 *
 * Kept light on purpose (it renders on every page): only today's session
 * count, the supporter status and the profile, never the whole daily plan.
 */
export function DailyUsageMeter({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const supporter = useSupporter();
  const drills = useDrillsToday();
  const tz = profile?.timezone ?? detectTimezone();
  const resetsAt = useLimitReset(tz, localDate(tz));

  if (!profile || supporter.isPending || supporter.isSupporter || !drills.isSuccess) return null;
  const limit = effectiveGoals(profile.dailyGoals ?? DEFAULT_DAILY_GOALS, false).positionsPerDay;
  const used = Math.min(drills.data, limit);
  const locked = drills.data >= limit;
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const aria = t('limit.meterAria', { used: String(used), limit: String(limit) });

  const onClick = () => {
    if (locked) openDailyLimit({ kind: 'positions', limit, resetsAt });
    else navigate('/training');
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={aria}
        title={aria}
        data-testid="usage-meter"
        data-locked={locked ? 'true' : 'false'}
        className="mx-2 mb-2 flex flex-col items-center gap-1 py-2 text-text-primary hover:bg-accent/10 transition-colors"
      >
        {locked ? (
          <LockIcon className="h-4 w-4" />
        ) : (
          <span className="font-mono text-[10px] tabular-nums">
            {used}/{limit}
          </span>
        )}
        <span className="h-1 w-8 overflow-hidden border border-text-primary/30 bg-text-primary/10">
          <span className="block h-full bg-gold-dark" style={{ width: `${pct}%` }} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      data-testid="usage-meter"
      data-locked={locked ? 'true' : 'false'}
      className={clsx(
        'mx-2 mb-2 flex flex-col gap-1.5 border-2 px-3 py-2 text-left transition-colors',
        locked ? 'border-gold-dark bg-accent/10 hover:bg-accent/15' : 'border-text-primary/20 hover:border-accent',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="label">{locked ? t('limit.title.positions') : t('limit.meterLabel')}</span>
        {!locked && (
          <span className="font-mono text-xs tabular-nums text-text-primary" data-testid="usage-meter-count">
            {used}/{limit}
          </span>
        )}
      </span>
      <span className="h-1.5 overflow-hidden border border-text-primary/20 bg-text-primary/10">
        <span className="block h-full bg-gold-dark transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </span>
      {locked && (
        <>
          <DailyLimitCountdown resetsAt={resetsAt} testId="usage-meter-unlocks" />
          <span className="font-mono text-xs uppercase tracking-tight text-gold-dark" data-testid="usage-meter-cta">
            {t('limit.goUnlimited')}
          </span>
        </>
      )}
    </button>
  );
}
