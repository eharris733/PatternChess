import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronIcon } from './icons/ChevronIcon';

/**
 * "Back to X" at the top of a sub-page. The only back-link style: a real
 * tap target with full-contrast text (the old 12px greyed "← Back" was easy
 * to miss).
 */
export function BackLink({ to, label, className }: { to: string; label: string; className?: string }) {
  return (
    <Link
      to={to}
      data-testid="back-link"
      className={clsx(
        'inline-flex min-h-[2.5rem] items-center gap-2 self-start border-2 border-text-primary/30 px-3 py-1.5',
        'font-mono text-sm font-semibold uppercase tracking-tight text-text-primary',
        'transition-colors hover:border-text-primary hover:bg-accent/10',
        className,
      )}
    >
      <ChevronIcon className="h-4 w-4 shrink-0 rotate-180" />
      {label}
    </Link>
  );
}
