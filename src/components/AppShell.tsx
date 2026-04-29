import { ReactNode, useState } from 'react';
import { SidebarNav } from './SidebarNav';
import clsx from 'clsx';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg text-text-primary">
      <aside
        className={clsx(
          'shrink-0 border-r border-surface-2 bg-surface flex flex-col transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-[220px]',
        )}
      >
        <SidebarNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="p-6 lg:p-10 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
