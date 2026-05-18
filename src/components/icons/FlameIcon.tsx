interface FlameIconProps {
  className?: string;
  title?: string;
}

const COLORS = {
  goldLight: '#C49B2A',
  goldDark: '#8B6914',
};

export function FlameIcon({ className, title }: FlameIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      {title && <title>{title}</title>}
      <path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 0 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        fill={COLORS.goldDark}
      />
      <path
        d="M12 19.5a3 3 0 0 1-3-3c0-.8.3-1.5.8-2 .4.6 1 1 1.7 1 .8 0 1.4-.5 1.6-1.2.5 1.1 1.9 2 1.9 3.4 0 1.6-1.4 2.8-3 2.8z"
        fill={COLORS.goldLight}
      />
    </svg>
  );
}
