import { TrendUpIcon } from '../icons/TrendUpIcon';

/**
 * Green "+N this week" chip. Render only for a positive delta — these exist
 * to make good trends visible, so zero and negative stay silent.
 */
export function TrendChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-correct/50 bg-correct/10 text-correct font-mono text-[10px] uppercase tracking-tight">
      <TrendUpIcon className="h-3 w-3" />
      {children}
    </span>
  );
}
