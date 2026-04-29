import clsx from 'clsx';

export type FeedbackTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<FeedbackTone, string> = {
  success: 'bg-correct/15 text-correct border-correct/30',
  warning: 'bg-mistake/15 text-mistake border-mistake/30',
  danger: 'bg-incorrect/15 text-incorrect border-incorrect/30',
  info: 'bg-inaccuracy/15 text-inaccuracy border-inaccuracy/30',
  neutral: 'bg-surface-2 text-text-secondary border-surface-2',
};

export function FeedbackBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: FeedbackTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
