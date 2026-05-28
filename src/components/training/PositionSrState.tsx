import clsx from 'clsx';
import {
  Blunder,
  nextIntervalDaysIfSolved,
  SPACED_REPETITION_DAYS,
  SR_BUCKET_LABEL,
  SrBucket,
  srBucket,
} from '../../models/blunder';

const SR_BUCKET_PILL: Record<SrBucket, string> = {
  new: 'bg-gold-light text-[#1A1A1A] border-[#1A1A1A]',
  learning: 'bg-surface-3 text-text-secondary border-[#1A1A1A]',
  tryAgain: 'bg-mistake/20 text-mistake border-mistake/60',
  mastered: 'bg-correct/20 text-correct border-correct/60',
};

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

export function PositionSrState({
  blunder,
  showTryAgainLabel = false,
  showNextReview = false,
}: {
  blunder: Blunder;
  /**
   * Whether to render the literal "Try again" label when the blunder is in the
   * tryAgain bucket. When false, render the bucket the blunder would otherwise
   * be in (Learning / Mastered / New) — used to suppress the label outside of
   * the initial presentation in a subsequent cycle. Does not mutate SR state.
   */
  showTryAgainLabel?: boolean;
  /** Show the "solve it → next review in N days" cadence hint (pre-solve only). */
  showNextReview?: boolean;
}) {
  const total = SPACED_REPETITION_DAYS.length; // 7
  const filled = Math.min(blunder.cycleNumber, total);
  const rawBucket = srBucket(blunder);
  const displayBucket: SrBucket =
    rawBucket === 'tryAgain' && !showTryAgainLabel
      ? blunder.cycleNumber >= total
        ? 'mastered'
        : blunder.timesAttempted > 0
          ? 'learning'
          : 'new'
      : rawBucket;
  const stageLabel = SR_BUCKET_LABEL[displayBucket];

  const now = new Date();
  const lastSeen = blunder.lastDrilledAt ? formatRelative(blunder.lastDrilledAt, now) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="label">Repetition</span>
        <span
          className={clsx(
            'px-2 py-0.5 rounded-none font-mono text-[10px] uppercase tracking-tight border-2',
            SR_BUCKET_PILL[displayBucket],
          )}
        >
          {stageLabel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-1.5"
          aria-label={`${filled} of ${total} cycles completed`}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={clsx(
                'w-3 h-3 rounded-none border-2',
                i < filled ? 'bg-gold-dark border-[#1A1A1A]' : 'border-[#1A1A1A] bg-white',
              )}
            />
          ))}
        </div>
        <span className="text-xs font-mono text-text-secondary">
          cycle {filled}/{total}
        </span>
      </div>
      {showNextReview && (
        <p className="text-[11px] leading-tight text-text-secondary">
          Solve it → next review in {nextIntervalDaysIfSolved(blunder)} days
        </p>
      )}
      {(blunder.timesAttempted > 0 || lastSeen) && (
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {blunder.timesAttempted > 0 && (
              <>
                <span className="font-mono">
                  {blunder.timesCorrect}/{blunder.timesAttempted}
                </span>{' '}
                recalled
              </>
            )}
          </span>
          {lastSeen && <span className="font-mono">seen {lastSeen}</span>}
        </div>
      )}
    </div>
  );
}
