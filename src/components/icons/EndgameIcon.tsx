interface IconProps {
  className?: string;
  title?: string;
}

/** King with a cross above a pawn — the endgame's protagonists. */
export function EndgameIcon({ className, title }: IconProps) {
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
      {/* king (left): cross + head + base */}
      <path d="M7 3v3M5.5 4.5h3" />
      <circle cx="7" cy="9" r="2" />
      <path d="M5 20v-3.5c0-1.5.75-2.5 2-2.5s2 1 2 2.5V20" />
      {/* pawn (right): head + base */}
      <circle cx="17" cy="11.5" r="1.75" />
      <path d="M15.5 20v-2.5c0-1.25.6-2 1.5-2s1.5.75 1.5 2V20" />
      {/* shared baseline */}
      <path d="M3.5 20.5h17" />
    </svg>
  );
}
