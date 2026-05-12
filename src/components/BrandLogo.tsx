import clsx from 'clsx';

type CommonProps = {
  className?: string;
  title?: string;
};

const COLORS = {
  goldLight: '#C49B2A',
  goldDark: '#8B6914',
  bg: '#1A1A1A',
  light: '#E8E8E8',
};

export function BrandMark({
  className,
  title = 'PatternChess',
  showTrajectory = true,
}: CommonProps & { showTrajectory?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <g transform="translate(20, 0)">
        <rect x="40" y="0" width="40" height="40" fill={COLORS.goldLight} />
        <rect x="40" y="40" width="40" height="40" fill={COLORS.goldDark} />
        <rect x="40" y="80" width="40" height="40" fill={COLORS.goldLight} />
        <rect x="0" y="80" width="40" height="40" fill={COLORS.goldDark} />
        <path
          d="M 0 80 L 80 80 M 40 0 L 40 120 M 40 40 L 80 40"
          stroke={COLORS.bg}
          strokeWidth="1.5"
          fill="none"
        />
        {showTrajectory && (
          <>
            <circle cx="20" cy="100" r="4" fill={COLORS.light} />
            <path
              d="M 20 100 Q 20 50 60 20"
              stroke={COLORS.light}
              strokeWidth="2"
              strokeDasharray="3 4"
              fill="none"
              opacity="0.75"
            />
            <circle cx="60" cy="20" r="4" fill={COLORS.light} />
          </>
        )}
      </g>
    </svg>
  );
}

export type BrandLockupSize = 'sm' | 'md' | 'lg' | 'xl';

const LOCKUP_SIZE: Record<
  BrandLockupSize,
  { mark: string; text: string; gap: string }
> = {
  sm: { mark: 'h-6 w-6', text: 'text-lg', gap: 'gap-1.5' },
  md: { mark: 'h-9 w-9', text: 'text-2xl', gap: 'gap-2' },
  lg: { mark: 'h-12 w-12', text: 'text-3xl', gap: 'gap-2.5' },
  xl: { mark: 'h-16 w-16', text: 'text-4xl', gap: 'gap-3' },
};

export function BrandLockup({
  className,
  title = 'PatternChess',
  variant = 'dark',
  size = 'md',
}: CommonProps & { variant?: 'dark' | 'light'; size?: BrandLockupSize }) {
  const s = LOCKUP_SIZE[size];
  const wordmarkColor = variant === 'dark' ? 'text-text-primary' : 'text-bg';
  const italicColor = variant === 'dark' ? 'text-gold-light' : 'text-gold-dark';
  return (
    <span
      className={clsx('inline-flex items-center', s.gap, className)}
      role="img"
      aria-label={title}
    >
      <BrandMark className={clsx('shrink-0', s.mark)} title={title} />
      <span
        className={clsx(
          'font-serif font-normal tracking-tight leading-none whitespace-nowrap',
          s.text,
          wordmarkColor,
        )}
      >
        Pattern
        <span className={clsx('italic', italicColor)}>Chess</span>
      </span>
    </span>
  );
}
