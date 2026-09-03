import { Link } from 'react-router-dom';
import { BrandMark } from '../BrandLogo';

const LINKS = [
  { label: 'About', to: '/about' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Blog', to: '/blog' },
  { label: 'Tournaments', to: '/events' },
  { label: 'Privacy', to: '/privacy' },
  { label: 'Terms', to: '/terms' },
];

export function LandingFooter() {
  return (
    <footer className="border-t-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark className="h-6 w-6" showTrajectory={false} />
            <span className="font-mono uppercase text-xs tracking-tight text-text-primary">
              PatternChess
            </span>
          </div>
          <nav className="flex items-center gap-5">
            {LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="font-mono uppercase text-xs tracking-tight text-text-primary hover:text-gold-dark transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-6 text-center font-mono uppercase text-[10px] tracking-tight text-text-secondary">
          © 2026 EH Solutions LLC. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
