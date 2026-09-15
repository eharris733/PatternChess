import clsx from 'clsx';
import { ChevronIcon } from '../icons/ChevronIcon';

/**
 * Native select styled like `.input`, with the platform chevron replaced by an
 * inline icon so the arrow gets real right padding and sits centred, matching
 * the search field beside it.
 */
export function VaultSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={clsx('input h-9 w-auto appearance-none pr-9 cursor-pointer', className)}
      >
        {children}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-90 text-text-primary" />
    </div>
  );
}
