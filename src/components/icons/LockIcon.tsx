interface LockIconProps {
  className?: string;
  title?: string;
}

/** Padlock for locked rewards and the locked Play step; inherits the text colour. */
export function LockIcon({ className, title }: LockIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
    >
      {title && <title>{title}</title>}
      <rect x="5" y="11" width="14" height="10" fill="currentColor" stroke="none" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
