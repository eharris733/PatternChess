interface IconProps {
  className?: string;
  title?: string;
}

/** Snowflake — a banked streak freeze. Stroke icon; color via `currentColor`. */
export function SnowflakeIcon({ className, title }: IconProps) {
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
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      <path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
      <path d="M4.6 10.6 6.4 9.9l-.7-2.3M19.4 13.4l-1.8.7.7 2.3M4.6 13.4l1.8.7-.7 2.3M19.4 10.6l-1.8-.7.7-2.3" />
    </svg>
  );
}
