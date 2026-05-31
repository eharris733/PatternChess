interface IconProps {
  className?: string;
  title?: string;
}

/** Bar chart on an axis — sharp corners to match the brand's rounded-none look. */
export function AnalyticsIcon({ className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      {title && <title>{title}</title>}
      <path d="M4 4v16h16" />
      <rect x="7" y="12" width="3" height="5" />
      <rect x="12" y="9" width="3" height="8" />
      <rect x="17" y="6" width="3" height="11" />
    </svg>
  );
}
