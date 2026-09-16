interface KingIconProps {
  /** Which side the user played — decides the fill, not the shape. */
  color: 'white' | 'black';
  className?: string;
  title?: string;
}

// Both kings share one silhouette and one outline weight, so the only thing
// that varies is the fill. That reads at a glance in a way the ♔/♚ glyph pair
// never did — those differ only in how much of the same shape is inked.
//
// The fills are fixed rather than themed, like the feedback colors in
// tailwind.config.ts: "white piece" and "black piece" are conventions, and a
// themed fill inverts them outright (the inverse theme's --text-primary is
// near-white, which would render the BLACK king as the lighter of the two).
// The outline stays themed so the shape contrasts against any card surface.
const COLORS = {
  outline: 'rgb(var(--text-primary))',
  white: '#F4F1EA',
  black: '#1F1D1A',
};

export function KingIcon({ color, className, title }: KingIconProps) {
  const fill = color === 'white' ? COLORS.white : COLORS.black;
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
      <g
        fill={fill}
        stroke={COLORS.outline}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Crown cross — always stroked, so it stays legible on a light fill */}
        <path d="M12 1.9v5.6M9.3 4.3h5.4" fill="none" strokeWidth={1.7} />
        {/* Body: shoulders tapering down to the base */}
        <path d="M7 9.6h10l-1.4 6.1H8.4z" />
        {/* Base, kept as its own bar so the silhouette doesn't blur together */}
        <path d="M5.9 17.1h12.2v3.6H5.9z" />
      </g>
    </svg>
  );
}
