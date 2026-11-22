interface IconProps {
  className?: string;
  title?: string;
}

/** A video lesson: a screen with a play triangle (/courses). */
export function CourseIcon({ className, title }: IconProps) {
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
      <rect x="2.5" y="4" width="19" height="13" />
      <path d="M10 8v5l4.5-2.5L10 8z" fill="currentColor" />
      <path d="M8 21h8" />
    </svg>
  );
}
