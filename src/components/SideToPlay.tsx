import clsx from 'clsx';

/**
 * Colour dot + "White to play" line shared by the trainer screens. `label`
 * overrides the default text (e.g. "You play White" on the Endgames tab).
 */
export function SideToPlay({
  color,
  label,
  className,
}: {
  color: 'white' | 'black';
  label?: string;
  className?: string;
}) {
  const name = color === 'white' ? 'White' : 'Black';
  return (
    <div className={clsx('flex items-center gap-2 text-text-primary', className)}>
      <span
        className={clsx(
          'w-3 h-3 rounded-full border-2 border-text-primary shrink-0',
          color === 'white' ? 'bg-surface' : 'bg-black',
        )}
      />
      <span className="font-medium">{label ?? `${name} to play`}</span>
    </div>
  );
}
