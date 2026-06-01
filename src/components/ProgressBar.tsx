import clsx from 'clsx';

export function ProgressBar({
  current,
  total,
  label,
  className,
}: {
  current: number;
  total: number;
  label?: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  return (
    <div className={clsx('w-full', className)}>
      {label && (
        <div className="flex justify-between text-xs text-text-secondary mb-1">
          <span>{label}</span>
          <span className="font-mono">
            {current}/{total}
          </span>
        </div>
      )}
      <div className="w-full h-2 rounded-none bg-text-primary/10 overflow-hidden border border-text-primary/20">
        <div
          className="h-full bg-gold-dark rounded-none transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
