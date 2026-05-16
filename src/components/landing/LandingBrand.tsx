import { Link } from 'react-router-dom';

/**
 * Tighter brand lockup for the off-white landing surface. Renders the chessboard
 * mark with no left/right padding (the shared `BrandMark` has a 20px viewBox
 * inset that reads as "cropped" at small sizes against thick borders).
 */
export function LandingBrand({ small = false }: { small?: boolean }) {
  const markSize = small ? 'h-7 w-7' : 'h-9 w-9';
  const textSize = small ? 'text-xl' : 'text-2xl';
  return (
    <Link to="/" aria-label="PatternChess home" className="inline-flex items-center gap-2.5">
      <svg
        viewBox="0 0 80 120"
        className={`${markSize} shrink-0`}
        role="img"
        aria-hidden="true"
      >
        <rect x="40" y="0" width="40" height="40" fill="#C49B2A" />
        <rect x="40" y="40" width="40" height="40" fill="#8B6914" />
        <rect x="40" y="80" width="40" height="40" fill="#C49B2A" />
        <rect x="0" y="80" width="40" height="40" fill="#8B6914" />
        <path
          d="M 0 80 L 80 80 M 40 0 L 40 120 M 40 40 L 80 40"
          stroke="#1A1A1A"
          strokeWidth="2"
          fill="none"
        />
        <circle cx="20" cy="100" r="5" fill="#1A1A1A" />
        <path
          d="M 20 100 Q 20 50 60 20"
          stroke="#1A1A1A"
          strokeWidth="2.5"
          strokeDasharray="3 4"
          fill="none"
          opacity="0.85"
        />
        <circle cx="60" cy="20" r="5" fill="#1A1A1A" />
      </svg>
      <span
        className={`font-serif ${textSize} leading-none whitespace-nowrap text-[#1A1A1A] tracking-tight`}
      >
        Pattern<span className="italic text-gold-dark">Chess</span>
      </span>
    </Link>
  );
}
