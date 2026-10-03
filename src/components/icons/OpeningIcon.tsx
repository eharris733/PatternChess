interface IconProps {
  className?: string;
  title?: string;
}

/** A branching move tree — the main line and the moment you leave it. */
export function OpeningIcon({ className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      {title && <title>{title}</title>}
      {/* main line */}
      <path d="M6 20V4" />
      {/* the branch that leaves it */}
      <path d="M6 12c0-3 4-4 8-4h2" />
      <circle cx="6" cy="4" r="1.5" fill="currentColor" />
      <circle cx="6" cy="20" r="1.5" fill="currentColor" />
      <circle cx="18" cy="8" r="2" />
    </svg>
  );
}
