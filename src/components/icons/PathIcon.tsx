interface IconProps {
  className?: string;
  title?: string;
}

/** A winding path with milestones — the progression ladder (/path). */
export function PathIcon({ className, title }: IconProps) {
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
      <path d="M5 20c0-4 14-3 14-7S5 10 5 6" strokeDasharray="2.5 3" />
      <circle cx="5" cy="20" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="19" cy="13" r="1.75" fill="currentColor" stroke="none" />
      <path d="M5 6V2.5l4 1.75L5 6" fill="currentColor" />
    </svg>
  );
}
