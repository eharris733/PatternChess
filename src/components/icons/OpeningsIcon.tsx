interface IconProps {
  className?: string;
  title?: string;
}

/** Open book — the repertoire. */
export function OpeningsIcon({ className, title }: IconProps) {
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
      <path d="M12 6.5C10.5 4.9 8.3 4 5.5 4H3v14h2.5c2.8 0 5 .9 6.5 2.5 1.5-1.6 3.7-2.5 6.5-2.5H21V4h-2.5C15.7 4 13.5 4.9 12 6.5Z" />
      <path d="M12 6.5v14" />
    </svg>
  );
}
