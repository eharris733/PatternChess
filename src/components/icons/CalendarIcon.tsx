interface IconProps {
  className?: string;
  title?: string;
}

/** A calendar page — binding rings, header rule, and a marked day. */
export function CalendarIcon({ className, title }: IconProps) {
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
      <rect x="3.5" y="5" width="17" height="15.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
      <rect x="13.5" y="12.5" width="3.5" height="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
