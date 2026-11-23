interface IconProps {
  className?: string;
  title?: string;
}

/**
 * An open book with a pawn on the left page: opening theory ("the book"),
 * readable at 16px next to the endgame's king-and-pawn.
 */
export function OpeningIcon({ className, title }: IconProps) {
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
      {/* two pages meeting at the spine */}
      <path d="M12 7c-2.2-1.6-5.2-2.1-9-1.6v13c3.8-.5 6.8 0 9 1.6 2.2-1.6 5.2-2.1 9-1.6v-13c-3.8-.5-6.8 0-9 1.6z" />
      <path d="M12 7v13" />
      {/* a pawn on the left page */}
      <circle cx="7.5" cy="10.5" r="1.25" fill="currentColor" stroke="none" />
      <path d="M6 15.5h3l-.6-2.6h-1.8z" fill="currentColor" stroke="none" />
      {/* lines of text on the right page */}
      <path d="M15 11h3M15 14.5h3" strokeWidth={1.5} />
    </svg>
  );
}
