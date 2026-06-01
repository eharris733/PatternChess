import { Link } from 'react-router-dom';
import { LandingBrand } from './LandingBrand';

export function LandingTopBar() {
  return (
    <header className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b-2 border-text-primary">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <LandingBrand small />
        <nav className="flex items-center gap-3">
          <Link
            to="/login"
            className="font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-transparent text-text-primary px-4 py-2 rounded-none hover:bg-text-primary hover:text-bg transition-colors"
          >
            Log in
          </Link>
          <Link
            to="/login"
            className="font-mono uppercase text-xs tracking-tight border-2 border-text-primary bg-text-primary text-bg px-4 py-2 rounded-none shadow-[3px_3px_0_#8B6914] hover:shadow-[1px_1px_0_#8B6914] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
          >
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  );
}
