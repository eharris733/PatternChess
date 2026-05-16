import { BrandMark } from '../BrandLogo';

const LINKS = [
  { label: 'Privacy', href: '#' },
  { label: 'Terms', href: '#' },
];

export function LandingFooter() {
  return (
    <footer className="border-t-2 border-[#1A1A1A]">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark className="h-6 w-6" showTrajectory={false} />
          <span className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A]">
            PatternChess
          </span>
        </div>
        <nav className="flex items-center gap-5">
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="font-mono uppercase text-xs tracking-tight text-[#1A1A1A] hover:text-gold-dark transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
