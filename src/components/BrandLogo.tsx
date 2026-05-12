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

export function BrandLockup({
  className,
  title = 'PatternChess',
  variant = 'dark',
}: CommonProps & { variant?: 'dark' | 'light' }) {
  const wordmarkColor = variant === 'dark' ? COLORS.light : COLORS.bg;
  const italicColor = variant === 'dark' ? COLORS.goldLight : COLORS.goldDark;
  const innerStroke = variant === 'dark' ? COLORS.bg : '#FFFFFF';
  const dotColor = variant === 'dark' ? COLORS.light : COLORS.bg;
  const trajectoryOpacity = variant === 'dark' ? 0.75 : 0.6;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 480 120"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <g transform="translate(20, 20)">
        <rect x="40" y="0" width="40" height="40" fill={COLORS.goldLight} />
        <rect x="40" y="40" width="40" height="40" fill={COLORS.goldDark} />
        <rect x="40" y="80" width="40" height="40" fill={COLORS.goldLight} />
        <rect x="0" y="80" width="40" height="40" fill={COLORS.goldDark} />
        <path
          d="M 0 80 L 80 80 M 40 0 L 40 120 M 40 40 L 80 40 M 40 80 L 80 80"
          stroke={innerStroke}
          strokeWidth="1.5"
          fill="none"
        />
        <circle cx="20" cy="100" r="4" fill={dotColor} />
        <path
          d="M 20 100 Q 20 50 60 20"
          stroke={dotColor}
          strokeWidth="2"
          strokeDasharray="3 4"
          fill="none"
          opacity={trajectoryOpacity}
        />
        <circle cx="60" cy="20" r="4" fill={dotColor} />
      </g>
      <text
        x="160"
        y="73"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="40"
        fontWeight="400"
        fill={wordmarkColor}
        letterSpacing="-0.5"
      >
        Pattern
        <tspan fontStyle="italic" fill={italicColor}>
          Chess
        </tspan>
      </text>
    </svg>
  );
}

export function BrandLogo({
  collapsed,
  className,
  variant = 'dark',
}: {
  collapsed?: boolean;
  className?: string;
  variant?: 'dark' | 'light';
}) {
  if (collapsed) {
    return <BrandMark className={clsx('h-7 w-7', className)} />;
  }
  return <BrandLockup variant={variant} className={clsx('h-9 w-auto', className)} />;
}
