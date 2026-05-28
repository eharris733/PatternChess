interface IconProps {
  className?: string;
  title?: string;
}

/** Trophy — used on the cycle-complete screen (replaces the 🏆 emoji). */
export function TrophyIcon({ className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      {title && <title>{title}</title>}
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3" />
      <path d="M17 6h3v1a3 3 0 0 1-3 3" />
      <line x1="12" y1="13" x2="12" y2="16" />
      <path d="M10 16h4v4h-4z" />
      <line x1="8.5" y1="20" x2="15.5" y2="20" />
    </svg>
  );
}
