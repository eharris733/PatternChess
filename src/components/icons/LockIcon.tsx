interface IconProps {
  className?: string;
  title?: string;
}

/** Padlock — a step that opens once the rest of the plan is done. */
export function LockIcon({ className, title }: IconProps) {
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
      <rect x="5" y="10.5" width="14" height="10" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" strokeLinecap="square" />
      <rect x="11" y="14" width="2" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}
