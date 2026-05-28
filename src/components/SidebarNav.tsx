import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { SyncIndicator } from './SyncIndicator';
import { StreakBadge } from './insights/StreakBadge';
import { BrandLockup, BrandMark } from './BrandLogo';
import { DashboardIcon } from './icons/DashboardIcon';
import { VaultIcon } from './icons/VaultIcon';
import { TrainIcon } from './icons/TrainIcon';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/vault', label: 'Vault', Icon: VaultIcon },
  { to: '/training', label: 'Train', Icon: TrainIcon },
];

export function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { profile, user } = useAuth();
  const firstName =
    (profile?.displayName ??
      (user?.user_metadata?.full_name as string | undefined) ??
      user?.email?.split('@')[0] ??
      'there')
      .trim()
      .split(/\s+/)[0];

  return (
    <div className="flex flex-col h-full py-3">
      <button
        onClick={onToggle}
        className={clsx(
          'mx-2 mb-2 flex items-center rounded-none hover:bg-[#1A1A1A]/5 transition text-left',
          collapsed ? 'justify-center p-2' : 'px-3 py-2',
        )}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <BrandMark className="h-8 w-8 shrink-0" />
        ) : (
          <BrandLockup size="md" />
        )}
      </button>

      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              clsx(
                'mx-2 flex items-center gap-3 px-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
                isActive
                  ? 'bg-[#1A1A1A] text-[#F4F4F0]'
                  : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('shrink-0', isActive ? 'text-gold-light' : 'text-[#1A1A1A]')}>
                  <item.Icon className="h-5 w-5" />
                </span>
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto" />

      <SyncIndicator collapsed={collapsed} />

      <div className="mx-2 mb-1 border-2 border-[#1A1A1A] bg-surface-3 divide-y-2 divide-[#1A1A1A]/30">
        <StreakBadge collapsed={collapsed} />

        <NavLink
          to="/profile"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
              isActive
                ? 'bg-[#1A1A1A] text-[#F4F4F0]'
                : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/10',
              collapsed && 'justify-center',
            )
          }
        >
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full shrink-0 border-2 border-[#1A1A1A]"
            />
          ) : (
            <span className="w-7 h-7 rounded-full bg-[#1A1A1A] text-[#F4F4F0] shrink-0 flex items-center justify-center text-xs">
              {firstName.charAt(0).toUpperCase()}
            </span>
          )}
          {!collapsed && <span className="truncate">{firstName}</span>}
        </NavLink>
      </div>
    </div>
  );
}
