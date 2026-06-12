interface CloseIconProps {
  className?: string;
  title?: string;
}

// A plain X that inherits currentColor so callers control the hue.
// Replaces Unicode multiplication-sign glyphs (the project renders no emoji in the UI).
export function CloseIcon({ className, title }: CloseIconProps) {
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
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
