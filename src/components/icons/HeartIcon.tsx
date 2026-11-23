interface HeartIconProps {
  className?: string;
  title?: string;
}

// Picks up the active theme's accent colors so the heart follows the palette.
const COLORS = {
  goldLight: 'rgb(var(--gold-light))',
  goldDark: 'rgb(var(--gold-dark))',
};

/** Supporter mark (flair, leaderboard rows, /supporter). */
export function HeartIcon({ className, title }: HeartIconProps) {
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
        d="M12 21s-7.5-4.6-9.5-9.4C1.2 8.4 3.2 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.7 0 5.7 3.9 4.4 7.1C19.5 16.4 12 21 12 21z"
        fill={COLORS.goldDark}
      />
      <path d="M7 7.5c-1.6 0-2.6 1.5-2.2 3.1.2.7.5 1.3 1 1.9.4-1.9 1.2-3.6 2.6-4.8-.4-.1-.9-.2-1.4-.2z" fill={COLORS.goldLight} />
    </svg>
  );
}
