import clsx from 'clsx';
import {
  Blunder,
  SPACED_REPETITION_DAYS,
  SR_BUCKET_LABEL,
  srBucket,
} from '../../models/blunder';

function formatRelative(d: Date, now: Date): string {
  const diffMs = d.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  let value: string;
  if (absMs >= day) value = `${Math.round(absMs / day)}d`;
  else if (absMs >= hour) value = `${Math.round(absMs / hour)}h`;
  else value = `${Math.max(1, Math.round(absMs / minute))}m`;
  return diffMs < 0 ? `${value} ago` : `in ${value}`;
}

export function PositionSrState({ blunder }: { blunder: Blunder }) {
  const total = SPACED_REPETITION_DAYS.length; // 7
  const filled = Math.min(blunder.cycleNumber, total);
  const bucket = srBucket(blunder);
  const stageLabel = SR_BUCKET_LABEL[bucket];

  const now = new Date();
  const lastSeen = blunder.lastDrilledAt ? formatRelative(blunder.lastDrilledAt, now) : null;
  const isOverdue = blunder.nextDrillAt !== null && blunder.nextDrillAt.getTime() < now.getTime();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="label">Repetition</span>
        <span className="text-xs font-mono text-text-secondary">
          {filled}/{total}
        </span>
      </div>
      <div className="flex items-center gap-1.5" aria-label={`${filled} of ${total} cycles completed`}>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              'w-3 h-3 rounded-full border',
              i < filled
                ? 'bg-accent-light border-accent-light'
                : 'border-surface-2 bg-transparent',
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>
          {stageLabel}
          {blunder.timesAttempted > 0 && (
            <>
              {' · '}
              <span className="font-mono">
                {blunder.timesCorrect}/{blunder.timesAttempted}
              </span>{' '}
              recalled
            </>
          )}
        </span>
        {lastSeen && (
          <span className={clsx('font-mono', isOverdue && 'text-mistake')}>
            {isOverdue ? 'overdue' : `seen ${lastSeen}`}
          </span>
        )}
      </div>
    </div>
  );
}
