import clsx from 'clsx';
import { MasteryDots } from '../MasteryDots';
import {
  Blunder,
  nextIntervalDaysIfSolved,
  SPACED_REPETITION_DAYS,
  SR_BUCKET_LABEL,
  SrBucket,
  srBucket,
} from '../../models/blunder';
import { useLabel, useT, type Translator } from '../../i18n/useT';

export const SR_BUCKET_PILL: Record<SrBucket, string> = {
  new: 'bg-gold-light text-text-primary border-text-primary',
  learning: 'bg-surface-3 text-text-primary border-text-primary',
  tryAgain: 'bg-mistake/20 text-mistake border-mistake/60',
  mastered: 'bg-correct/20 text-correct border-correct/60',
};

function formatRelative(d: Date, now: Date, t: Translator): string {
  const diffMs = d.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  let value: string;
  if (absMs >= day) value = `${Math.round(absMs / day)}d`;
  else if (absMs >= hour) value = `${Math.round(absMs / hour)}h`;
  else value = `${Math.max(1, Math.round(absMs / minute))}m`;
  return diffMs < 0 ? t('sr.ago', { value }) : t('sr.in', { value });
}

/** The SR fields the widget reads — any trainable item shape qualifies, not just full Blunders. */
export type PositionSrStateItem = Pick<
  Blunder,
  'cycleNumber' | 'timesAttempted' | 'timesCorrect' | 'lastDrillFailed' | 'lastDrilledAt'
> &
  Partial<Pick<Blunder, 'nextDrillAt'>>;

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function PositionSrState({
  blunder,
  showTryAgainLabel = false,
  showNextReview = false,
  practiceDueAt = null,
}: {
  blunder: PositionSrStateItem;
  /**
   * Whether to render the literal "Try again" label when the blunder is in the
   * tryAgain bucket. When false, render the bucket the blunder would otherwise
   * be in (Learning / Mastered / New) — used to suppress the label outside of
   * the initial presentation in a subsequent cycle. Does not mutate SR state.
   */
  showTryAgainLabel?: boolean;
  /** Show the "solve it → next review in N days" cadence hint (pre-solve only). */
  showNextReview?: boolean;
  /**
   * Set after solving a position that wasn't due (trainingStore.practiceDueAt):
   * says mastery didn't move and when it will.
   */
  practiceDueAt?: Date | null;
}) {
  const t = useT();
  const label = useLabel();
  const total = SPACED_REPETITION_DAYS.length;
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
  const stageLabel = label('srBucket', displayBucket, SR_BUCKET_LABEL[displayBucket]);

  const now = new Date();
  // Not due yet: solving now is practice (advanceSr leaves the ladder alone).
  const notDueUntil = blunder.nextDrillAt && blunder.nextDrillAt.getTime() > now.getTime() ? blunder.nextDrillAt : null;
  const lastSeen = blunder.lastDrilledAt ? formatRelative(blunder.lastDrilledAt, now, t) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="label">{t('sr.repetition')}</span>
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
        <MasteryDots cycleNumber={blunder.cycleNumber} />
        <span className="text-xs font-mono text-text-primary">
          {t('sr.cycle', { done: filled, total })}
        </span>
      </div>
      {showNextReview && (
        <p className="text-[11px] leading-tight text-text-primary" data-testid="sr-next-review">
          {notDueUntil
            ? t('sr.notDueYet', { date: shortDate(notDueUntil) })
            : t('sr.nextReview', { count: nextIntervalDaysIfSolved(blunder) })}
        </p>
      )}
      {practiceDueAt && (
        <p className="text-[11px] leading-tight text-text-primary" data-testid="sr-practice">
          {t('sr.practiced', { date: shortDate(practiceDueAt) })}
        </p>
      )}
      {(blunder.timesAttempted > 0 || lastSeen) && (
        <div className="flex items-center justify-between text-xs text-text-primary">
          <span>
            {blunder.timesAttempted > 0 && (
              t.rich('sr.recalled', {
                correct: <span className="font-mono">{blunder.timesCorrect}</span>,
                total: <span className="font-mono">{blunder.timesAttempted}</span>,
              })
            )}
          </span>
          {lastSeen && <span className="font-mono">{t('sr.seen', { when: lastSeen })}</span>}
        </div>
      )}
    </div>
  );
}
