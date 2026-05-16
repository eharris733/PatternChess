import clsx from 'clsx';

export type FeedbackTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<FeedbackTone, string> = {
  success: 'bg-correct/15 text-correct border-correct/40',
  warning: 'bg-mistake/15 text-mistake border-mistake/40',
  danger: 'bg-incorrect/15 text-incorrect border-incorrect/40',
  info: 'bg-inaccuracy/15 text-inaccuracy border-inaccuracy/40',
  neutral: 'bg-surface-3 text-[#1A1A1A] border-[#1A1A1A]',
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
        'inline-flex items-center gap-2 px-3 py-1 rounded-none font-mono text-xs uppercase tracking-tight border-2',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
