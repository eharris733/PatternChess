import { ReactNode, useState } from 'react';
import { SidebarNav } from './SidebarNav';
import clsx from 'clsx';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text-primary">
      <aside
        className={clsx(
          'relative shrink-0 border-r border-surface-2 bg-surface flex flex-col transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-[220px]',
        )}
      >
        <SidebarNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 z-10 w-6 h-6 rounded-full bg-surface-2 border border-surface flex items-center justify-center text-text-secondary hover:bg-accent/20 hover:text-text-primary transition-colors"
        >
          <span className="text-xs leading-none">{collapsed ? '▶' : '◀'}</span>
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="p-6 lg:p-10 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
