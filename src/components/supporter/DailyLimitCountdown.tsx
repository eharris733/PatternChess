import clsx from 'clsx';
import { useCountdown } from '../../hooks/useCountdown';
import { formatCountdown } from '../../lib/dailyLimit';
import { LockIcon } from '../icons/LockIcon';
import { useT } from '../../i18n/useT';

/**
 * "Unlocks in 4h 12m" with a lock, ticking every second: what a free player
 * sees on any training entry their daily limit has locked (dailyLimit.ts).
 */
export function DailyLimitCountdown({
  resetsAt,
  className,
  testId = 'daily-limit-countdown',
}: {
  /** Epoch ms of the reset (useDailyQuota().resetsAt). */
  resetsAt: number;
  className?: string;
  testId?: string;
}) {
  const t = useT();
  const left = useCountdown(resetsAt);
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 font-mono text-xs tracking-tight text-text-primary', className)}
      data-testid={testId}
    >
      <LockIcon className="h-3.5 w-3.5 shrink-0" />
      <span>{t('limit.unlocksIn', { time: formatCountdown(left) })}</span>
    </span>
  );
}
