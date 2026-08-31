import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { ErrorBoundary } from './ErrorBoundary';
import { PgnUploadModal } from './PgnUploadModal';
import { BrandLockup } from './BrandLogo';
import { MenuIcon } from './icons/MenuIcon';
import clsx from 'clsx';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the drawer whenever navigation happens (covers every NavLink tap).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-text-primary">
      <aside
        className={clsx(
          'relative shrink-0 border-r-2 border-text-primary bg-surface hidden lg:flex flex-col transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-[220px]',
        )}
      >
        <SidebarNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 z-10 w-6 h-6 rounded-full bg-surface border-2 border-text-primary flex items-center justify-center text-text-primary hover:bg-accent/15 hover:border-accent transition-colors"
        >
          <span className="text-xs leading-none">{collapsed ? '▶' : '◀'}</span>
        </button>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden shrink-0 h-14 border-b-2 border-text-primary bg-surface flex items-center justify-between pl-3 pr-1">
          <Link to="/dashboard" aria-label="Dashboard">
            <BrandLockup size="md" />
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="h-11 w-11 flex items-center justify-center text-text-primary hover:bg-accent/10 transition-colors"
          >
            <MenuIcon className="h-6 w-6" />
          </button>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <div className="p-4 sm:p-6 lg:p-10 max-w-[1400px] mx-auto">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
      </div>
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-text-primary/40 backdrop-blur-sm"
          />
          <div className="relative h-full w-[260px] max-w-[80vw] bg-surface border-r-2 border-text-primary flex flex-col overflow-y-auto overscroll-contain">
            <SidebarNav collapsed={false} onToggle={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
      <PgnUploadModal />
    </div>
  );
}
