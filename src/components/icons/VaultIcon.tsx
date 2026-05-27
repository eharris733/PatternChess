interface IconProps {
  className?: string;
  title?: string;
}

/** A safe/vault — body, dial and needle. */
export function VaultIcon({ className, title }: IconProps) {
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
      <rect x="3.5" y="4" width="17" height="16" />
      <circle cx="12" cy="12" r="3.25" />
      <line x1="12" y1="12" x2="14.3" y2="14.3" />
    </svg>
  );
}
